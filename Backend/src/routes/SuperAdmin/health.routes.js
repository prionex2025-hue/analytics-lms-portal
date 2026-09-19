const express = require("express");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { getSystemHealth, getRateLimitMetrics } = require("../../controllers/SuperAdmin/health.controller");

const router = express.Router();

router.get("/health", authenticateSuperAdmin, getSystemHealth);
router.get("/rate-limits", authenticateSuperAdmin, getRateLimitMetrics);

module.exports = router;
