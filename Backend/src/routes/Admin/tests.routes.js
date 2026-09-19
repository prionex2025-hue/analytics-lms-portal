const express = require("express");
const db = require("../../config/db");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { requireSameDepartment, departmentMatch } = require("../../middleware/department-guard");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const {
	createAdminTestSchema,
	updateAdminTestSchema,
	testIdParamSchema,
	transitionTestStatusSchema,
	forceSubmitAttemptSchema,
	extendAttemptTimeSchema,
} = require("../../schemas/Admin/admin-tests.schema");
const { testAssignBatchSchema, testAssignDepartmentSchema } = require("../../schemas/Admin/admin-core.schema");
const {
	createTest,
	getTests,
	getTestById,
	getTestShareLink,
	duplicateTest,
	cloneTest,
	updateTest,
	deleteTest,
	publishTest,
	archiveTest,
	transitionTestStatus,
	getLiveMonitoring,
	forceSubmitAttempt,
	extendAttemptTime,
} = require("../../controllers/Admin/tests.controller");
const { assignTestToBatch, assignTestToDepartment } = require("../../controllers/Admin/batches.controller");

const router = express.Router();

const adminTestListLimiter = createRateLimiter({
	scope: "admin-test-list",
	routeLabel: "/api/admin/tests",
	windowMs: env.rateLimit.adminTestListWindowMs,
	max: env.rateLimit.adminTestListMax,
	message: "Test listing is rate limited. Please wait a moment and retry.",
});

const adminTestWriteLimiter = createRateLimiter({
	scope: "admin-test-write",
	routeLabel: "/api/admin/tests/*",
	windowMs: env.rateLimit.adminEntityWriteWindowMs,
	max: env.rateLimit.adminEntityWriteMax,
	failOpen: false,
	message: "Test management actions are rate limited. Please wait a moment and retry.",
});

const adminTestCreateLimiter = createRateLimiter({
	scope: "admin-test-create",
	routeLabel: "/api/admin/tests",
	windowMs: env.rateLimit.adminTestCreateWindowMs,
	max: env.rateLimit.adminTestCreateMax,
	failOpen: false,
	message: "Test creation is rate limited. Please wait a moment and retry.",
});

const adminTestUpdateLimiter = createRateLimiter({
	scope: "admin-test-update",
	routeLabel: "/api/admin/tests/:testId",
	windowMs: env.rateLimit.adminTestUpdateWindowMs,
	max: env.rateLimit.adminTestUpdateMax,
	failOpen: false,
	message: "Test updates are rate limited. Please wait a moment and retry.",
});

const adminTestPublishLimiter = createRateLimiter({
	scope: "admin-test-publish",
	routeLabel: "/api/admin/tests/:testId/publish",
	windowMs: env.rateLimit.adminTestPublishWindowMs,
	max: env.rateLimit.adminTestPublishMax,
	failOpen: false,
	message: "Test publishing is rate limited. Please wait a moment and retry.",
});

const adminTestCloneLimiter = createRateLimiter({
	scope: "admin-test-clone",
	routeLabel: "/api/admin/tests/:testId/clone",
	windowMs: env.rateLimit.adminTestCloneWindowMs,
	max: env.rateLimit.adminTestCloneMax,
	failOpen: false,
	message: "Test cloning is rate limited. Please wait a moment and retry.",
});

const adminTestMonitoringWriteLimiter = createRateLimiter({
	scope: "admin-test-monitoring-write",
	routeLabel: "/api/admin/tests/:testId/monitoring/*",
	windowMs: env.rateLimit.adminTestMonitoringWriteWindowMs,
	max: env.rateLimit.adminTestMonitoringWriteMax,
	failOpen: false,
	message: "Live-monitoring actions are rate limited. Please wait a moment and retry.",
});

router.get(
	"/",
	authenticatePlatformAdmin,
	adminTestListLimiter,
	requireAnyPermission("edit_test", "manage_questions", "view_tests"),
	requireSameDepartment("departmentId"),
	getTests
);
router.get(
	"/:testId/share-link",
	authenticatePlatformAdmin,
	requireAnyPermission("edit_test", "manage_questions", "view_tests"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	getTestShareLink
);
router.get(
	"/:testId",
	authenticatePlatformAdmin,
	requireAnyPermission("edit_test", "manage_questions", "view_tests"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	getTestById
);
router.post(
	"/",
	authenticatePlatformAdmin,
	adminTestCreateLimiter,
	adminTestWriteLimiter,
	requirePermission("create_test", "manage_questions"),
	requireSameDepartment("departmentId"),
	validate(createAdminTestSchema),
	createTest
);
router.post(
	"/:testId/duplicate",
	authenticatePlatformAdmin,
	adminTestCloneLimiter,
	adminTestWriteLimiter,
	requirePermission("create_test", "edit_test"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	duplicateTest
);
const { cloneAdminTestSchema } = require("../../schemas/Admin/admin-tests.schema");
router.post(
	"/:testId/clone",
	authenticatePlatformAdmin,
	adminTestCloneLimiter,
	adminTestWriteLimiter,
	requirePermission("create_test", "edit_test"),
	validate(cloneAdminTestSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	cloneTest
);
router.patch(
	"/:testId",
	authenticatePlatformAdmin,
	adminTestUpdateLimiter,
	adminTestWriteLimiter,
	requirePermission("edit_test"),
	validate(updateAdminTestSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	updateTest
);
router.patch(
	"/:testId/status",
	authenticatePlatformAdmin,
	adminTestUpdateLimiter,
	adminTestWriteLimiter,
	requirePermission("edit_test"),
	validate(transitionTestStatusSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	transitionTestStatus
);
router.patch(
	"/:testId/archive",
	authenticatePlatformAdmin,
	adminTestUpdateLimiter,
	adminTestWriteLimiter,
	requirePermission("edit_test"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	archiveTest
);
router.delete(
	"/:testId",
	authenticatePlatformAdmin,
	adminTestUpdateLimiter,
	adminTestWriteLimiter,
	requirePermission("delete_test"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	deleteTest
);
router.post(
	"/:testId/publish",
	authenticatePlatformAdmin,
	adminTestPublishLimiter,
	adminTestWriteLimiter,
	requirePermission("publish_test"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	publishTest
);
router.get(
	"/:testId/monitoring",
	authenticatePlatformAdmin,
	requireAnyPermission("edit_test", "view_tests"),
	validate(testIdParamSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	getLiveMonitoring
);
router.post(
	"/:testId/monitoring/force-submit",
	authenticatePlatformAdmin,
	adminTestMonitoringWriteLimiter,
	adminTestWriteLimiter,
	requirePermission("edit_test"),
	validate(forceSubmitAttemptSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	forceSubmitAttempt
);
router.post(
	"/:testId/monitoring/extend-time",
	authenticatePlatformAdmin,
	adminTestMonitoringWriteLimiter,
	adminTestWriteLimiter,
	requirePermission("edit_test"),
	validate(extendAttemptTimeSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	extendAttemptTime
);
router.post(
	"/:testId/assign-batch",
	authenticatePlatformAdmin,
	adminTestUpdateLimiter,
	adminTestWriteLimiter,
	requirePermission("edit_test", "manage_batches"),
	validate(testAssignBatchSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	assignTestToBatch
);
router.post(
	"/:testId/assign-department",
	authenticatePlatformAdmin,
	adminTestUpdateLimiter,
	adminTestWriteLimiter,
	requirePermission("edit_test", "manage_batches"),
	validate(testAssignDepartmentSchema),
	departmentMatch(async (id) => db.test.findFirst({ where: { id } })),
	assignTestToDepartment
);

module.exports = router;


