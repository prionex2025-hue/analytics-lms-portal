const express = require("express");
const { authenticate } = require("../../middleware/auth");
const { imageUpload } = require("../../middleware/upload");
const validate = require("../../middleware/validate");
const {
  changePasswordSchema,
  updatePreferencesSchema,
  accountDeletionSchema,
} = require("../../schemas/Students/profile.schema");
const {
  getProfile,
  uploadAvatar,
  changePassword,
  updatePreferences,
  requestAccountDeletion,
} = require("../../controllers/Students/profile.controller");

const router = express.Router();

router.get("/", authenticate, getProfile);
router.post("/avatar", authenticate, imageUpload.single("avatar"), uploadAvatar);
router.patch("/password", authenticate, validate(changePasswordSchema), changePassword);
router.patch("/preferences", authenticate, validate(updatePreferencesSchema), updatePreferences);
router.delete("/", authenticate, validate(accountDeletionSchema), requestAccountDeletion);

module.exports = router;
