const express = require("express");
const env = require("../../config/env");
const { authenticate } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { getReport, exportReport } = require("../../controllers/Students/reports.controller");

const router = express.Router();

const studentReportLimiter = createRateLimiter({
	scope: "student-report",
	routeLabel: "/api/reports",
	windowMs: env.rateLimit.studentReportWindowMs,
	max: env.rateLimit.studentReportMax,
	message: "Too many report requests in a short window. Please wait a moment.",
});

router.get("/", authenticate, studentReportLimiter, getReport);
router.get("/overview", authenticate, studentReportLimiter, getReport);
router.post("/export", authenticate, studentReportLimiter, exportReport);

module.exports = router;
