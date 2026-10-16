const crypto = require("crypto");
const models = require("../models");
const { ApiError } = require("../utils/http");
const { withRedisLock } = require("./redis-lock.service");
const { bumpPrincipalTokenVersion, invalidatePrincipalAuthCache } = require("./auth-revocation.service");
const { invalidateRefreshTokenRecord } = require("./refresh-token-cache.service");
const { createAuditLog } = require("./audit.service");
const {
  STUDENT_STATUS,
  EXPECTED_PASSOUT_MONTH,
  getEligibilityDate,
  validateExpectedPassoutYear,
} = require("./student-lifecycle.service");

const JOB_STATUS = Object.freeze({
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  COMPLETED: "COMPLETED",
  COMPLETED_WITH_ERRORS: "COMPLETED_WITH_ERRORS",
  FAILED: "FAILED",
});

const IN_PROGRESS_POLICIES = new Set(["SKIP", "ALLOW"]);
const CHUNK_SIZE = 50;

const uniqueIds = (values = []) => [...new Set(values.filter(Boolean).map((value) => String(value)))];

const buildStudentWhere = ({ collegeId, departmentId, year, studentIds, batchId, batchIds = [], status = STUDENT_STATUS.ACTIVE }) => ({
  collegeId,
  ...(departmentId ? { departmentId } : {}),
  ...(year ? { expectedPassoutYear: year, expectedPassoutMonth: EXPECTED_PASSOUT_MONTH } : {}),
  ...(status ? { studentStatus: status } : {}),
  ...(studentIds?.length ? { id: { in: uniqueIds(studentIds) } } : {}),
  ...((batchId || batchIds.length) ? { OR: (batchIds.length ? batchIds : [batchId]).flatMap((id) => [{ batchIds: { in: [id] } }, { batchId: id }]) } : {}),
});

const getBatchIds = (student) => uniqueIds([
  ...(Array.isArray(student?.batchIds) ? student.batchIds : []),
  student?.batchId,
]);

const buildIdempotencyKey = ({ collegeId, departmentId, passoutYear, scopeType, studentIds, batchIds, retryOf }) =>
  crypto.createHash("sha256").update(JSON.stringify({
    collegeId,
    departmentId: departmentId || null,
    passoutYear,
    scopeType,
    studentIds: uniqueIds(studentIds).sort(),
    batchIds: uniqueIds(batchIds).sort(),
    retryOf: retryOf || null,
  })).digest("hex");

const assertPolicy = (policy) => {
  const normalized = String(policy || "SKIP").trim().toUpperCase();
  if (!IN_PROGRESS_POLICIES.has(normalized)) {
    throw new ApiError(422, "inProgressAttemptPolicy must be SKIP or ALLOW", null, "INVALID_PASSOUT_ATTEMPT_POLICY");
  }
  return normalized;
};

const getStudentDependencies = async (db, studentId) => {
  const [submissions, inProgressAttempts, sessions, submissionRows] = await Promise.all([
    db.submission.count({ where: { userId: studentId } }),
    db.submission.count({ where: { userId: studentId, status: "IN_PROGRESS" } }),
    db.testSession.count({ where: { userId: studentId } }).catch(() => 0),
    db.submission.findMany({ where: { userId: studentId }, select: { id: true }, take: 5000 }).catch(() => []),
  ]);
  const submissionIds = submissionRows.map((submission) => submission.id).filter(Boolean);
  const answers = submissionIds.length ? await db.answer.count({ where: { submissionId: { in: submissionIds } } }).catch(() => 0) : 0;

  return {
    submissions: Number(submissions || 0),
    inProgressAttempts: Number(inProgressAttempts || 0),
    answers: Number(answers || 0),
    sessions: Number(sessions || 0),
  };
};

const loadEligibleStudents = async ({ db, collegeId, departmentId, passoutYear, studentIds, batchId, batchIds, page = 1, limit = 50 }) => {
  const year = validateExpectedPassoutYear(passoutYear);
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const where = buildStudentWhere({ collegeId, departmentId, year, studentIds, batchId, batchIds });
  const [total, students] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({
      where,
      include: { batches: true, department: true, college: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    }),
  ]);

  const data = await Promise.all(students.map(async (student) => ({
    ...student,
    expectedPassoutMonth: EXPECTED_PASSOUT_MONTH,
    eligibilityDate: getEligibilityDate(year).toISOString(),
    dependencies: await getStudentDependencies(db, student.id),
  })));

  return {
    data,
    pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    passoutYear: year,
    eligibilityDate: getEligibilityDate(year).toISOString(),
  };
};

const previewPassout = async ({ db, collegeId, departmentId, passoutYear, studentIds, batchId, batchIds, page, limit, now = new Date() }) => {
  const result = await loadEligibleStudents({ db, collegeId, departmentId, passoutYear, studentIds, batchId, batchIds, page, limit });
  const eligibleDate = new Date(result.eligibilityDate);
  const beforeScheduledDate = now < eligibleDate;
  const incomplete = result.data.filter((student) => student.dependencies.inProgressAttempts > 0);
  const affectedBatchIds = uniqueIds(result.data.flatMap(getBatchIds));
  const batches = affectedBatchIds.length
    ? await db.batch.findMany({ where: { id: { in: affectedBatchIds }, collegeId }, include: { department: true } })
    : [];

  return {
    ...result,
    beforeScheduledDate,
    policy: { scheduledPromotionRequiresApproval: true, inProgressAttemptPolicy: "SKIP" },
    exceptions: {
      incompleteAttempts: incomplete.map((student) => ({ studentId: student.id, count: student.dependencies.inProgressAttempts })),
      invalidBatchReferences: result.data.filter((student) => getBatchIds(student).some((id) => !batches.some((batch) => String(batch.id) === id))).map((student) => student.id),
    },
    affectedBatches: batches.map((batch) => ({ id: batch.id, name: batch.name, departmentId: batch.departmentId, status: batch.status || "ACTIVE" })),
  };
};

const revokeStudentAccess = async (db, studentId) => {
  await bumpPrincipalTokenVersion(db, "student", studentId);
  const activeTokens = await db.studentRefreshToken.findMany({ where: { userId: studentId, revokedAt: null } });
  if (activeTokens.length) {
    await db.studentRefreshToken.updateMany({ where: { userId: studentId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "PASSOUT" } });
    await Promise.all(activeTokens.map((record) => invalidateRefreshTokenRecord("student", record)));
  }
  await invalidatePrincipalAuthCache("student", studentId);
};

const archiveBatchIfSafe = async ({ db, batchId, collegeId, actorId, now }) => {
  const batch = await db.batch.findFirst({ where: { id: batchId, collegeId } });
  if (!batch || batch.status === "ARCHIVED" || batch.isArchived === true) return { archived: false, reason: "missing_or_already_archived" };

  const activeStudents = await db.student.count({
    where: {
      collegeId,
      OR: [{ batchIds: { in: [batchId] } }, { batchId }],
      AND: [{
        OR: [
          { studentStatus: STUDENT_STATUS.ACTIVE, isActive: true },
          { studentStatus: null, isActive: true, lifecycleStatus: { not: { in: ["ALUMNI", "GRADUATED", "SUSPENDED", "DROPPED", "BLOCKED"] } } },
        ],
      }],
    },
  });
  if (activeStudents > 0) return { archived: false, reason: "active_students_remain", activeStudents };

  await db.batch.update({ where: { id: batchId, collegeId }, data: { status: "ARCHIVED", isArchived: true, isActive: false, archivedAt: now, archivedBy: actorId, archivedByAdminId: actorId } });
  await db.testBatch.updateMany({ where: { batchId, collegeId, isArchived: { not: true } }, data: { isArchived: true, archivedAt: now, archivedByAdminId: actorId } }).catch(() => null);
  return { archived: true, batchId };
};

const processPassoutJob = async (jobId) => {
  const m = await models.init();
  const db = m.dbClient;
  return withRedisLock({
    lockKey: `lock:passout-job:${jobId}`,
    ttlMs: 120_000,
    waitTimeoutMs: 0,
    onLockTimeout: async () => db.passoutJob.findUnique({ where: { id: jobId } }),
    task: async () => {
      const job = await db.passoutJob.findUnique({ where: { id: jobId } });
      if (!job || [JOB_STATUS.COMPLETED, JOB_STATUS.COMPLETED_WITH_ERRORS].includes(job.status)) return job;
      const startedAt = new Date();
      await db.passoutJob.update({ where: { id: jobId }, data: { status: JOB_STATUS.PROCESSING, startedAt } });

      const selectedIds = uniqueIds(job.selectedStudentIds);
      const candidates = await db.student.findMany({
        where: buildStudentWhere({ collegeId: job.collegeId, departmentId: job.departmentId, year: job.passoutYear, studentIds: selectedIds, batchIds: job.selectedBatchIds || [] }),
        include: { batches: true, department: true },
      });
      const candidateIds = new Set(candidates.map((student) => String(student.id)));
      const requestedIds = selectedIds.length ? selectedIds : candidates.map((student) => String(student.id));
      const total = requestedIds.length;
      const successStudentIds = uniqueIds(job.successStudentIds);
      const skippedStudentIds = uniqueIds(job.skippedStudentIds);
      const failedStudentIds = uniqueIds(job.failedStudentIds);
      const skips = Array.isArray(job.skips) ? [...job.skips] : [];
      const failures = Array.isArray(job.failures) ? [...job.failures] : [];

      for (let offset = 0; offset < requestedIds.length; offset += CHUNK_SIZE) {
        const chunk = requestedIds.slice(offset, offset + CHUNK_SIZE);
        for (const studentId of chunk) {
          if (successStudentIds.includes(studentId) || skippedStudentIds.includes(studentId)) continue;
          try {
            if (!candidateIds.has(studentId)) {
              skippedStudentIds.push(studentId);
              skips.push({ studentId, reason: "NOT_ELIGIBLE_OR_OUTSIDE_SCOPE" });
              continue;
            }
            const dependencies = await getStudentDependencies(db, studentId);
            if (dependencies.inProgressAttempts > 0 && job.policy?.inProgressAttemptPolicy !== "ALLOW") {
              skippedStudentIds.push(studentId);
              skips.push({ studentId, reason: "IN_PROGRESS_ATTEMPT", count: dependencies.inProgressAttempts });
              continue;
            }
            const now = new Date();
            const updated = await db.student.update({
              where: { id: studentId, collegeId: job.collegeId, studentStatus: STUDENT_STATUS.ACTIVE, expectedPassoutYear: job.passoutYear, expectedPassoutMonth: EXPECTED_PASSOUT_MONTH },
              data: {
                studentStatus: STUDENT_STATUS.PASSOUT,
                lifecycleStatus: "ALUMNI",
                isActive: false,
                disabledReason: "PASSOUT",
                disabledAt: now,
                archivedAt: now,
                archivedBy: job.initiatedBy,
                archivedByAdminId: job.initiatedBy,
                passoutYear: job.passoutYear,
              },
            });
            if (!updated) {
              skippedStudentIds.push(studentId);
              skips.push({ studentId, reason: "ALREADY_PROCESSED_OR_CHANGED" });
              continue;
            }
            await revokeStudentAccess(db, studentId);
            successStudentIds.push(studentId);
          } catch (error) {
            failedStudentIds.push(studentId);
            failures.push({ studentId, message: error?.message || "Promotion failed" });
          }
        }
        const processed = successStudentIds.length + skippedStudentIds.length + failedStudentIds.length;
        await db.passoutJob.update({ where: { id: jobId }, data: {
          successStudentIds,
          skippedStudentIds,
          failedStudentIds,
          skips,
          failures,
          progress: { processed, total, percent: total ? Math.round((processed / total) * 100) : 100 },
        } });
      }

      const affectedBatchIds = uniqueIds(candidates.flatMap(getBatchIds));
      const archivedBatches = [];
      for (const batchId of affectedBatchIds) {
        const outcome = await archiveBatchIfSafe({ db, batchId, collegeId: job.collegeId, actorId: job.initiatedBy, now: new Date() });
        if (outcome.archived) archivedBatches.push(batchId);
      }

      const finalStatus = failures.length === 0 ? JOB_STATUS.COMPLETED : (successStudentIds.length ? JOB_STATUS.COMPLETED_WITH_ERRORS : JOB_STATUS.FAILED);
      const completed = await db.passoutJob.update({ where: { id: jobId }, data: {
        status: finalStatus,
        completedAt: new Date(),
        successStudentIds,
        skippedStudentIds,
        failedStudentIds,
        skips,
        failures,
        affectedBatchIds,
        archivedBatchIds: archivedBatches,
        progress: { processed: total, total, percent: 100 },
      } });
      await createAuditLog({ action: "PASSOUT_JOB_COMPLETED", targetType: "PASSOUT_JOB", targetId: jobId, collegeId: job.collegeId, adminId: job.initiatedBy, afterState: { status: finalStatus, passoutYear: job.passoutYear, promoted: successStudentIds.length, skipped: skippedStudentIds.length, failed: failedStudentIds.length, archivedBatches: archivedBatches.length } });
      return completed;
    },
  });
};

const createPassoutJob = async ({ db, collegeId, departmentId, passoutYear: rawYear, scopeType = "INDIVIDUAL", studentIds = [], batchIds = [], initiatedBy, reason, confirmed = false, inProgressAttemptPolicy = "SKIP", automatic = false, retryOf = null }) => {
  const passoutYear = validateExpectedPassoutYear(rawYear);
  const normalizedStudentIds = uniqueIds(studentIds);
  const normalizedBatchIds = uniqueIds(batchIds);
  const policy = assertPolicy(inProgressAttemptPolicy);
  if (!automatic && !confirmed) throw new ApiError(409, "Explicit confirmation is required before promotion", null, "PASSOUT_CONFIRMATION_REQUIRED");
  if (!["INDIVIDUAL", "BATCH", "YEAR"].includes(scopeType)) throw new ApiError(422, "Invalid passout promotion scope", null, "INVALID_PASSOUT_SCOPE");
  if (scopeType === "INDIVIDUAL" && normalizedStudentIds.length === 0) throw new ApiError(422, "Select at least one eligible student");
  if (scopeType === "BATCH" && normalizedBatchIds.length === 0) throw new ApiError(422, "Select at least one eligible batch");

  const idempotencyKey = buildIdempotencyKey({ collegeId, departmentId, passoutYear, scopeType, studentIds: normalizedStudentIds, batchIds: normalizedBatchIds, retryOf });
  const existing = await db.passoutJob.findFirst({ where: { idempotencyKey } });
  if (existing) return { job: existing, reused: true };

  const job = await db.passoutJob.create({ data: {
    jobId: idempotencyKey,
    idempotencyKey,
    collegeId,
    departmentId: departmentId || null,
    passoutYear,
    expectedPassoutMonth: EXPECTED_PASSOUT_MONTH,
    scopeType,
    selectedStudentIds: normalizedStudentIds,
    selectedBatchIds: normalizedBatchIds,
    initiatedBy,
    reason: String(reason || "").trim().slice(0, 500) || null,
    status: automatic ? JOB_STATUS.AWAITING_APPROVAL : JOB_STATUS.QUEUED,
    policy: { inProgressAttemptPolicy: policy, automatic: Boolean(automatic), approvalRequired: Boolean(automatic) },
    progress: { processed: 0, total: 0, percent: 0 },
    retryOf: retryOf || null,
  } });
  await createAuditLog({ action: "PASSOUT_JOB_CREATED", targetType: "PASSOUT_JOB", targetId: job.id, collegeId, adminId: initiatedBy, afterState: { passoutYear, scopeType, selectedStudentCount: normalizedStudentIds.length, selectedBatchCount: normalizedBatchIds.length, automatic: Boolean(automatic) } });
  if (!automatic) setImmediate(() => processPassoutJob(job.id).catch(() => null));
  return { job, reused: false };
};

const retryPassoutJob = async ({ db, jobId, collegeId, initiatedBy }) => {
  const original = await db.passoutJob.findFirst({ where: { id: jobId, collegeId } });
  if (!original) throw new ApiError(404, "Passout job not found");
  if (!Array.isArray(original.failedStudentIds) || original.failedStudentIds.length === 0) throw new ApiError(409, "Passout job has no failed records to retry");
  return createPassoutJob({ db, collegeId, departmentId: original.departmentId, passoutYear: original.passoutYear, scopeType: "INDIVIDUAL", studentIds: original.failedStudentIds, initiatedBy, reason: `Retry of ${original.id}`, confirmed: true, inProgressAttemptPolicy: original.policy?.inProgressAttemptPolicy || "SKIP", retryOf: original.id });
};

module.exports = {
  JOB_STATUS,
  buildStudentWhere,
  buildIdempotencyKey,
  getStudentDependencies,
  loadEligibleStudents,
  previewPassout,
  createPassoutJob,
  processPassoutJob,
  retryPassoutJob,
  archiveBatchIfSafe,
};
