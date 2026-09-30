const express = require("express");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { buildAuthRateLimiters } = require("../../middleware/auth-rate-limits");
const {
  adminForgotPasswordSchema,
  adminLoginSchema,
  adminRefreshSchema,
  adminResetPasswordSchema,
} = require("../../schemas/Admin/admin-auth.schema");
const {
  adminForgotPassword,
  adminLogin,
  adminRefresh,
  adminResetPassword,
  adminLogout,
  adminMe,
} = require("../../controllers/Admin/auth.controller");

const router = express.Router();
const limiters = buildAuthRateLimiters("admin");

router.post("/login", ...limiters.login, validate(adminLoginSchema), adminLogin);
router.post("/forgot-password", limiters.forgotPassword, validate(adminForgotPasswordSchema), adminForgotPassword);
router.post("/reset-password", limiters.resetPassword, validate(adminResetPasswordSchema), adminResetPassword);
router.post("/refresh", ...limiters.refresh, validate(adminRefreshSchema), adminRefresh);
router.post("/logout", adminLogout);
router.get("/me", authenticatePlatformAdmin, adminMe);

module.exports = router;
