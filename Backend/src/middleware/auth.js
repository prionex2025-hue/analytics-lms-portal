const db = require("../config/db");
const { TokenExpiredError, JsonWebTokenError, NotBeforeError } = require("jsonwebtoken");
const { verifyAccessToken } = require("../utils/token");
const { ApiError, asyncHandler } = require("../utils/http");
const { resolveAdminPermissions } = require("../constants/admin-access-profiles");
const { isAccessTokenRevoked } = require("../services/access-token-revocation.service");
const {
  ROLES,
  normalizeRole,
  isAdminLikeRole,
  isCollegeAdminRole,
  isDepartmentAdminRole,
} = require("../constants/roles");
const { getCachedUser, setCachedUser } = require("../services/auth-cache.service");
const { canStudentAuthenticate } = require("../services/student-lifecycle.service");

const parseTokenPayload = (req) => {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "Authentication required");
  }

  const token = authHeader.replace("Bearer ", "").trim();

  try {
    return verifyAccessToken(token);
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw new ApiError(401, "Access token expired", { expiredAt: error.expiredAt }, "TOKEN_EXPIRED");
    }

    if (error instanceof JsonWebTokenError || error instanceof NotBeforeError) {
      throw new ApiError(401, "Invalid access token", null, "INVALID_TOKEN");
    }

    throw error;
  }
};

const validatePrincipalTokenClaims = ({ payload, principal }) => {
  if (!principal) {
    throw new ApiError(401, "Invalid access token");
  }

  if (payload.collegeId && principal.collegeId && String(payload.collegeId) !== String(principal.collegeId)) {
    throw new ApiError(401, "Invalid access token");
  }

  if (payload.departmentId && principal.departmentId && String(payload.departmentId) !== String(principal.departmentId)) {
    throw new ApiError(401, "Invalid access token");
  }

  const tokenVersion = Number(payload.tokenVersion || 0);
  const principalTokenVersion = Number(principal.tokenVersion || 0);
  if (tokenVersion !== principalTokenVersion) {
    throw new ApiError(401, "Access token has been revoked", null, "TOKEN_REVOKED");
  }
};

const assertAccessTokenNotRevoked = async (payload) => {
  if (await isAccessTokenRevoked(payload)) {
    throw new ApiError(401, "Access token has been revoked", null, "TOKEN_REVOKED");
  }
};

const authenticateStudent = asyncHandler(async (req, _res, next) => {
  const payload = parseTokenPayload(req);
  const role = normalizeRole(payload.role || ROLES.STUDENT);

  if (role !== ROLES.STUDENT) {
    throw new ApiError(403, "Student role required");
  }

  await assertAccessTokenNotRevoked(payload);
  req.authIdentity = `user:${ROLES.STUDENT}:${payload.sub}`;

  let user = await getCachedUser("student", payload.sub);

  if (!user) {
    user = await db.student.findUnique({
      where: { id: payload.sub },
      include: {
        batches: true,
        department: true,
        college: true,
      },
    });

    if (user) {
      const rawBatchIds = Array.isArray(user.batchIds) ? user.batchIds : [];
      const singleBatchId = user.batchId || null;
      user.batchIds = [...new Set([...rawBatchIds, singleBatchId].filter(Boolean))];
      await setCachedUser("student", payload.sub, user);
    }
  }

  validatePrincipalTokenClaims({ payload, principal: user });

  if (!canStudentAuthenticate(user)) {
    throw new ApiError(403, "Account is inactive", null, "ACCOUNT_INACTIVE");
  }

  req.user = user;
  req.collegeId = user.collegeId;
  req.collegeFilter = user.collegeId ? { collegeId: user.collegeId } : {};
  next();
});

const authenticatePlatformAdminCore = async (req) => {
  const payload = parseTokenPayload(req);
  const role = normalizeRole(payload.role);

  if (!isAdminLikeRole(role)) {
    throw new ApiError(403, "Admin role required");
  }

  await assertAccessTokenNotRevoked(payload);
  req.authIdentity = `user:${role}:${payload.sub}`;

  const cacheBucket = isCollegeAdminRole(role) ? "college-admin" : "admin";
  let admin = await getCachedUser(cacheBucket, payload.sub);

  if (!admin) {
    admin = await db.admin.findUnique({
      where: { id: payload.sub },
      include: {
        department: true,
        college: true,
      },
    });

    if (admin) {
      await setCachedUser(cacheBucket, payload.sub, admin);
    }
  }

  validatePrincipalTokenClaims({ payload, principal: admin });

  if (!admin || !admin.isActive || normalizeRole(admin.role) !== role) {
    throw new ApiError(401, "Invalid access token");
  }

  if (!admin.collegeId) {
    throw new ApiError(403, "Admin must be assigned to a college", null, "COLLEGE_SCOPE_REQUIRED");
  }

  if (isDepartmentAdminRole(role) && !admin.departmentId) {
    throw new ApiError(403, "Admin must be assigned to a department", null, "DEPARTMENT_SCOPE_REQUIRED");
  }

  req.admin = {
    ...admin,
    role,
    permissions: resolveAdminPermissions(admin),
  };
  req.collegeId = admin.collegeId;
  req.collegeFilter = { collegeId: admin.collegeId };
};

const authenticatePlatformAdmin = asyncHandler(async (req, _res, next) => {
  await authenticatePlatformAdminCore(req);
  next();
});

const authenticateAdmin = asyncHandler(async (req, res, next) => {
  await authenticatePlatformAdminCore(req);
  if (normalizeRole(req.admin?.role) !== ROLES.ADMIN) {
    throw new ApiError(403, "Admin role required");
  }
  next();
});

const authenticateCollegeAdmin = asyncHandler(async (req, res, next) => {
  await authenticatePlatformAdminCore(req);
  if (normalizeRole(req.admin?.role) !== ROLES.COLLEGE_ADMIN) {
    throw new ApiError(403, "College admin role required");
  }
  next();
});

const authenticateSuperAdmin = asyncHandler(async (req, _res, next) => {
  const payload = parseTokenPayload(req);
  const role = normalizeRole(payload.role);

  if (role !== ROLES.SUPER_ADMIN) {
    throw new ApiError(403, "Super admin role required");
  }

  await assertAccessTokenNotRevoked(payload);
  req.authIdentity = `user:${ROLES.SUPER_ADMIN}:${payload.sub}`;

  let superAdmin = await getCachedUser("superadmin", payload.sub);

  if (!superAdmin) {
    superAdmin = await db.superAdmin.findUnique({
      where: { id: payload.sub },
    });

    if (superAdmin) {
      await setCachedUser("superadmin", payload.sub, superAdmin);
    }
  }

  if (!superAdmin || !superAdmin.isActive || normalizeRole(superAdmin.role) !== ROLES.SUPER_ADMIN) {
    throw new ApiError(401, "Invalid access token");
  }

  validatePrincipalTokenClaims({ payload, principal: superAdmin });

  req.superAdmin = superAdmin;
  next();
});

const requireSameCollege = (fieldName = "collegeId") =>
  asyncHandler(async (req, _res, next) => {
    const bodyCollegeId = req.body?.[fieldName];
    const paramsCollegeId = req.params?.[fieldName];
    const queryCollegeId = req.query?.[fieldName];
    const candidate = bodyCollegeId || paramsCollegeId || queryCollegeId;

    if (candidate && req.collegeId && String(candidate) !== String(req.collegeId)) {
      throw new ApiError(403, "Cross-college access denied");
    }

    next();
  });

module.exports = {
  authenticate: authenticateStudent,
  authenticateStudent,
  authenticateAdmin,
  authenticateCollegeAdmin,
  authenticatePlatformAdmin,
  authenticateSuperAdmin,
  requireSameCollege,
};
