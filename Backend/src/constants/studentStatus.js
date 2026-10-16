const STUDENT_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  PASSOUT: "PASSOUT",
});

const STUDENT_STATUS_VALUES = Object.freeze(Object.values(STUDENT_STATUS));
const STUDENT_STATUS_SET = new Set(STUDENT_STATUS_VALUES);

/**
 * Workspace identifiers used in API routes and frontend navigation.
 * These are distinct from the persisted studentStatus values.
 */
const REPORT_WORKSPACE = Object.freeze({
  CURRENT: "current",
  PASSOUT: "passout",
});

const REPORT_WORKSPACE_VALUES = Object.freeze(Object.values(REPORT_WORKSPACE));
const REPORT_WORKSPACE_SET = new Set(REPORT_WORKSPACE_VALUES);

/**
 * Maps workspace identifier to the persisted studentStatus value.
 * This is the single source of truth for scope resolution.
 */
const REPORT_STATUS_MAP = Object.freeze({
  [REPORT_WORKSPACE.CURRENT]: STUDENT_STATUS.ACTIVE,
  [REPORT_WORKSPACE.PASSOUT]: STUDENT_STATUS.PASSOUT,
});

/**
 * Validates and normalizes a workspace identifier.
 * Returns the default (CURRENT) for invalid values.
 */
const normalizeReportWorkspace = (value) => {
  const normalized = String(value || REPORT_WORKSPACE.CURRENT).trim().toLowerCase();
  return REPORT_WORKSPACE_SET.has(normalized) ? normalized : REPORT_WORKSPACE.CURRENT;
};

/**
 * Gets the studentStatus value for a given workspace.
 * Throws for invalid workspace values instead of defaulting.
 */
const getStudentStatusForWorkspace = (workspace) => {
  const normalized = normalizeReportWorkspace(workspace);
  if (normalized === REPORT_WORKSPACE.CURRENT) return STUDENT_STATUS.ACTIVE;
  if (normalized === REPORT_WORKSPACE.PASSOUT) return STUDENT_STATUS.PASSOUT;
  throw new Error(`Invalid report workspace: ${workspace}`);
};

/**
 * Legacy academic status constants - DEPRECATED.
 * Kept only for backward compatibility during migration.
 * Do not use in new code.
 */
const LEGACY_ACADEMIC_STATUS = Object.freeze({
  CURRENT: "current",
  GRADUATED: "graduated",
  ON_HOLD: "on_hold",
  WITHDRAWN: "withdrawn",
  TRANSFERRED: "transferred",
  ARCHIVED: "archived",
  ALL: "all",
});

module.exports = {
  STUDENT_STATUS,
  STUDENT_STATUS_VALUES,
  STUDENT_STATUS_SET,
  REPORT_WORKSPACE,
  REPORT_WORKSPACE_VALUES,
  REPORT_WORKSPACE_SET,
  REPORT_STATUS_MAP,
  normalizeReportWorkspace,
  getStudentStatusForWorkspace,
  LEGACY_ACADEMIC_STATUS,
};