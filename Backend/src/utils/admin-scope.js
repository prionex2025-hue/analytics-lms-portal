const { ApiError } = require("./http");
const { ROLES, normalizeRole } = require("../constants/roles");

const getRequestAdminRole = (req) => normalizeRole(req.admin?.role || ROLES.ADMIN);

const isCollegeAdminRequest = (req) => getRequestAdminRole(req) === ROLES.COLLEGE_ADMIN;

const isDepartmentAdminRequest = (req) => getRequestAdminRole(req) === ROLES.ADMIN;

const getScopedDepartmentId = (req, { requiredForDepartmentAdmin = true } = {}) => {
  const role = getRequestAdminRole(req);
  const departmentId = req.admin?.departmentId || null;

  if (role === ROLES.COLLEGE_ADMIN) {
    return null;
  }

  if (requiredForDepartmentAdmin && !departmentId) {
    throw new ApiError(403, "Admin is not linked to a department", null, "ADMIN_DEPARTMENT_REQUIRED");
  }

  return departmentId || null;
};

const assertDepartmentScope = (req, candidateDepartmentId, message = "Cross-department access denied") => {
  if (!candidateDepartmentId) {
    return;
  }

  const departmentId = getScopedDepartmentId(req);
  if (!departmentId) {
    return;
  }

  if (String(candidateDepartmentId) !== String(departmentId)) {
    throw new ApiError(403, message, null, "CROSS_DEPARTMENT_ACCESS_DENIED");
  }
};

module.exports = {
  getRequestAdminRole,
  isCollegeAdminRequest,
  isDepartmentAdminRequest,
  getScopedDepartmentId,
  assertDepartmentScope,
};
