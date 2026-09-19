const bcrypt = require("bcrypt");
const models = require("../../models");
const { createAccessToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");
const { resolveAdminPermissions } = require("../../constants/admin-access-profiles");
const { ROLES, normalizeRole, isAdminLikeRole } = require("../../constants/roles");
const {
  assertRefreshTokenRecordUsable,
  createRefreshTokenRecord,
  findRefreshTokenRecord,
  revokeRefreshTokenValue,
  rotateRefreshTokenRecord,
  verifyRefreshPayloadOrThrow,
} = require("../../services/refresh-token-session.service");
const { revokeAccessTokenFromRequest } = require("../../services/access-token-revocation.service");
const { requestPasswordReset, resetPasswordWithToken } = require("../../services/password-reset.service");
const { toPublicAdmin } = require("../../utils/serializers");
const {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} = require("../../services/login-attempt.service");
const { recordSecurityEvent } = require("../../services/security-audit.service");
const { buildRefreshCookieOptions } = require("../../utils/refresh-cookie");

const ADMIN_REFRESH_COOKIE = "lms_admin_refresh_token";

const getRefreshCookieOptions = (path = "/api/admin/auth", { keepLoggedIn = false } = {}) =>
  buildRefreshCookieOptions({ path, keepLoggedIn });

const adminLogin = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { email, password, keepLoggedIn = false } = req.body;
  const loginIdentifier = email;
  const loginScope = req.baseUrl && req.baseUrl.startsWith("/api/college-admin/auth") ? "college-admin" : "admin";
  await assertLoginAllowed({ scope: loginScope, identifier: loginIdentifier });

  const admin = await db.admin.findFirst({
    where: {
      email,
      isActive: true,
    },
    include: {
      college: true,
      department: true,
    },
  });

  if (!admin) {
    await recordLoginFailure({ scope: loginScope, identifier: loginIdentifier });
    await recordSecurityEvent({
      action: "ADMIN_LOGIN_FAILED",
      req,
      targetType: "ADMIN_AUTH",
      targetId: "unknown",
      outcome: "failed",
      metadata: { portal: loginScope, reason: "invalid_credentials" },
    });
    throw new ApiError(401, "Invalid credentials");
  }

  const isMatch = await bcrypt.compare(password, admin.passwordHash);
  if (!isMatch) {
    await recordLoginFailure({ scope: loginScope, identifier: loginIdentifier });
    await recordSecurityEvent({
      action: "ADMIN_LOGIN_FAILED",
      req,
      targetType: "ADMIN_AUTH",
      targetId: admin.id,
      collegeId: admin.collegeId || null,
      adminId: admin.id,
      outcome: "failed",
      metadata: { portal: loginScope, reason: "invalid_credentials" },
    });
    throw new ApiError(401, "Invalid credentials");
  }

  await clearLoginFailures({ scope: loginScope, identifier: loginIdentifier });
  await recordSecurityEvent({
    action: "ADMIN_LOGIN_SUCCEEDED",
    req,
    targetType: "ADMIN_AUTH",
    targetId: admin.id,
    collegeId: admin.collegeId || null,
    adminId: admin.id,
    outcome: "succeeded",
    metadata: { portal: loginScope, role: normalizeRole(admin.role) },
  });

  const permissions = resolveAdminPermissions(admin);
  const accessToken = createAccessToken({ ...admin, permissions });
  const { refreshToken } = await createRefreshTokenRecord({
    db,
    modelName: "adminRefreshToken",
    scope: "admin",
    principal: admin,
    ownerField: "adminId",
    metadata: { keepLoggedIn: Boolean(keepLoggedIn) },
  });
  const cookiePath = req.baseUrl && req.baseUrl.startsWith("/api/college-admin/auth")
    ? "/api/college-admin/auth"
    : "/api/admin/auth";
  res.cookie(ADMIN_REFRESH_COOKIE, refreshToken, getRefreshCookieOptions(cookiePath, { keepLoggedIn }));

  res.status(200).json({
    accessToken,
    admin: toPublicAdmin({ ...admin, permissions }),
  });
});

const adminRefresh = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const refreshToken = req.cookies?.[ADMIN_REFRESH_COOKIE] || req.body?.refreshToken;

  if (!refreshToken) {
    throw new ApiError(400, "Refresh token required");
  }

  const payload = verifyRefreshPayloadOrThrow(refreshToken);
  const dbToken = await findRefreshTokenRecord({
    db,
    modelName: "adminRefreshToken",
    scope: "admin",
    refreshToken,
  });
  await assertRefreshTokenRecordUsable({
    db,
    modelName: "adminRefreshToken",
    scope: "admin",
    ownerField: "adminId",
    record: dbToken,
    ownerId: payload.sub,
  });

  const tokenRole = normalizeRole(payload.role);
  if (!isAdminLikeRole(tokenRole)) {
    throw new ApiError(401, "Invalid refresh token role");
  }

  const admin = await db.admin.findUnique({ where: { id: payload.sub } });
  if (!admin || !admin.isActive) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const adminRole = normalizeRole(admin.role || ROLES.ADMIN);
  if (adminRole !== tokenRole) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const permissions = resolveAdminPermissions(admin);
  const keepLoggedIn = dbToken.keepLoggedIn === true;
  const newAccessToken = createAccessToken({ ...admin, permissions });
  const { refreshToken: newRefreshToken, refreshRecord } = await rotateRefreshTokenRecord({
    db,
    modelName: "adminRefreshToken",
    scope: "admin",
    ownerField: "adminId",
    oldRefreshToken: refreshToken,
    oldRecord: dbToken,
    principal: admin,
    metadata: { keepLoggedIn },
  });
  const cookiePath = req.baseUrl && req.baseUrl.startsWith("/api/college-admin/auth")
    ? "/api/college-admin/auth"
    : "/api/admin/auth";
  res.cookie(ADMIN_REFRESH_COOKIE, newRefreshToken, getRefreshCookieOptions(cookiePath, { keepLoggedIn }));

  res.status(200).json({
    accessToken: newAccessToken,
    sessionId: refreshRecord.id,
  });
});

const adminLogout = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const refreshToken = req.cookies?.[ADMIN_REFRESH_COOKIE] || req.body?.refreshToken;
  await revokeAccessTokenFromRequest(req);

  if (refreshToken) {
    await revokeRefreshTokenValue({
      db,
      modelName: "adminRefreshToken",
      scope: "admin",
      refreshToken,
      reason: "logout",
    });
  }

  ["/api/admin/auth", "/api/college-admin/auth"].forEach((path) => {
    res.clearCookie(ADMIN_REFRESH_COOKIE, getRefreshCookieOptions(path));
  });
  res.status(200).json({ message: "Logged out" });
});

const adminMe = asyncHandler(async (req, res) => {
  res.status(200).json(toPublicAdmin(req.admin));
});

const adminForgotPassword = asyncHandler(async (req, res) => {
  const result = await requestPasswordReset({
    scope: "admin",
    portal: String(req.baseUrl || req.originalUrl || "").includes("college-admin") ? "college-admin" : "admin",
    identifier: req.body?.email,
    req,
  });
  res.status(202).json(result);
});

const adminResetPassword = asyncHandler(async (req, res) => {
  const result = await resetPasswordWithToken({
    scope: "admin",
    token: req.body?.token,
    password: req.body?.password,
  });
  res.status(200).json(result);
});

module.exports = {
  adminLogin,
  adminRefresh,
  adminLogout,
  adminMe,
  adminForgotPassword,
  adminResetPassword,
};
