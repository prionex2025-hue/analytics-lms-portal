const bcrypt = require("bcrypt");
const models = require("../models");
const { ApiError } = require("../utils/http");
const { deleteAsset, uploadImageBuffer } = require("./cloudinary.service");
const { invalidateRefreshTokenRecord } = require("./refresh-token-cache.service");
const { bumpPrincipalTokenVersion, invalidatePrincipalAuthCache } = require("./auth-revocation.service");
const { createAuditLog } = require("./audit.service");
const { STUDENT_LIFECYCLE_STATUS } = require("./student-lifecycle.service");
const { toPublicStudent } = require("../utils/serializers");

const getProfile = async (user) => toPublicStudent(user);

const updateProfile = async (userId, data) => {
  const m = await models.init();
  const db = m.dbClient;
  const updated = await db.student.update({ where: { id: userId }, data: { fullName: data.fullName ?? undefined, phone: data.phone ?? undefined } });
  await invalidatePrincipalAuthCache("student", userId);
  return toPublicStudent(updated);
};

const uploadAvatar = async (userId, buffer, mimetype, previousPublicId) => {
  if (!buffer) throw new ApiError(400, "Avatar file is required", null, "AVATAR_REQUIRED");
  const uploaded = await uploadImageBuffer(buffer, { folder: "avatars", publicIdPrefix: `student-${userId}`, mimeType: mimetype });
  const m = await models.init();
  const db = m.dbClient;
  const updated = await db.student.update({ where: { id: userId }, data: { avatarUrl: uploaded.url, avatarPublicId: uploaded.publicId } });
  await invalidatePrincipalAuthCache("student", userId);
  if (previousPublicId && previousPublicId !== uploaded.publicId) {
    try { await deleteAsset(previousPublicId); } catch {} // ignore cleanup errors
  }
  return updated;
};

const revokeStudentRefreshTokens = async (db, userId) => {
  const activeTokens = await db.studentRefreshToken.findMany({
    where: { userId, revokedAt: null },
  });

  await db.studentRefreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await Promise.all(activeTokens.map((record) => invalidateRefreshTokenRecord("student", record)));
};

const changePassword = async (userId, currentPassword, newPassword) => {
  const m = await models.init();
  const db = m.dbClient;
  const user = await db.student.findUnique({ where: { id: userId } });
  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Current password and new password are required", null, "PASSWORDS_REQUIRED");
  }
  if (!user?.passwordHash) {
    throw new ApiError(400, "Student password is not set", null, "PASSWORD_NOT_SET");
  }
  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) throw new ApiError(400, "Current password is incorrect");
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.student.update({ where: { id: userId }, data: { passwordHash } });
  await bumpPrincipalTokenVersion(db, "student", userId);
  await revokeStudentRefreshTokens(db, userId);
  return { message: "Password updated" };
};

const updatePreferences = async (userId, preferences) => {
  const m = await models.init();
  const db = m.dbClient;
  const updated = await db.student.update({ where: { id: userId }, data: { preferences } });
  await invalidatePrincipalAuthCache("student", userId);
  return { preferences: updated.preferences };
};

const requestAccountDeletion = async (userId, currentPassword) => {
  const m = await models.init();
  const db = m.dbClient;
  const user = await db.student.findUnique({ where: { id: userId } });

  if (!user) {
    throw new ApiError(404, "Student not found");
  }

  if (!currentPassword) {
    throw new ApiError(400, "Current password is required", null, "PASSWORD_REQUIRED");
  }

  const matches = await bcrypt.compare(currentPassword, user.passwordHash || "");
  if (!matches) {
    throw new ApiError(400, "Current password is incorrect", null, "PASSWORD_INCORRECT");
  }

  const now = new Date();
  const anonymizedEmail = `deleted-${user.id}@deleted.analyticsedify.local`;
  const anonymizedName = `Deleted Student ${String(user.id).slice(-6)}`;

  const updated = await db.student.update({
    where: { id: userId },
    data: {
      fullName: anonymizedName,
      email: anonymizedEmail,
      phone: null,
      avatarUrl: null,
      avatarPublicId: null,
      preferences: {},
      isActive: false,
      lifecycleStatus: STUDENT_LIFECYCLE_STATUS.DROPPED,
      disabledReason: "USER_DELETION_REQUEST",
      disabledAt: now,
    },
  });

  await bumpPrincipalTokenVersion(db, "student", userId);
  await revokeStudentRefreshTokens(db, userId);
  await invalidatePrincipalAuthCache("student", userId);

  if (user.avatarPublicId) {
    try { await deleteAsset(user.avatarPublicId); } catch {}
  }

  await createAuditLog({
    action: "STUDENT_ACCOUNT_DELETION_REQUESTED",
    targetType: "STUDENT",
    targetId: userId,
    collegeId: user.collegeId || null,
    beforeState: {
      isActive: user.isActive,
      lifecycleStatus: user.lifecycleStatus,
    },
    afterState: {
      isActive: updated.isActive,
      lifecycleStatus: updated.lifecycleStatus,
      disabledReason: updated.disabledReason,
      disabledAt: updated.disabledAt,
    },
  });

  return { message: "Account deletion request processed" };
};

module.exports = { getProfile, updateProfile, uploadAvatar, changePassword, updatePreferences, requestAccountDeletion };
