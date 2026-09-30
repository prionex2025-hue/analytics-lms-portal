const express = require("express");
const validate = require("../../middleware/validate");
const { authenticate } = require("../../middleware/auth");
const { buildAuthRateLimiters } = require("../../middleware/auth-rate-limits");
const { forgotPasswordSchema, loginSchema, refreshSchema, resetPasswordSchema } = require("../../schemas/Students/auth.schema");
const { forgotPassword, login, refresh, resetPassword, logout, me } = require("../../controllers/Students/auth.controller");

const router = express.Router();
const limiters = buildAuthRateLimiters("student");

router.post("/login", ...limiters.login, validate(loginSchema), login);
router.post("/forgot-password", limiters.forgotPassword, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", limiters.resetPassword, validate(resetPasswordSchema), resetPassword);
router.post("/refresh", ...limiters.refresh, validate(refreshSchema), refresh);
router.post("/logout", logout);
router.get("/me", authenticate, me);

module.exports = router;
