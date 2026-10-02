const STUDENT_SCOPE = {
  CURRENT: "current",
  PASSOUT: "passout",
  ALL: "all",
};

/**
 * Academic status is the user-facing replacement for the old `studentScope`
 * flag. It maps the lifecycle of a student to an explicit, filterable state so
 * historical records survive graduation, suspension, withdrawal and archival.
 */
const ACADEMIC_STATUS = {
  CURRENT: "current",
  GRADUATED: "graduated",
  ON_HOLD: "on_hold",
  WITHDRAWN: "withdrawn",
  TRANSFERRED: "transferred",
  ARCHIVED: "archived",
  ALL: "all",
};

const ALUMNI_STATUSES = ["ALUMNI", "GRADUATED"];
const ON_HOLD_STATUSES = ["SUSPENDED", "BLOCKED"];
const WITHDRAWN_STATUSES = ["DROPPED"];
const TRANSFERRED_STATUSES = ["TRANSFERRED"];
const ARCHIVED_STATUSES = ["ARCHIVED"];
const CURRENT_EXCLUDED_STATUSES = [
  ...ALUMNI_STATUSES,
  ...ON_HOLD_STATUSES,
  ...WITHDRAWN_STATUSES,
  ...TRANSFERRED_STATUSES,
  ...ARCHIVED_STATUSES,
];
const REPORTABLE_SUBMISSION_STATUSES = ["SUBMITTED", "AUTO_SUBMITTED", "GRADED"];

const VALID_SCOPES = new Set(Object.values(STUDENT_SCOPE));
const VALID_ACADEMIC_STATUSES = new Set(Object.values(ACADEMIC_STATUS));

const normalizeStudentScope = (value) => {
  const normalized = String(value || STUDENT_SCOPE.CURRENT).trim().toLowerCase();
  return VALID_SCOPES.has(normalized) ? normalized : STUDENT_SCOPE.CURRENT;
};

const normalizeAcademicStatus = (value) => {
  if (value == null || value === "") return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (VALID_ACADEMIC_STATUSES.has(normalized)) return normalized;
  if (["active", "current"].includes(normalized)) return ACADEMIC_STATUS.CURRENT;
  if (["graduated", "alumni", "passout", "passed_out"].includes(normalized)) return ACADEMIC_STATUS.GRADUATED;
  if (["on_hold", "onhold", "suspended", "blocked"].includes(normalized)) return ACADEMIC_STATUS.ON_HOLD;
  if (["withdrawn", "dropped", "dropout"].includes(normalized)) return ACADEMIC_STATUS.WITHDRAWN;
  if (["transferred"].includes(normalized)) return ACADEMIC_STATUS.TRANSFERRED;
  if (["archived", "inactive"].includes(normalized)) return ACADEMIC_STATUS.ARCHIVED;
  if (["all", "any"].includes(normalized)) return ACADEMIC_STATUS.ALL;
  return null;
};

const academicStatusToStudentScope = (academicStatus) => {
  if (academicStatus === ACADEMIC_STATUS.GRADUATED) return STUDENT_SCOPE.PASSOUT;
  if (academicStatus === ACADEMIC_STATUS.ALL) return STUDENT_SCOPE.ALL;
  return STUDENT_SCOPE.CURRENT;
};

const studentScopeToAcademicStatus = (studentScope) => {
  if (studentScope === STUDENT_SCOPE.PASSOUT) return ACADEMIC_STATUS.GRADUATED;
  if (studentScope === STUDENT_SCOPE.ALL) return ACADEMIC_STATUS.ALL;
  return ACADEMIC_STATUS.CURRENT;
};

const normalizePassoutYear = (value) => {
  if (value == null || value === "") return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
};

const normalizeOptionalId = (value) => {
  const normalized = String(value || "").trim();
  return normalized && normalized !== "all" ? normalized : null;
};

const buildAcademicStatusWhere = (academicStatus) => {
  switch (academicStatus) {
    case ACADEMIC_STATUS.GRADUATED:
      return { lifecycleStatus: { in: ALUMNI_STATUSES } };
    case ACADEMIC_STATUS.ON_HOLD:
      return { lifecycleStatus: { in: ON_HOLD_STATUSES } };
    case ACADEMIC_STATUS.WITHDRAWN:
      return { lifecycleStatus: { in: WITHDRAWN_STATUSES } };
    case ACADEMIC_STATUS.TRANSFERRED:
      return { lifecycleStatus: { in: TRANSFERRED_STATUSES } };
    case ACADEMIC_STATUS.ARCHIVED:
      return { lifecycleStatus: { in: ARCHIVED_STATUSES } };
    case ACADEMIC_STATUS.ALL:
      return {};
    case ACADEMIC_STATUS.CURRENT:
    default:
      return {
        isActive: true,
        lifecycleStatus: { not: { in: CURRENT_EXCLUDED_STATUSES } },
      };
  }
};

const buildStudentLifecycleWhere = (filters = {}) => {
  const passoutYear = normalizePassoutYear(filters.passoutYear);
  const passoutCohortId = normalizeOptionalId(filters.passoutCohortId);

  const explicitAcademicStatus = normalizeAcademicStatus(filters.academicStatus);
  const academicStatus = explicitAcademicStatus || studentScopeToAcademicStatus(normalizeStudentScope(filters.studentScope));
  const base = buildAcademicStatusWhere(academicStatus);

  return {
    ...base,
    ...(passoutYear ? { passoutYear } : {}),
    ...(passoutCohortId ? { passoutCohortId } : {}),
  };
};

const appendLifecycleFilters = (where = {}, filters = {}) => ({
  ...where,
  ...buildStudentLifecycleWhere(filters),
});

const buildReportScopeMetadata = (filters = {}) => {
  const studentScope = normalizeStudentScope(filters.studentScope);
  const academicStatus = normalizeAcademicStatus(filters.academicStatus) || studentScopeToAcademicStatus(studentScope);

  return {
    studentScope,
    academicStatus,
    passoutYear: normalizePassoutYear(filters.passoutYear),
    passoutCohortId: normalizeOptionalId(filters.passoutCohortId),
  };
};

/**
 * Resolve a human-readable academic status from a persisted student document.
 * Used by report payloads so a graduated/suspended student is never silently
 * reported as "current".
 */
const resolveStudentAcademicStatus = (student = {}) => {
  const lifecycleStatus = String(student.lifecycleStatus || "").trim().toUpperCase();

  if (ALUMNI_STATUSES.includes(lifecycleStatus)) return ACADEMIC_STATUS.GRADUATED;
  if (ON_HOLD_STATUSES.includes(lifecycleStatus)) return ACADEMIC_STATUS.ON_HOLD;
  if (WITHDRAWN_STATUSES.includes(lifecycleStatus)) return ACADEMIC_STATUS.WITHDRAWN;
  if (TRANSFERRED_STATUSES.includes(lifecycleStatus)) return ACADEMIC_STATUS.TRANSFERRED;
  if (ARCHIVED_STATUSES.includes(lifecycleStatus)) return ACADEMIC_STATUS.ARCHIVED;
  if (student.isActive === false) return ACADEMIC_STATUS.ARCHIVED;
  return ACADEMIC_STATUS.CURRENT;
};

module.exports = {
  STUDENT_SCOPE,
  ACADEMIC_STATUS,
  ALUMNI_STATUSES,
  ON_HOLD_STATUSES,
  WITHDRAWN_STATUSES,
  TRANSFERRED_STATUSES,
  ARCHIVED_STATUSES,
  CURRENT_EXCLUDED_STATUSES,
  REPORTABLE_SUBMISSION_STATUSES,
  normalizeStudentScope,
  normalizeAcademicStatus,
  academicStatusToStudentScope,
  studentScopeToAcademicStatus,
  normalizePassoutYear,
  normalizeOptionalId,
  buildAcademicStatusWhere,
  buildStudentLifecycleWhere,
  appendLifecycleFilters,
  buildReportScopeMetadata,
  resolveStudentAcademicStatus,
};
