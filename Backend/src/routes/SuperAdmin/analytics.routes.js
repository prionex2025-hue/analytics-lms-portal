const express = require("express");
const env = require("../../config/env");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { getSuperAnalytics } = require("../../controllers/SuperAdmin/analytics.controller");

const router = express.Router();

const superAnalyticsReadLimiter = createRateLimiter({
  scope: "super-analytics-read",
  routeLabel: "/api/super-admin/analytics",
  windowMs: env.rateLimit.superReportReadWindowMs,
  max: env.rateLimit.superReportReadMax,
  message: "Super admin analytics are rate limited. Please wait a moment and retry.",
});

router.get("/", authenticateSuperAdmin, superAnalyticsReadLimiter, getSuperAnalytics);

module.exports = router;
