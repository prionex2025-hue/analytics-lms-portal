const express = require("express");
const env = require("../../config/env");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const { getCollegeAnalytics } = require("../../controllers/Admin/analytics.controller");

const router = express.Router();

const adminAnalyticsReadLimiter = createRateLimiter({
	scope: "admin-analytics-read",
	routeLabel: "/api/admin/analytics",
	windowMs: env.rateLimit.adminAnalyticsReadWindowMs,
	max: env.rateLimit.adminAnalyticsReadMax,
	message: "Analytics requests are rate limited. Please retry shortly.",
});

router.get("/", authenticatePlatformAdmin, adminAnalyticsReadLimiter, requirePermission("view_analytics"), getCollegeAnalytics);

module.exports = router;
