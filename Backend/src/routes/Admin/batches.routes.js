const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const {
	createBatchSchema,
	assignStudentsToBatchSchema,
	batchIdParamSchema,
	bulkBatchStudentsSchema,
	removeStudentFromBatchSchema,
} = require("../../schemas/Admin/admin-core.schema");
const batchesValidationController = require("../../controllers/Admin/batches-with-validation.controller");
const batchesController = require("../../controllers/Admin/batches.controller");

const router = express.Router();

const adminBatchGuardLimiter = createRateLimiter({
	scope: "admin-batch-guard",
	routeLabel: "/api/admin/batches/:batchId/guarded",
	windowMs: env.rateLimit.adminBatchGuardWindowMs,
	max: env.rateLimit.adminBatchGuardMax,
	message: "Batch safety checks are rate limited. Please wait a moment and retry.",
});

router.get("/", authenticatePlatformAdmin, requireAnyPermission("manage_batches", "view_batches"), batchesValidationController.getBatches);
router.get("/:batchId", authenticatePlatformAdmin, adminBatchGuardLimiter, requireAnyPermission("manage_batches", "view_batches"), validate(batchIdParamSchema), batchesValidationController.getBatchDetail);
router.post("/", authenticatePlatformAdmin, requirePermission("manage_batches"), validate(createBatchSchema), batchesValidationController.createBatchHandler);
router.patch("/:batchId/students", authenticatePlatformAdmin, requirePermission("manage_batches", "manage_students"), validate(assignStudentsToBatchSchema), batchesController.assignStudentsToBatch);
router.post("/:batchId/students/bulk", authenticatePlatformAdmin, requirePermission("manage_batches", "manage_students", "bulk_import"), validate(bulkBatchStudentsSchema), batchesController.bulkAddStudentsToBatch);
router.delete("/:batchId/students/:studentId", authenticatePlatformAdmin, adminBatchGuardLimiter, requirePermission("manage_batches", "manage_students"), validate(removeStudentFromBatchSchema), batchesController.removeStudentFromBatch);
router.patch("/:batchId/archive", authenticatePlatformAdmin, adminBatchGuardLimiter, requirePermission("manage_batches"), validate(batchIdParamSchema), batchesController.archiveBatch);
router.delete("/:batchId", authenticatePlatformAdmin, requirePermission("manage_batches"), batchesController.deleteBatch);

module.exports = router;


