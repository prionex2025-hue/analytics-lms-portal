const express = require("express");
const { authenticate } = require("../../middleware/auth");
const { imageUpload } = require("../../middleware/upload");
const {
  getProfile,
  updateProfile,
  uploadAvatar,
  changePassword,
  updatePreferences,
  requestAccountDeletion,
} = require("../../controllers/Students/profile.controller");

const router = express.Router();

router.get("/", authenticate, getProfile);
router.patch("/", authenticate, updateProfile);
router.post("/avatar", authenticate, imageUpload.single("avatar"), uploadAvatar);
router.patch("/password", authenticate, changePassword);
router.patch("/preferences", authenticate, updatePreferences);
router.delete("/", authenticate, requestAccountDeletion);

module.exports = router;
