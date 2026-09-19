export const ADMIN_ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  COLLEGE_ADMIN: "COLLEGE_ADMIN",
  ADMIN: "ADMIN",
};

const ROLE_ALIASES = {
  COLLEGEADMIN: ADMIN_ROLES.COLLEGE_ADMIN,
  COLLEGE_ADMINISTRATOR: ADMIN_ROLES.COLLEGE_ADMIN,
  DEPARTMENT_ADMIN: ADMIN_ROLES.ADMIN,
  DEPT_ADMIN: ADMIN_ROLES.ADMIN,
  SUB_ADMIN: ADMIN_ROLES.ADMIN,
  SUPERADMIN: ADMIN_ROLES.SUPER_ADMIN,
};

export const normalizeAdminRole = (role) => {
  const normalized = String(role || "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();

  return ROLE_ALIASES[normalized] || normalized;
};

export const isCollegeAdminRole = (role) => normalizeAdminRole(role) === ADMIN_ROLES.COLLEGE_ADMIN;
export const isAdminRole = (role) => normalizeAdminRole(role) === ADMIN_ROLES.ADMIN;

export const normalizeAdminPrincipal = (admin) => {
  if (!admin || typeof admin !== "object") {
    return null;
  }

  return {
    ...admin,
    role: normalizeAdminRole(admin.role),
  };
};
