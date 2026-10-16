const express = require("express");
const validate = require("../../middleware/validate");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const { createRateLimiter } = require("../../middleware/rate-limit");
const env = require("../../config/env");
const {
  passoutEligibleQuerySchema,
  passoutPreviewSchema,
  passoutPromoteSchema,
  passoutJobParamSchema,
} = require("../../schemas/Admin/admin-core.schema");
const controller = require("../../controllers/Admin/passout.controller");

const router = express.Router();
const limiter = createRateLimiter({
  scope: "super-admin-passout",
  routeLabel: "/api/super-admin/passout/*",
  windowMs: env.rateLimit.adminEntityWriteWindowMs,
  max: env.rateLimit.adminEntityWriteMax,
  message: "Passout operations are rate limited. Please retry shortly.",
});

router.get("/eligible", requireAnyPermission("manage_students", "view_students"), validate(passoutEligibleQuerySchema), controller.getEligible);
router.post("/preview", requireAnyPermission("manage_students", "view_students"), validate(passoutPreviewSchema), controller.getPreview);
router.post("/promote", limiter, requirePermission("manage_students"), validate(passoutPromoteSchema), controller.promote);
router.get("/history", requireAnyPermission("manage_students", "view_students"), controller.getHistory);
router.get("/jobs/:jobId", requireAnyPermission("manage_students", "view_students"), validate(passoutJobParamSchema), controller.getJob);
router.post("/jobs/:jobId/retry", limiter, requirePermission("manage_students"), validate(passoutJobParamSchema), controller.retry);
router.get("/archives/students", requireAnyPermission("manage_students", "view_students"), controller.getArchivedStudents);
router.get("/archives/batches", requireAnyPermission("manage_platform","view_platform_settings","manage_colleges","view_colleges"), controller.getArchivedBatches);

module.exports = router;
