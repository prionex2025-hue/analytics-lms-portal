const bcrypt = require("bcrypt");
const models = require("../../models");
const { createAccessToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");
const { ROLES, normalizeRole } = require("../../constants/roles");
const { recordSuperAdminLogin, toPublicSuperAdmin } = require("../../services/super-admin.service");
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
const {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} = require("../../services/login-attempt.service");
const { recordSecurityEvent } = require("../../services/security-audit.service");
const { buildRefreshCookieOptions } = require("../../utils/refresh-cookie");

const SUPER_ADMIN_REFRESH_COOKIE = "lms_super_admin_refresh_token";
const SUPER_ADMIN_AUTH_COOKIE_PATHS = ["/api/super-admin/auth", "/api/superadmin/auth"];

const getRefreshCookieOptions = (path = "/api/super-admin/auth", { keepLoggedIn = false } = {}) =>
  buildRefreshCookieOptions({ path, keepLoggedIn });

const setRefreshCookie = (res, refreshToken, { keepLoggedIn = false } = {}) => {
  SUPER_ADMIN_AUTH_COOKIE_PATHS.forEach((path) => {
    res.cookie(SUPER_ADMIN_REFRESH_COOKIE, refreshToken, getRefreshCookieOptions(path, { keepLoggedIn }));
  });
};

const clearRefreshCookie = (res) => {
  SUPER_ADMIN_AUTH_COOKIE_PATHS.forEach((path) => {
    res.clearCookie(SUPER_ADMIN_REFRESH_COOKIE, getRefreshCookieOptions(path));
  });
};

const performSuperAdminLogin = async (req, res) => {
  const { email, password, keepLoggedIn = false } = req.body;
  const loginIdentifier = email;
  await assertLoginAllowed({ scope: "super-admin", identifier: loginIdentifier });

  const m = await models.init();
  const SuperAdmin = m.dbClient.superAdmin;
  const superAdmin = await SuperAdmin.findFirst({
    where: {
      email: { equals: String(email || "").trim().toLowerCase(), mode: "insensitive" },
      role: ROLES.SUPER_ADMIN,
    }
  });

  if (!superAdmin || !superAdmin.isActive || normalizeRole(superAdmin.role) !== ROLES.SUPER_ADMIN) {
    await recordLoginFailure({ scope: "super-admin", identifier: loginIdentifier });
    await recordSecurityEvent({
      action: "SUPER_ADMIN_LOGIN_FAILED",
      req,
      targetType: "SUPER_ADMIN_AUTH",
      targetId: "unknown",
      outcome: "failed",
      metadata: { reason: "invalid_credentials" },
    });
    throw new ApiError(401, "Invalid credentials");
  }

  const isMatch = await bcrypt.compare(password, superAdmin.passwordHash);
  if (!isMatch) {
    await recordLoginFailure({ scope: "super-admin", identifier: loginIdentifier });
    await recordSecurityEvent({
      action: "SUPER_ADMIN_LOGIN_FAILED",
      req,
      targetType: "SUPER_ADMIN_AUTH",
      targetId: superAdmin.id,
      superAdminId: superAdmin.id,
      outcome: "failed",
      metadata: { reason: "invalid_credentials" },
    });
    throw new ApiError(401, "Invalid credentials");
  }

  await clearLoginFailures({ scope: "super-admin", identifier: loginIdentifier });
  await recordSecurityEvent({
    action: "SUPER_ADMIN_LOGIN_SUCCEEDED",
    req,
    targetType: "SUPER_ADMIN_AUTH",
    targetId: superAdmin.id,
    superAdminId: superAdmin.id,
    outcome: "succeeded",
  });

  const accessToken = createAccessToken(superAdmin);
  const { refreshToken } = await createRefreshTokenRecord({
    db: m.dbClient,
    modelName: "superAdminRefreshToken",
    scope: "super-admin",
    principal: superAdmin,
    ownerField: "superAdminId",
    metadata: { keepLoggedIn: Boolean(keepLoggedIn) },
  });
  setRefreshCookie(res, refreshToken, { keepLoggedIn });
  const updatedSuperAdmin = await recordSuperAdminLogin({ db: m.dbClient, superAdminId: superAdmin.id }) || superAdmin;

  res.status(200).json({
    accessToken,
    superAdmin: toPublicSuperAdmin(updatedSuperAdmin),
  });
};

const superAdminLogin = asyncHandler(performSuperAdminLogin);

const superAdminRefresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[SUPER_ADMIN_REFRESH_COOKIE] || req.body?.refreshToken;

  if (!refreshToken) {
    throw new ApiError(400, "Refresh token required");
  }

  const payload = verifyRefreshPayloadOrThrow(refreshToken);
  const m = await models.init();
  const db = m.dbClient;
  const dbToken = await findRefreshTokenRecord({
    db,
    modelName: "superAdminRefreshToken",
    scope: "super-admin",
    refreshToken,
  });
  await assertRefreshTokenRecordUsable({
    db,
    modelName: "superAdminRefreshToken",
    scope: "super-admin",
    ownerField: "superAdminId",
    record: dbToken,
    ownerId: payload.sub,
  });

  if (normalizeRole(payload.role) !== ROLES.SUPER_ADMIN) {
    throw new ApiError(401, "Invalid refresh token role");
  }

  const superAdmin = await db.superAdmin.findUnique({ where: { id: payload.sub } });
  if (!superAdmin || !superAdmin.isActive || normalizeRole(superAdmin.role) !== ROLES.SUPER_ADMIN) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const accessToken = createAccessToken(superAdmin);
  const keepLoggedIn = dbToken.keepLoggedIn === true;
  const { refreshToken: newRefreshToken, refreshRecord } = await rotateRefreshTokenRecord({
    db,
    modelName: "superAdminRefreshToken",
    scope: "super-admin",
    ownerField: "superAdminId",
    oldRefreshToken: refreshToken,
    oldRecord: dbToken,
    principal: superAdmin,
    metadata: { keepLoggedIn },
  });
  setRefreshCookie(res, newRefreshToken, { keepLoggedIn });

  res.status(200).json({
    accessToken,
    sessionId: refreshRecord.id,
  });
});

const superAdminLogout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[SUPER_ADMIN_REFRESH_COOKIE] || req.body?.refreshToken;
  await revokeAccessTokenFromRequest(req);

  if (refreshToken) {
    const db = (await models.init()).dbClient;
    await revokeRefreshTokenValue({
      db,
      modelName: "superAdminRefreshToken",
      scope: "super-admin",
      refreshToken,
      reason: "logout",
    });
  }

  clearRefreshCookie(res);
  res.status(200).json({ message: "Logged out" });
});

const superAdminMe = asyncHandler(async (req, res) => {
  res.status(200).json(toPublicSuperAdmin(req.superAdmin));
});

const superAdminForgotPassword = asyncHandler(async (req, res) => {
  const result = await requestPasswordReset({
    scope: "super-admin",
    portal: "super-admin",
    identifier: req.body?.email,
    req,
  });
  res.status(202).json(result);
});

const superAdminResetPassword = asyncHandler(async (req, res) => {
  const result = await resetPasswordWithToken({
    scope: "super-admin",
    token: req.body?.token,
    password: req.body?.password,
  });
  res.status(200).json(result);
});

module.exports = {
  performSuperAdminLogin,
  superAdminLogin,
  superAdminRefresh,
  superAdminLogout,
  superAdminMe,
  superAdminForgotPassword,
  superAdminResetPassword,
};
