const { ApiError, asyncHandler } = require("../utils/http");
const {
  ROLES,
  normalizeRole,
  isSuperAdminRole,
  isCollegeAdminRole,
  isDepartmentAdminRole,
} = require("../constants/roles");

const DEFAULT_ID_FIELDS = ["collegeId"];

const getActor = (req) => {
  if (req.superAdmin) {
    return { role: ROLES.SUPER_ADMIN, id: req.superAdmin.id, principal: req.superAdmin };
  }

  if (req.admin) {
    return { role: normalizeRole(req.admin.role), id: req.admin.id, principal: req.admin };
  }

  if (req.user) {
    return { role: normalizeRole(req.user.role || ROLES.STUDENT), id: req.user.id, principal: req.user };
  }

  return null;
};

const extractCandidateIds = (req, fieldNames = DEFAULT_ID_FIELDS) => {
  const values = [];
  for (const field of fieldNames) {
    const bodyValue = req.body?.[field];
    const paramsValue = req.params?.[field];
    const queryValue = req.query?.[field];
    values.push(bodyValue, paramsValue, queryValue);
  }
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
};

const authorizeRoles = (...allowedRoles) =>
  asyncHandler(async (req, _res, next) => {
    const actor = getActor(req);
    if (!actor) {
      throw new ApiError(401, "Authentication required");
    }

    const allowed = new Set(allowedRoles.map(normalizeRole));
    if (!allowed.has(actor.role)) {
      throw new ApiError(403, "Insufficient role for this action", {
        requiredRoles: [...allowed],
        actorRole: actor.role,
      }, "ROLE_NOT_ALLOWED");
    }

    next();
  });

const enforceCollegeScope = (options = {}) =>
  asyncHandler(async (req, _res, next) => {
    const actor = getActor(req);
    if (!actor) {
      throw new ApiError(401, "Authentication required");
    }

    if (isSuperAdminRole(actor.role)) {
      return next();
    }

    const actorCollegeId = String(actor.principal?.collegeId || req.collegeId || "");
    if (!actorCollegeId) {
      throw new ApiError(403, "College scope is required", null, "COLLEGE_SCOPE_REQUIRED");
    }

    const fieldNames = Array.isArray(options.fieldNames) && options.fieldNames.length > 0
      ? options.fieldNames
      : DEFAULT_ID_FIELDS;
    const candidates = extractCandidateIds(req, fieldNames);

    if (candidates.some((candidate) => candidate !== actorCollegeId)) {
      throw new ApiError(403, "Cross-college access denied", {
        actorCollegeId,
        requestedCollegeIds: candidates,
      }, "CROSS_COLLEGE_ACCESS_DENIED");
    }

    req.collegeId = actorCollegeId;
    req.collegeFilter = { collegeId: actorCollegeId };
    next();
  });

const enforceDepartmentScope = (options = {}) =>
  asyncHandler(async (req, _res, next) => {
    const actor = getActor(req);
    if (!actor) {
      throw new ApiError(401, "Authentication required");
    }

    if (isSuperAdminRole(actor.role) || isCollegeAdminRole(actor.role)) {
      return next();
    }

    if (!isDepartmentAdminRole(actor.role)) {
      return next();
    }

    const actorDepartmentId = String(actor.principal?.departmentId || "");
    if (!actorDepartmentId) {
      throw new ApiError(403, "Department scope is required", null, "DEPARTMENT_SCOPE_REQUIRED");
    }

    const fieldNames = Array.isArray(options.fieldNames) && options.fieldNames.length > 0
      ? options.fieldNames
      : ["departmentId"];
    const candidates = extractCandidateIds(req, fieldNames);

    if (candidates.some((candidate) => candidate !== actorDepartmentId)) {
      throw new ApiError(403, "Cross-department access denied", {
        actorDepartmentId,
        requestedDepartmentIds: candidates,
      }, "CROSS_DEPARTMENT_ACCESS_DENIED");
    }

    next();
  });

module.exports = {
  authorizeRoles,
  enforceCollegeScope,
  enforceDepartmentScope,
  getActor,
};
