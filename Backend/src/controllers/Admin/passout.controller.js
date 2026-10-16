const models = require("../../models");
const { asyncHandler, ApiError } = require("../../utils/http");
const { getScopedDepartmentId } = require("../../utils/admin-scope");
const { createAuditLog } = require("../../services/audit.service");
const {
  previewPassout,
  createPassoutJob,
  retryPassoutJob,
  JOB_STATUS,
} = require("../../services/passout.service");

const assertDepartmentScope = (req, departmentId) => {
  const scoped = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  if (scoped && departmentId && String(scoped) !== String(departmentId)) {
    throw new ApiError(403, "Cross-department access denied", null, "CROSS_DEPARTMENT_ACCESS_DENIED");
  }
  return scoped || departmentId || null;
};

const getPreview = asyncHandler(async (req, res) => {
  const db = (await models.init()).dbClient;
  const departmentId = assertDepartmentScope(req, req.body.departmentId);
  const result = await previewPassout({
    db,
    collegeId: req.collegeId,
    departmentId,
    passoutYear: req.body.passoutYear,
    studentIds: req.body.studentIds,
    batchId: req.body.batchId,
    page: req.body.page,
    limit: req.body.limit,
  });
  res.status(200).json(result);
});

const getEligible = asyncHandler(async (req, res) => {
  const db = (await models.init()).dbClient;
  const departmentId = assertDepartmentScope(req, req.query.departmentId);
  const result = await previewPassout({
    db,
    collegeId: req.collegeId,
    departmentId,
    passoutYear: req.query.year,
    batchId: req.query.batchId,
    page: req.query.page,
    limit: req.query.limit,
  });
  res.status(200).json(result);
});

const promote = asyncHandler(async (req, res) => {
  const db = (await models.init()).dbClient;
  const departmentId = assertDepartmentScope(req, req.body.departmentId);
  if (req.body.scopeType === "INDIVIDUAL" && req.body.studentIds.length === 0) {
    throw new ApiError(422, "Select at least one student");
  }
  if (req.body.scopeType === "BATCH" && req.body.batchIds.length === 0) {
    throw new ApiError(422, "Select at least one batch");
  }
  const result = await createPassoutJob({
    db,
    collegeId: req.collegeId,
    departmentId,
    passoutYear: req.body.passoutYear,
    scopeType: req.body.scopeType,
    studentIds: req.body.studentIds,
    batchIds: req.body.batchIds,
    initiatedBy: req.admin.id,
    reason: req.body.reason,
    confirmed: req.body.confirmation === true,
    inProgressAttemptPolicy: req.body.inProgressAttemptPolicy,
  });
  res.status(result.reused ? 200 : 202).json({
    job: result.job,
    reused: result.reused,
    message: result.reused ? "An equivalent passout operation already exists." : "Passout operation queued.",
  });
});

const getJob = asyncHandler(async (req, res) => {
  const db = (await models.init()).dbClient;
  const job = await db.passoutJob.findFirst({ where: { id: req.params.jobId, collegeId: req.collegeId } });
  if (!job) throw new ApiError(404, "Passout job not found");
  assertDepartmentScope(req, job.departmentId);
  res.status(200).json(job);
});

const getHistory = asyncHandler(async (req, res) => {
  const db = (await models.init()).dbClient;
  const departmentId = assertDepartmentScope(req, req.query.departmentId);
  const jobs = await db.passoutJob.findMany({ where: { collegeId: req.collegeId, ...(departmentId ? { departmentId } : {}) }, orderBy: { createdAt: "desc" }, skip: ((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 20), take: Number(req.query.limit) || 20 });
  res.status(200).json({ data: jobs, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20 });
});

const retry = asyncHandler(async (req, res) => {
  const db = (await models.init()).dbClient;
  const original = await db.passoutJob.findFirst({ where: { id: req.params.jobId, collegeId: req.collegeId } });
  if (!original) throw new ApiError(404, "Passout job not found");
  assertDepartmentScope(req, original.departmentId);
  const result = await retryPassoutJob({ db, jobId: req.params.jobId, collegeId: req.collegeId, initiatedBy: req.admin.id });
  await createAuditLog({ action: "PASSOUT_JOB_RETRY_REQUESTED", targetType: "PASSOUT_JOB", targetId: req.params.jobId, collegeId: req.collegeId, adminId: req.admin.id, afterState: { retryJobId: result.job.id } });
  res.status(202).json({ job: result.job, reused: result.reused });
});

const getArchivedStudents = asyncHandler(async (req, res) => {
  const db = (await models.init()).dbClient;
  const departmentId = assertDepartmentScope(req, req.query.departmentId);
  const where = { collegeId: req.collegeId, studentStatus: "PASSOUT", ...(departmentId ? { departmentId } : {}), ...(req.query.year ? { passoutYear: Number(req.query.year) } : {}) };
  const [total, data] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({ where, include: { batches: true, department: true }, orderBy: { archivedAt: "desc" }, skip: ((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 20), take: Number(req.query.limit) || 20 }),
  ]);
  res.status(200).json({ data, pagination: { page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, total } });
});

const getArchivedBatches = asyncHandler(async (req, res) => {
  const db = (await models.init()).dbClient;
  const departmentId = assertDepartmentScope(req, req.query.departmentId);
  const where = { collegeId: req.collegeId, OR: [{ status: "ARCHIVED" }, { isArchived: true }], ...(departmentId ? { departmentId } : {}) };
  const data = await db.batch.findMany({ where, include: { department: true }, orderBy: { archivedAt: "desc" }, skip: ((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 20), take: Number(req.query.limit) || 20 });
  res.status(200).json({ data });
});

module.exports = { getEligible, getPreview, promote, getJob, getHistory, retry, getArchivedStudents, getArchivedBatches, JOB_STATUS };
