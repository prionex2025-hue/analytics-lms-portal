const { ADMIN_PERMISSIONS, COLLEGE_ADMIN_PERMISSIONS } = require("./admin-permissions");
const { ROLES, normalizeRole } = require("./roles");

const ADMIN_ACCESS_PROFILES = {
  VIEW_ONLY: "VIEW_ONLY",
  EDITOR: "EDITOR",
};

const VIEW_ONLY_PERMISSIONS = [
  "view_reports",
  "view_tests",
  "view_batches",
  "view_students",
  "view_events",
  "view_question_bank",
  "view_resources",
];

const resolveAdminPermissions = (admin) => {
  if (normalizeRole(admin?.role) === ROLES.COLLEGE_ADMIN) {
    return COLLEGE_ADMIN_PERMISSIONS;
  }

  if (Array.isArray(admin?.permissions) && admin.permissions.length > 0) {
    return admin.permissions;
  }

  if (admin?.accessProfile === ADMIN_ACCESS_PROFILES.VIEW_ONLY) {
    return VIEW_ONLY_PERMISSIONS;
  }

  return ADMIN_PERMISSIONS;
};

const resolvePermissionsFromProfile = (accessProfile) => {
  if (accessProfile === ADMIN_ACCESS_PROFILES.VIEW_ONLY) {
    return VIEW_ONLY_PERMISSIONS;
  }

  return ADMIN_PERMISSIONS;
};

const resolvePermissionsForRole = (role, accessProfile = ADMIN_ACCESS_PROFILES.EDITOR) => {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === ROLES.COLLEGE_ADMIN) {
    return COLLEGE_ADMIN_PERMISSIONS;
  }

  if (normalizedRole === ROLES.ADMIN) {
    return resolvePermissionsFromProfile(accessProfile);
  }

  return [];
};

module.exports = {
  ADMIN_ACCESS_PROFILES,
  VIEW_ONLY_PERMISSIONS,
  resolveAdminPermissions,
  resolvePermissionsFromProfile,
  resolvePermissionsForRole,
};
