const STUDENT_SCOPE = {
  CURRENT: "current",
  PASSOUT: "passout",
  ALL: "all",
};

const ALUMNI_STATUSES = ["ALUMNI", "GRADUATED"];
const CURRENT_EXCLUDED_STATUSES = ["ALUMNI", "GRADUATED", "DROPPED", "SUSPENDED", "BLOCKED"];
const REPORTABLE_SUBMISSION_STATUSES = ["SUBMITTED", "AUTO_SUBMITTED", "GRADED"];

const VALID_SCOPES = new Set(Object.values(STUDENT_SCOPE));

const normalizeStudentScope = (value) => {
  const normalized = String(value || STUDENT_SCOPE.CURRENT).trim().toLowerCase();
  return VALID_SCOPES.has(normalized) ? normalized : STUDENT_SCOPE.CURRENT;
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

const buildStudentLifecycleWhere = (filters = {}) => {
  const studentScope = normalizeStudentScope(filters.studentScope);
  const passoutYear = normalizePassoutYear(filters.passoutYear);
  const passoutCohortId = normalizeOptionalId(filters.passoutCohortId);

  if (studentScope === STUDENT_SCOPE.CURRENT) {
    return {
      isActive: true,
      lifecycleStatus: { not: { in: CURRENT_EXCLUDED_STATUSES } },
    };
  }

  if (studentScope === STUDENT_SCOPE.PASSOUT) {
    return {
      lifecycleStatus: { in: ALUMNI_STATUSES },
      ...(passoutYear ? { passoutYear } : {}),
      ...(passoutCohortId ? { passoutCohortId } : {}),
    };
  }

  return {
    ...(passoutYear ? { passoutYear } : {}),
    ...(passoutCohortId ? { passoutCohortId } : {}),
  };
};

const appendLifecycleFilters = (where = {}, filters = {}) => ({
  ...where,
  ...buildStudentLifecycleWhere(filters),
});

const buildReportScopeMetadata = (filters = {}) => ({
  studentScope: normalizeStudentScope(filters.studentScope),
  passoutYear: normalizePassoutYear(filters.passoutYear),
  passoutCohortId: normalizeOptionalId(filters.passoutCohortId),
});

module.exports = {
  STUDENT_SCOPE,
  REPORTABLE_SUBMISSION_STATUSES,
  normalizeStudentScope,
  normalizePassoutYear,
  normalizeOptionalId,
  buildStudentLifecycleWhere,
  appendLifecycleFilters,
  buildReportScopeMetadata,
};
