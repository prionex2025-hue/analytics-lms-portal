const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const {
	paginationQuerySchema,
	createGlobalTestSchema,
	cloneTestSchema,
	testIdParamSchema,
	updateGlobalTestSchema,
	transitionGlobalTestStatusSchema,
} = require("../../schemas/SuperAdmin/super-admin-core.schema");
const {
	forceSubmitAttemptSchema,
	extendAttemptTimeSchema,
} = require("../../schemas/Admin/admin-tests.schema");
const {
	getTestsGlobal,
	getGlobalTestById,
	createGlobalTest,
	cloneTestToCollege,
	updateGlobalTest,
	transitionGlobalTestStatus,
	getLiveMonitoring,
	forceSubmitAttempt,
	extendAttemptTime,
	deactivateTest,
	getGlobalTestShareLink,
} = require("../../controllers/SuperAdmin/tests.controller");

const router = express.Router();

const superAdminTestCreateLimiter = createRateLimiter({
	scope: "super-admin-test-create",
	routeLabel: "/api/super-admin/tests/global",
	windowMs: env.rateLimit.adminTestCreateWindowMs,
	max: env.rateLimit.adminTestCreateMax,
	failOpen: false,
	message: "Global test creation is rate limited. Please wait a moment and retry.",
});

const superAdminTestUpdateLimiter = createRateLimiter({
	scope: "super-admin-test-update",
	routeLabel: "/api/super-admin/tests/:testId",
	windowMs: env.rateLimit.adminTestUpdateWindowMs,
	max: env.rateLimit.adminTestUpdateMax,
	failOpen: false,
	message: "Global test updates are rate limited. Please wait a moment and retry.",
});

const superAdminTestCloneLimiter = createRateLimiter({
	scope: "super-admin-test-clone",
	routeLabel: "/api/super-admin/tests/:testId/clone",
	windowMs: env.rateLimit.adminTestCloneWindowMs,
	max: env.rateLimit.adminTestCloneMax,
	failOpen: false,
	message: "Global test cloning is rate limited. Please wait a moment and retry.",
});

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getTestsGlobal);
router.get("/:testId/monitoring", authenticateSuperAdmin, validate(testIdParamSchema), getLiveMonitoring);
router.post("/:testId/monitoring/force-submit", authenticateSuperAdmin, superAdminTestUpdateLimiter, validate(forceSubmitAttemptSchema), forceSubmitAttempt);
router.post("/:testId/monitoring/extend-time", authenticateSuperAdmin, superAdminTestUpdateLimiter, validate(extendAttemptTimeSchema), extendAttemptTime);
router.get("/:testId/share-link", authenticateSuperAdmin, validate(testIdParamSchema), getGlobalTestShareLink);
router.get("/:testId", authenticateSuperAdmin, validate(testIdParamSchema), getGlobalTestById);
router.post("/global", authenticateSuperAdmin, superAdminTestCreateLimiter, validate(createGlobalTestSchema), createGlobalTest);
router.post("/:testId/clone", authenticateSuperAdmin, superAdminTestCloneLimiter, validate(cloneTestSchema), cloneTestToCollege);
router.patch("/:testId", authenticateSuperAdmin, superAdminTestUpdateLimiter, validate(updateGlobalTestSchema), updateGlobalTest);
router.patch("/:testId/status", authenticateSuperAdmin, superAdminTestUpdateLimiter, validate(transitionGlobalTestStatusSchema), transitionGlobalTestStatus);
router.delete("/:testId", authenticateSuperAdmin, superAdminTestUpdateLimiter, validate(testIdParamSchema), deactivateTest);

module.exports = router;
