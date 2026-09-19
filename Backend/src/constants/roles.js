const ROLES = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  COLLEGE_ADMIN: "COLLEGE_ADMIN",
  ADMIN: "ADMIN",
  STUDENT: "STUDENT",
});

const ROLE_VALUES = Object.freeze(Object.values(ROLES));
const ROLE_SET = new Set(ROLE_VALUES);

const ROLE_ALIASES = Object.freeze({
  COLLEGEADMIN: ROLES.COLLEGE_ADMIN,
  COLLEGE_ADMINISTRATOR: ROLES.COLLEGE_ADMIN,
  DEPARTMENT_ADMIN: ROLES.ADMIN,
  DEPT_ADMIN: ROLES.ADMIN,
  SUB_ADMIN: ROLES.ADMIN,
  SUPERADMIN: ROLES.SUPER_ADMIN,
});

const normalizeRole = (role) => {
  const normalized = String(role || "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();

  return ROLE_ALIASES[normalized] || normalized;
};

const isKnownRole = (role) => ROLE_SET.has(normalizeRole(role));

const isSuperAdminRole = (role) => normalizeRole(role) === ROLES.SUPER_ADMIN;

const isCollegeAdminRole = (role) => normalizeRole(role) === ROLES.COLLEGE_ADMIN;

const isDepartmentAdminRole = (role) => normalizeRole(role) === ROLES.ADMIN;

const isAdminLikeRole = (role) => {
  const normalized = normalizeRole(role);
  return normalized === ROLES.ADMIN || normalized === ROLES.COLLEGE_ADMIN;
};

module.exports = {
  ROLES,
  ROLE_VALUES,
  normalizeRole,
  isKnownRole,
  isSuperAdminRole,
  isCollegeAdminRole,
  isDepartmentAdminRole,
  isAdminLikeRole,
};
