const STUDENT_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  PASSOUT: "PASSOUT",
});

const ACADEMIC_STATUS = Object.freeze({
  CURRENT: "current",
  PASSOUT: "passout",
});

const STUDENT_SCOPE = ACADEMIC_STATUS;

const REPORT_STATUS_MAP = Object.freeze({
  [ACADEMIC_STATUS.CURRENT]: STUDENT_STATUS.ACTIVE,
  [ACADEMIC_STATUS.PASSOUT]: STUDENT_STATUS.PASSOUT,
});

const REPORTABLE_SUBMISSION_STATUSES = ["SUBMITTED", "AUTO_SUBMITTED", "GRADED"];

// Legacy lifecycle constants preserved for compatibility during migration
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

const VALID_ACADEMIC_STATUSES = new Set(Object.values(ACADEMIC_STATUS));

const normalizeStudentScope = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === ACADEMIC_STATUS.PASSOUT || ["graduated", "alumni", "passed_out"].includes(normalized)) {
    return ACADEMIC_STATUS.PASSOUT;
  }
  return ACADEMIC_STATUS.CURRENT;
};

const normalizeAcademicStatus = (value) => {
  if (value == null || value === "") return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (VALID_ACADEMIC_STATUSES.has(normalized)) return normalized;
  if (["graduated", "alumni", "passout", "passed_out"].includes(normalized)) return ACADEMIC_STATUS.PASSOUT;
  if (["active", "current"].includes(normalized)) return ACADEMIC_STATUS.CURRENT;
  return null;
};

const academicStatusToStudentScope = (academicStatus) => {
  if (academicStatus === ACADEMIC_STATUS.PASSOUT) return ACADEMIC_STATUS.PASSOUT;
  return ACADEMIC_STATUS.CURRENT;
};

const studentScopeToAcademicStatus = (studentScope) => {
  if (studentScope === ACADEMIC_STATUS.PASSOUT) return ACADEMIC_STATUS.PASSOUT;
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
  if (academicStatus === ACADEMIC_STATUS.PASSOUT) {
    return {
      studentStatus: STUDENT_STATUS.PASSOUT,
    };
  }
  return {
    studentStatus: STUDENT_STATUS.ACTIVE,
  };
};

const buildCurrentReportWhere = (filters = {}) => {
  const where = {
    studentStatus: STUDENT_STATUS.ACTIVE,
  };
  if (filters.collegeId) where.collegeId = filters.collegeId;
  const deptId = normalizeOptionalId(filters.departmentId);
  if (deptId) where.departmentId = deptId;
  const bId = normalizeOptionalId(filters.batchId);
  if (bId) where.batchId = bId;
  return where;
};

const buildPassoutReportWhere = (filters = {}) => {
  const where = {
    studentStatus: STUDENT_STATUS.PASSOUT,
  };
  const passoutYear = normalizePassoutYear(filters.passoutYear);
  const passoutCohortId = normalizeOptionalId(filters.passoutCohortId);
  if (passoutYear) where.passoutYear = passoutYear;
  if (passoutCohortId) where.passoutCohortId = passoutCohortId;
  if (filters.collegeId) where.collegeId = filters.collegeId;
  const deptId = normalizeOptionalId(filters.departmentId);
  if (deptId) where.departmentId = deptId;
  const bId = normalizeOptionalId(filters.batchId);
  if (bId) where.batchId = bId;
  return where;
};

const buildStudentLifecycleWhere = (filters = {}) => {
  // If an explicit studentStatus is given, prioritize it
  const explicitStatus = String(filters.studentStatus || "").trim().toUpperCase();
  if (explicitStatus === STUDENT_STATUS.PASSOUT) {
    return buildPassoutReportWhere(filters);
  }
  if (explicitStatus === STUDENT_STATUS.ACTIVE) {
    return buildCurrentReportWhere(filters);
  }

  const explicitAcademicStatus = normalizeAcademicStatus(filters.academicStatus);
  const scopeStatus = normalizeStudentScope(filters.studentScope);
  const academicStatus = explicitAcademicStatus || (filters.studentScope ? scopeStatus : null);

  if (academicStatus === ACADEMIC_STATUS.PASSOUT) {
    return buildPassoutReportWhere(filters);
  }

  // Current report scope by default (NO "ALL" combination permitted)
  return buildCurrentReportWhere(filters);
};

const appendLifecycleFilters = (where = {}, filters = {}) => ({
  ...where,
  ...buildStudentLifecycleWhere(filters),
});

const buildReportScopeMetadata = (filters = {}) => {
  const academicStatus = normalizeAcademicStatus(filters.academicStatus) || normalizeStudentScope(filters.studentScope);
  const studentScope = academicStatus;
  const studentStatus = REPORT_STATUS_MAP[academicStatus] || STUDENT_STATUS.ACTIVE;

  return {
    studentScope,
    academicStatus,
    studentStatus,
    passoutYear: normalizePassoutYear(filters.passoutYear),
    passoutCohortId: normalizeOptionalId(filters.passoutCohortId),
  };
};

/**
 * Resolve canonical academic status from a student record.
 */
const resolveStudentAcademicStatus = (student = {}) => {
  const status = String(student.studentStatus || "").trim().toUpperCase();
  if (status === STUDENT_STATUS.PASSOUT) return ACADEMIC_STATUS.PASSOUT;
  if (status === STUDENT_STATUS.ACTIVE) return ACADEMIC_STATUS.CURRENT;

  // Fallback for un-migrated legacy records
  const lifecycle = String(student.lifecycleStatus || "").trim().toUpperCase();
  if (ALUMNI_STATUSES.includes(lifecycle) || student.disabledReason === "PASSOUT") {
    return ACADEMIC_STATUS.PASSOUT;
  }
  return ACADEMIC_STATUS.CURRENT;
};

module.exports = {
  STUDENT_STATUS,
  ACADEMIC_STATUS,
  STUDENT_SCOPE,
  REPORT_STATUS_MAP,
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
  buildCurrentReportWhere,
  buildPassoutReportWhere,
  buildAcademicStatusWhere,
  buildStudentLifecycleWhere,
  appendLifecycleFilters,
  buildReportScopeMetadata,
  resolveStudentAcademicStatus,
};