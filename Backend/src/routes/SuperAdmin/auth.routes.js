const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { buildAuthRateLimiters } = require("../../middleware/auth-rate-limits");
const {
  superAdminForgotPasswordSchema,
  superAdminLoginSchema,
  superAdminRefreshSchema,
  superAdminResetPasswordSchema,
} = require("../../schemas/SuperAdmin/super-admin-auth.schema");
const {
  superAdminForgotPassword,
  superAdminLogin,
  superAdminRefresh,
  superAdminResetPassword,
  superAdminLogout,
  superAdminMe,
} = require("../../controllers/SuperAdmin/auth.controller");

const router = express.Router();
const limiters = buildAuthRateLimiters("super-admin");

router.post("/login", ...limiters.login, validate(superAdminLoginSchema), superAdminLogin);
router.post("/forgot-password", limiters.forgotPassword, validate(superAdminForgotPasswordSchema), superAdminForgotPassword);
router.post("/reset-password", limiters.resetPassword, validate(superAdminResetPasswordSchema), superAdminResetPassword);
router.post("/refresh", ...limiters.refresh, validate(superAdminRefreshSchema), superAdminRefresh);
router.post("/logout", superAdminLogout);
router.get("/me", authenticateSuperAdmin, superAdminMe);

module.exports = router;
