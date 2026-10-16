const env = require("../config/env");
const { withRedisLock } = require("./redis-lock.service");
const { createPassoutJob, processPassoutJob } = require("./passout.service");

const LOCK_KEY = "lock:passout-eligibility-sweep";
let timer = null;

const sweepPassoutEligibility = async ({ db, now = new Date() } = {}) => {
  const currentYear = now.getUTCFullYear();
  const candidates = await db.student.findMany({
    where: { studentStatus: "ACTIVE", expectedPassoutMonth: 3, expectedPassoutYear: { lte: currentYear } },
    select: { id: true, collegeId: true, departmentId: true, expectedPassoutYear: true },
  });
  const groups = new Map();
  for (const student of candidates) {
    const eligibilityDate = new Date(Date.UTC(Number(student.expectedPassoutYear), 2, env.passout.eligibilityDay));
    if (now < eligibilityDate) continue;
    const key = `${student.collegeId}:${student.expectedPassoutYear}`;
    const group = groups.get(key) || { collegeId: student.collegeId, passoutYear: student.expectedPassoutYear, studentIds: [], departments: new Set() };
    group.studentIds.push(student.id);
    if (student.departmentId) group.departments.add(String(student.departmentId));
    groups.set(key, group);
  }

  const jobs = [];
  for (const group of groups.values()) {
    const existing = await db.passoutJob.findFirst({ where: { collegeId: group.collegeId, passoutYear: group.passoutYear, scopeType: "YEAR", status: { in: ["QUEUED", "PROCESSING", "AWAITING_APPROVAL", "COMPLETED", "COMPLETED_WITH_ERRORS"] } } });
    if (existing) {
      jobs.push(existing);
      continue;
    }
    const result = await createPassoutJob({
      db,
      collegeId: group.collegeId,
      passoutYear: group.passoutYear,
      scopeType: "YEAR",
      studentIds: group.studentIds,
      initiatedBy: null,
      reason: "Scheduled March passout eligibility check",
      confirmed: !env.passout.approvalRequired,
      automatic: env.passout.approvalRequired,
      inProgressAttemptPolicy: "SKIP",
    });
    jobs.push(result.job);
    if (!env.passout.approvalRequired) await processPassoutJob(result.job.id);
  }
  return { groups: groups.size, jobs };
};

const startPassoutEligibilitySweep = ({ getDb, intervalMs = env.passout.sweepIntervalMs } = {}) => {
  if (timer || typeof getDb !== "function") return;
  timer = setInterval(async () => {
    try {
      await withRedisLock({
        lockKey: LOCK_KEY,
        ttlMs: Math.max(30_000, intervalMs - 5_000),
        waitTimeoutMs: 0,
        onLockTimeout: async () => null,
        task: async () => sweepPassoutEligibility({ db: await getDb() }),
      });
    } catch (error) {
      console.error("Passout eligibility sweep error:", error?.message || error);
    }
  }, intervalMs);
  timer.unref();
};

const stopPassoutEligibilitySweep = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

module.exports = { sweepPassoutEligibility, startPassoutEligibilitySweep, stopPassoutEligibilitySweep };
