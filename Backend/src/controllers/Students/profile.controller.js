const { asyncHandler } = require("../../utils/http");
const profileService = require("../../services/student-profile.service");
const { ApiError } = require("../../utils/http");

const getProfile = asyncHandler(async (req, res) => {
  const profile = await profileService.getProfile(req.user);
  res.status(200).json(profile);
});

const updateProfile = asyncHandler(async (req, res) => {
  const { fullName, phone } = req.body;
  const updated = await profileService.updateProfile(req.user.id, { fullName, phone });
  res.status(200).json(updated);
});

const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) throw new ApiError(400, "Avatar file is required", null, "AVATAR_REQUIRED");
  const previousPublicId = req.user.avatarPublicId || null;
  const updated = await profileService.uploadAvatar(req.user.id, req.file.buffer, req.file.mimetype, previousPublicId);
  res.status(200).json({ avatarUrl: updated.avatarUrl, avatar_url: updated.avatarUrl });
});

const changePassword = asyncHandler(async (req, res) => {
  const currentPassword = req.body?.currentPassword ?? req.body?.current_password;
  const newPassword = req.body?.newPassword ?? req.body?.new_password;
  const result = await profileService.changePassword(req.user.id, currentPassword, newPassword);
  res.status(200).json(result);
});

const updatePreferences = asyncHandler(async (req, res) => {
  const { preferences } = req.body;
  const result = await profileService.updatePreferences(req.user.id, preferences);
  res.status(200).json(result);
});

const requestAccountDeletion = asyncHandler(async (req, res) => {
  const currentPassword = req.body?.currentPassword ?? req.body?.current_password;
  const result = await profileService.requestAccountDeletion(req.user.id, currentPassword);
  res.status(202).json(result);
});

module.exports = {
  getProfile,
  updateProfile,
  uploadAvatar,
  changePassword,
  updatePreferences,
  requestAccountDeletion,
};
