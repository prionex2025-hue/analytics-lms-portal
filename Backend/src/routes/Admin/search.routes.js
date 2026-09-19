const express = require("express");
const env = require("../../config/env");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { createResponseCache } = require("../../middleware/response-cache");
const { adminSearch } = require("../../controllers/Admin/search.controller");

const router = express.Router();

const adminSearchCache = createResponseCache({
	scope: "admin-search",
	ttlSeconds: env.responseCache.adminSearchTtlSeconds,
	keyBuilder: (req) => JSON.stringify({
		q: String(req.query.q || "").trim().toLowerCase(),
		adminId: req.admin?.id || null,
		collegeId: req.admin?.collegeId || "unknown",
		departmentId: req.admin?.departmentId || null,
		role: req.admin?.role || null,
		permissions: Array.isArray(req.admin?.permissions) ? [...req.admin.permissions].sort() : [],
	}),
});

const adminSearchLimiter = createRateLimiter({
	scope: "admin-search",
	routeLabel: "/api/admin/search",
	windowMs: env.rateLimit.searchWindowMs,
	max: env.rateLimit.searchMax,
	message: "Search is temporarily rate limited. Please keep typing and retry.",
});

router.get("/", authenticatePlatformAdmin, adminSearchCache, adminSearchLimiter, adminSearch);

module.exports = router;


