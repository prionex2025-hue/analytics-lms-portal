const bcrypt = require("bcrypt");
const models = require("../../models");
const { createAccessToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");
const { ROLES, normalizeRole } = require("../../constants/roles");
const { performSuperAdminLogin } = require("../SuperAdmin/auth.controller");
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
  canStudentAuthenticate,
  normalizeStudentLifecycleStatus,
} = require("../../services/student-lifecycle.service");
const {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} = require("../../services/login-attempt.service");
const { recordSecurityEvent } = require("../../services/security-audit.service");
const { buildRefreshCookieOptions } = require("../../utils/refresh-cookie");

const STUDENT_REFRESH_COOKIE = "student_refresh_token";
const getEnrollmentDisplay = (user = {}) => user.enrollNumber || user.enrollmentNumber || user.studentId;

const buildStudentProfilePayload = (user = {}) => ({
  id: user.id,
  studentId: getEnrollmentDisplay(user),
  fullName: user.fullName,
  email: user.email,
  year: user.year ?? null,
  avatarUrl: user.avatarUrl || null,
  batch: user.batch || (Array.isArray(user.batches) ? user.batches[0] : null),
  batches: Array.isArray(user.batches) ? user.batches : [],
  batchIds: Array.isArray(user.batchIds) ? user.batchIds : [],
  department: user.department,
  college: user.college,
  preferences: user.preferences,
  lifecycleStatus: normalizeStudentLifecycleStatus(user.lifecycleStatus),
  isActive: user.isActive !== false,
});

const getRefreshCookieOptions = ({ keepLoggedIn = false } = {}) =>
  buildRefreshCookieOptions({ path: "/api/auth", keepLoggedIn });

const login = asyncHandler(async (req, res) => {
  if (normalizeRole(req.body?.role) === ROLES.SUPER_ADMIN) {
    return performSuperAdminLogin(req, res);
  }

  const { identifier, password, keepLoggedIn = false } = req.body;
  const loginIdentifier = identifier;
  await assertLoginAllowed({ scope: "student", identifier: loginIdentifier });

  const m = await models.init();
  const Student = m.Student;
  const User = m.User;

  let user = null;
  if (String(identifier || "").includes("@")) {
    // Try student collection first (students created via super-admin have email directly)
    user = await Student.findOne({ email: identifier }).lean();

    // Fallback: check if it's a user record for backwards compatibility
    if (!user) {
      const foundUser = await User.findOne({ email: identifier }).lean();
      if (foundUser) {
        // Check if there's a linked student record
        user = await Student.findOne({ userId: foundUser.id }).lean();
        if (user) {
          user = { ...foundUser, ...user };
        } else {
          // no student record but user exists
          user = foundUser;
        }
      }
    }
  } else {
    // Search by the entered enrollment number, with studentId fallback for older records.
    user = await Student.findOne({ $or: [{ studentId: identifier }, { enrollNumber: identifier }, { enrollmentNumber: identifier }] }).lean();
  }

  if (!user) {
    await recordLoginFailure({ scope: "student", identifier: loginIdentifier });
    await recordSecurityEvent({
      action: "STUDENT_LOGIN_FAILED",
      req,
      targetType: "STUDENT_AUTH",
      targetId: "unknown",
      outcome: "failed",
      metadata: { reason: "unknown_identifier" },
    });
    const isEmailIdentifier = String(identifier || "").includes("@");
    throw new ApiError(401, isEmailIdentifier ? "Email is wrong" : "Student ID is wrong", null, isEmailIdentifier ? "EMAIL_WRONG" : "IDENTIFIER_WRONG");
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    await recordLoginFailure({ scope: "student", identifier: loginIdentifier });
    await recordSecurityEvent({
      action: "STUDENT_LOGIN_FAILED",
      req,
      targetType: "STUDENT_AUTH",
      targetId: user.id,
      collegeId: user.collegeId || null,
      outcome: "failed",
      metadata: { reason: "bad_password" },
    });
    throw new ApiError(401, "Password is wrong", null, "PASSWORD_WRONG");
  }

  if (!canStudentAuthenticate(user)) {
    throw new ApiError(403, "Account is inactive", null, "ACCOUNT_INACTIVE");
  }

  await clearLoginFailures({ scope: "student", identifier: loginIdentifier });
  await recordSecurityEvent({
    action: "STUDENT_LOGIN_SUCCEEDED",
    req,
    targetType: "STUDENT_AUTH",
    targetId: user.id,
    collegeId: user.collegeId || null,
    outcome: "succeeded",
  });

  const accessToken = createAccessToken(user);
  const { refreshToken, refreshRecord } = await createRefreshTokenRecord({
    db: m.dbClient,
    modelName: "studentRefreshToken",
    scope: "student",
    principal: user,
    ownerField: "userId",
    type: "STUDENT",
    metadata: { keepLoggedIn: Boolean(keepLoggedIn) },
  });

  res.cookie(STUDENT_REFRESH_COOKIE, refreshToken, getRefreshCookieOptions({ keepLoggedIn }));

  res.status(200).json({
    accessToken,
    sessionId: refreshRecord.id,
    user: buildStudentProfilePayload(user),
  });
});

const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[STUDENT_REFRESH_COOKIE] || req.body?.refreshToken;

  if (!refreshToken) {
    throw new ApiError(400, "Refresh token required");
  }

  const payload = verifyRefreshPayloadOrThrow(refreshToken);
  const m = await models.init();
  const db = m.dbClient;
  const dbToken = await findRefreshTokenRecord({
    db,
    modelName: "studentRefreshToken",
    scope: "student",
    refreshToken,
  });
  await assertRefreshTokenRecordUsable({
    db,
    modelName: "studentRefreshToken",
    scope: "student",
    ownerField: "userId",
    record: dbToken,
    ownerId: payload.sub,
  });

  let userRecord = await db.student.findOne({ id: payload.sub }).lean();
  if (!userRecord) {
    // maybe payload.sub refers to User id
    userRecord = await db.user.findOne({ id: payload.sub }).lean();
  } else {
    const usr = await db.user.findOne({ id: userRecord.userId }).lean();
    userRecord = { ...usr, ...userRecord };
  }

  if (!userRecord) {
    throw new ApiError(401, "Invalid refresh token");
  }

  if (!canStudentAuthenticate(userRecord)) {
    throw new ApiError(403, "Account is inactive", null, "ACCOUNT_INACTIVE");
  }

  const newAccessToken = createAccessToken(userRecord);
  const keepLoggedIn = dbToken.keepLoggedIn !== false;
  const { refreshToken: newRefreshToken, refreshRecord } = await rotateRefreshTokenRecord({
    db,
    modelName: "studentRefreshToken",
    scope: "student",
    ownerField: "userId",
    oldRefreshToken: refreshToken,
    oldRecord: dbToken,
    principal: userRecord,
    type: "STUDENT",
    metadata: { keepLoggedIn },
  });

  res.cookie(STUDENT_REFRESH_COOKIE, newRefreshToken, getRefreshCookieOptions({ keepLoggedIn }));
  res.status(200).json({
    accessToken: newAccessToken,
    sessionId: refreshRecord.id,
    user: buildStudentProfilePayload(userRecord),
  });
});

const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[STUDENT_REFRESH_COOKIE] || req.body?.refreshToken;
  await revokeAccessTokenFromRequest(req);

  if (refreshToken) {
    const db = (await models.init()).dbClient;
    await revokeRefreshTokenValue({
      db,
      modelName: "studentRefreshToken",
      scope: "student",
      refreshToken,
      reason: "logout",
    });
  }

  res.clearCookie(STUDENT_REFRESH_COOKIE, {
    ...getRefreshCookieOptions(),
    maxAge: undefined,
  });

  res.status(200).json({ message: "Logged out" });
});

const me = asyncHandler(async (req, res) => {
  const user = req.user;
  res.status(200).json(buildStudentProfilePayload(user));
});

const forgotPassword = asyncHandler(async (req, res) => {
  const result = await requestPasswordReset({
    scope: "student",
    portal: "student",
    identifier: req.body?.identifier || req.body?.email,
    req,
  });
  res.status(202).json(result);
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await resetPasswordWithToken({
    scope: "student",
    token: req.body?.token,
    password: req.body?.password,
  });
  res.status(200).json(result);
});

module.exports = {
  login,
  refresh,
  logout,
  me,
  forgotPassword,
  resetPassword,
};
