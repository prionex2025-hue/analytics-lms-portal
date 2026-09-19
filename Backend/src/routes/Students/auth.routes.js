const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticate } = require("../../middleware/auth");
const { authKeyByIp, createRateLimiter } = require("../../middleware/rate-limit");
const { forgotPasswordSchema, loginSchema, refreshSchema, resetPasswordSchema } = require("../../schemas/Students/auth.schema");
const { forgotPassword, login, refresh, resetPassword, logout, me } = require("../../controllers/Students/auth.controller");

const router = express.Router();

const studentForgotPasswordLimiter = createRateLimiter({
  scope: "student-forgot-password",
  routeLabel: "/api/auth/forgot-password",
  windowMs: env.rateLimit.authForgotPasswordWindowMs,
  max: env.rateLimit.authForgotPasswordMax,
  keySelector: authKeyByIp,
  failOpen: false,
  message: "Too many password reset requests. Please retry later.",
});

const studentResetPasswordLimiter = createRateLimiter({
  scope: "student-reset-password",
  routeLabel: "/api/auth/reset-password",
  windowMs: env.rateLimit.authResetPasswordWindowMs,
  max: env.rateLimit.authResetPasswordMax,
  keySelector: authKeyByIp,
  failOpen: false,
  message: "Too many password reset attempts. Please retry later.",
});

const studentLoginLimiter = createRateLimiter({
  scope: "student-login",
  routeLabel: "/api/auth/login",
  windowMs: env.rateLimit.authLoginWindowMs,
  max: env.rateLimit.authLoginMax,
  keySelector: authKeyByIp,
  failOpen: true,
  message: "Too many login attempts. Please retry in a few minutes.",
});

const studentRefreshLimiter = createRateLimiter({
  scope: "student-refresh",
  routeLabel: "/api/auth/refresh",
  windowMs: env.rateLimit.authRefreshWindowMs,
  max: env.rateLimit.authRefreshMax,
  keySelector: authKeyByIp,
  failOpen: true,
  message: "Too many token refresh requests. Please retry shortly.",
});

router.post("/login", studentLoginLimiter, validate(loginSchema), login);
router.post("/forgot-password", studentForgotPasswordLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", studentResetPasswordLimiter, validate(resetPasswordSchema), resetPassword);
router.post("/refresh", studentRefreshLimiter, validate(refreshSchema), refresh);
router.post("/logout", logout);
router.get("/me", authenticate, me);

module.exports = router;
