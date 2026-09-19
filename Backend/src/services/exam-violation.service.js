const VIOLATION_DEDUPE_WINDOW_MS = 3_000;
const MAX_LOG_ENTRIES_PER_VIOLATION = 25;

const normalizeViolationType = (type) => String(type || "").trim().toUpperCase();

const buildViolationLog = ({ type, metadata, timestamp }) => ({
  type,
  timestamp,
  metadata: metadata || null,
});

const countActionableViolations = (db, submissionId) =>
  db.violation.count({ where: { submissionId } });

const recordExamViolation = async ({
  db,
  submission,
  user,
  type,
  metadata = null,
  now = new Date(),
  dedupeWindowMs = VIOLATION_DEDUPE_WINDOW_MS,
}) => {
  const submissionId = submission?.id;
  const violationType = normalizeViolationType(type);

  if (!db?.violation || !submissionId || !violationType) {
    throw new Error("recordExamViolation requires db, submission, and type");
  }

  const since = new Date(now.getTime() - Math.max(0, dedupeWindowMs));
  const logEntry = buildViolationLog({ type: violationType, metadata, timestamp: now });
  const recent = await db.violation.findFirst({
    where: {
      submissionId,
      type: violationType,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recent) {
    const currentLogs = Array.isArray(recent.logs) ? recent.logs : [];
    const logs = [...currentLogs.slice(-(MAX_LOG_ENTRIES_PER_VIOLATION - 1)), logEntry];
    const count = Math.max(1, Number(recent.count || 1)) + 1;
    const violation = await db.violation.update({
      where: { id: recent.id },
      data: {
        count,
        logs,
        metadata: metadata || recent.metadata || null,
        detectedAt: now,
      },
    });

    return {
      duplicate: true,
      violation,
      violationCount: await countActionableViolations(db, submissionId),
    };
  }

  const violation = await db.violation.create({
    data: {
      submissionId,
      userId: user?.id || submission.userId,
      testId: submission.testId,
      collegeId: user?.collegeId || submission.collegeId,
      departmentId: user?.departmentId || submission.departmentId || null,
      type: violationType,
      violationType,
      count: 1,
      logs: [logEntry],
      metadata: metadata || null,
      detectedAt: now,
    },
  });

  return {
    duplicate: false,
    violation,
    violationCount: await countActionableViolations(db, submissionId),
  };
};

module.exports = {
  VIOLATION_DEDUPE_WINDOW_MS,
  recordExamViolation,
};
