const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { authKeyByIp, createRateLimiter } = require("../../middleware/rate-limit");
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

const superAdminForgotPasswordLimiter = createRateLimiter({
  scope: "super-admin-forgot-password",
  routeLabel: "/api/super-admin/auth/forgot-password",
  windowMs: env.rateLimit.superAdminPasswordResetWindowMs,
  max: env.rateLimit.superAdminPasswordResetMax,
  keySelector: authKeyByIp,
  failOpen: false,
  message: "Too many password reset requests. Please retry later.",
});

const superAdminResetPasswordLimiter = createRateLimiter({
  scope: "super-admin-reset-password",
  routeLabel: "/api/super-admin/auth/reset-password",
  windowMs: env.rateLimit.superAdminPasswordResetWindowMs,
  max: env.rateLimit.superAdminPasswordResetMax,
  keySelector: authKeyByIp,
  failOpen: false,
  message: "Too many password reset attempts. Please retry later.",
});

const superAdminLoginLimiter = createRateLimiter({
  scope: "super-admin-login",
  routeLabel: "/api/super-admin/auth/login",
  windowMs: env.rateLimit.authLoginWindowMs,
  max: env.rateLimit.authLoginMax,
  keySelector: authKeyByIp,
  failOpen: true,
  message: "Too many login attempts. Please retry in a few minutes.",
});

const superAdminRefreshLimiter = createRateLimiter({
  scope: "super-admin-refresh",
  routeLabel: "/api/super-admin/auth/refresh",
  windowMs: env.rateLimit.authRefreshWindowMs,
  max: env.rateLimit.authRefreshMax,
  keySelector: authKeyByIp,
  failOpen: true,
  message: "Too many token refresh requests. Please retry shortly.",
});

router.post("/login", superAdminLoginLimiter, validate(superAdminLoginSchema), superAdminLogin);
router.post("/forgot-password", superAdminForgotPasswordLimiter, validate(superAdminForgotPasswordSchema), superAdminForgotPassword);
router.post("/reset-password", superAdminResetPasswordLimiter, validate(superAdminResetPasswordSchema), superAdminResetPassword);
router.post("/refresh", superAdminRefreshLimiter, validate(superAdminRefreshSchema), superAdminRefresh);
router.post("/logout", superAdminLogout);
router.get("/me", authenticateSuperAdmin, superAdminMe);

module.exports = router;
