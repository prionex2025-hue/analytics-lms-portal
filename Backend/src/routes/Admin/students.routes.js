const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const {
	studentFiltersSchema,
	createStudentSchema,
	assignStudentBatchSchema,
	studentIdParamSchema,
	studentBulkImportSchema,
	promoteStudentsYearSchema,
	studentBulkImportJobParamSchema,
} = require("../../schemas/Admin/admin-core.schema");
const studentsValidationController = require("../../controllers/Admin/students-with-validation.controller");
const studentsController = require("../../controllers/Admin/students.controller");

const router = express.Router();

const adminStudentReadLimiter = createRateLimiter({
	scope: "admin-student-read",
	routeLabel: "/api/admin/students/*",
	windowMs: env.rateLimit.adminEntityReadWindowMs,
	max: env.rateLimit.adminEntityReadMax,
	message: "Student directory reads are rate limited. Please retry shortly.",
});

const adminStudentWriteLimiter = createRateLimiter({
	scope: "admin-student-write",
	routeLabel: "/api/admin/students/*",
	windowMs: env.rateLimit.adminEntityWriteWindowMs,
	max: env.rateLimit.adminEntityWriteMax,
	message: "Student management actions are rate limited. Please retry shortly.",
});

router.get("/", authenticatePlatformAdmin, adminStudentReadLimiter, requireAnyPermission("manage_students", "view_students"), validate(studentFiltersSchema), studentsValidationController.getStudents);
router.post("/", authenticatePlatformAdmin, adminStudentWriteLimiter, requirePermission("manage_students"), validate(createStudentSchema), studentsController.createStudent);
router.post("/bulk-import", authenticatePlatformAdmin, adminStudentWriteLimiter, requirePermission("manage_students", "bulk_import"), validate(studentBulkImportSchema), studentsController.bulkImportStudents);
router.patch("/promote-year", authenticatePlatformAdmin, adminStudentWriteLimiter, requirePermission("manage_students"), validate(promoteStudentsYearSchema), studentsController.promoteStudentsYear);
router.get("/import-jobs/:jobId", authenticatePlatformAdmin, adminStudentReadLimiter, requirePermission("manage_students", "bulk_import"), validate(studentBulkImportJobParamSchema), studentsController.getStudentImportJob);
router.get("/:studentId", authenticatePlatformAdmin, adminStudentReadLimiter, requireAnyPermission("manage_students", "view_students"), validate(studentIdParamSchema), studentsController.getStudentProfile);
router.get("/:studentId/performance", authenticatePlatformAdmin, adminStudentReadLimiter, requireAnyPermission("manage_students", "view_students"), requirePermission("view_reports"), studentsController.getStudentPerformance);
router.patch("/:studentId/assign-batch", authenticatePlatformAdmin, adminStudentWriteLimiter, requirePermission("manage_students", "manage_batches"), validate(assignStudentBatchSchema), studentsController.assignStudentToBatch);

module.exports = router;
