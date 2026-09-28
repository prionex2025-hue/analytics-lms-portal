const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { createResponseCache } = require("../../middleware/response-cache");
const { createSuperReportSchema, escalatedAnomaliesQuerySchema, reviewSuperAnomalySchema, reportJobParamSchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const {
	generateSuperReport,
	getSuperReportAnalytics,
	getSuperReportTestsDashboard,
	getSuperReportTableDashboard,
	getPassoutCohorts,
	getSuperReportJobs,
	downloadSuperReport,
	regenerateSuperReportLink,
	getEscalatedAnomalies,
	getSuperReportJobStatus,
	reviewSuperAnomaly,
} = require("../../controllers/SuperAdmin/reports.controller");
const {
	exportSuperReportCsv,
	exportSuperReportXlsx,
	getSuperReportItemAnalysis,
	getSuperReportIntegrity,
	getSuperReportTrends,
	getSuperReportAtRisk,
} = require("../../controllers/SuperAdmin/advanced-reports.controller");

const router = express.Router();

// Short-TTL cache for read-heavy report analytics. Any super-admin report/test
// write busts the "super-analytics:all" tag via the invalidation hook.
const superReportCache = createResponseCache({
  scope: "super-report",
  ttlSeconds: 45,
  tagsBuilder: () => ["super-analytics:all"],
});

const superReportLimiter = createRateLimiter({
	scope: "super-report",
	routeLabel: "/api/super-admin/reports/*",
	windowMs: env.rateLimit.superReportWindowMs,
	max: env.rateLimit.superReportMax,
	failOpen: false,
	message: "Super admin reports are rate limited. Please wait a moment and retry.",
});

const superReportReadLimiter = createRateLimiter({
	scope: "super-report-read",
	routeLabel: "/api/super-admin/reports/*",
	windowMs: env.rateLimit.superReportReadWindowMs,
	max: env.rateLimit.superReportReadMax,
	message: "Super admin report reads are rate limited. Please wait a moment and retry.",
});

router.post("/generate", authenticateSuperAdmin, superReportLimiter, validate(createSuperReportSchema), generateSuperReport);
router.get("/", authenticateSuperAdmin, superReportReadLimiter, getSuperReportJobs);
router.get("/passout-cohorts", authenticateSuperAdmin, superReportReadLimiter, getPassoutCohorts);
router.get("/analytics", authenticateSuperAdmin, superReportReadLimiter, superReportCache, getSuperReportAnalytics);
router.get("/tests", authenticateSuperAdmin, superReportReadLimiter, superReportCache, getSuperReportTestsDashboard);
router.get("/table", authenticateSuperAdmin, superReportReadLimiter, superReportCache, getSuperReportTableDashboard);
router.get("/item-analysis", authenticateSuperAdmin, superReportReadLimiter, superReportCache, getSuperReportItemAnalysis);
router.get("/integrity", authenticateSuperAdmin, superReportReadLimiter, superReportCache, getSuperReportIntegrity);
router.get("/trends", authenticateSuperAdmin, superReportReadLimiter, superReportCache, getSuperReportTrends);
router.get("/at-risk", authenticateSuperAdmin, superReportReadLimiter, superReportCache, getSuperReportAtRisk);
router.get("/anomalies/escalations", authenticateSuperAdmin, superReportReadLimiter, validate(escalatedAnomaliesQuerySchema), getEscalatedAnomalies);
router.post("/anomalies/review", authenticateSuperAdmin, superReportLimiter, validate(reviewSuperAnomalySchema), reviewSuperAnomaly);
// Spreadsheet exports and job status are never cached: exports are generated
// files and status must reflect the live job.
router.get("/export.csv", authenticateSuperAdmin, superReportReadLimiter, exportSuperReportCsv);
router.get("/export.xlsx", authenticateSuperAdmin, superReportReadLimiter, exportSuperReportXlsx);
router.get("/jobs/:reportJobId/status", authenticateSuperAdmin, superReportReadLimiter, validate(reportJobParamSchema), getSuperReportJobStatus);
router.post("/jobs/:reportJobId/regenerate-link", authenticateSuperAdmin, superReportLimiter, validate(reportJobParamSchema), regenerateSuperReportLink);
router.get("/:reportJobId/download", authenticateSuperAdmin, superReportReadLimiter, validate(reportJobParamSchema), downloadSuperReport);

module.exports = router;
