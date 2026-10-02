const STUDENT_LIFECYCLE_STATUS = {
  ACTIVE: "ACTIVE",
  ALUMNI: "ALUMNI",
  SUSPENDED: "SUSPENDED",
  DROPPED: "DROPPED",
  TRANSFERRED: "TRANSFERRED",
  ARCHIVED: "ARCHIVED",
};

const LEGACY_LIFECYCLE_STATUS = {
  GRADUATED: "GRADUATED",
  BLOCKED: "BLOCKED",
};

const normalizeStudentLifecycleStatus = (status) => {
  const normalized = String(status || STUDENT_LIFECYCLE_STATUS.ACTIVE).trim().toUpperCase();
  if (normalized === LEGACY_LIFECYCLE_STATUS.GRADUATED) return STUDENT_LIFECYCLE_STATUS.ALUMNI;
  if (normalized === LEGACY_LIFECYCLE_STATUS.BLOCKED) return STUDENT_LIFECYCLE_STATUS.SUSPENDED;
  if (Object.values(STUDENT_LIFECYCLE_STATUS).includes(normalized)) return normalized;
  return STUDENT_LIFECYCLE_STATUS.ACTIVE;
};

const STATUS_EVENT_ACTOR = {
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
  STUDENT: "STUDENT",
  SYSTEM: "SYSTEM",
};

const buildStatusEventPayload = ({
  student = {},
  previousStatus,
  newStatus,
  reason,
  effectiveDate,
  actorId,
  actorType,
  metadata,
}) => {
  const normalizedActor = Object.values(STATUS_EVENT_ACTOR).includes(String(actorType || "").toUpperCase())
    ? String(actorType).toUpperCase()
    : STATUS_EVENT_ACTOR.SYSTEM;

  return {
    studentId: student.id || null,
    collegeId: student.collegeId || null,
    previousStatus: previousStatus ? normalizeStudentLifecycleStatus(previousStatus) : null,
    newStatus: normalizeStudentLifecycleStatus(newStatus),
    reason: reason || null,
    effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
    actorType: normalizedActor,
    changedByAdminId: normalizedActor === STATUS_EVENT_ACTOR.ADMIN ? actorId || null : null,
    changedBySuperAdminId: normalizedActor === STATUS_EVENT_ACTOR.SUPER_ADMIN ? actorId || null : null,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
};

const recordStudentStatusChange = async ({
  db,
  student,
  previousStatus,
  newStatus,
  reason,
  effectiveDate,
  actorId,
  actorType,
  metadata,
}) => {
  if (!db || !db.studentStatusEvent || !student || !student.id) {
    return null;
  }

  const normalizedPrevious = previousStatus ? normalizeStudentLifecycleStatus(previousStatus) : null;
  const normalizedNew = normalizeStudentLifecycleStatus(newStatus);

  if (normalizedPrevious === normalizedNew && !reason) {
    return null;
  }

  return db.studentStatusEvent.create({
    data: buildStatusEventPayload({
      student,
      previousStatus,
      newStatus,
      reason,
      effectiveDate,
      actorId,
      actorType,
      metadata,
    }),
  });
};

const listStudentStatusHistory = async ({ db, studentId, limit = 50 }) => {
  if (!db || !db.studentStatusEvent || !studentId) {
    return [];
  }

  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Number(limit))) : 50;
  return db.studentStatusEvent.findMany({
    where: { studentId },
    orderBy: { effectiveDate: "desc" },
    take: safeLimit,
  });
};

module.exports = {
  STATUS_EVENT_ACTOR,
  STUDENT_LIFECYCLE_STATUS,
  buildStatusEventPayload,
  recordStudentStatusChange,
  listStudentStatusHistory,
};
