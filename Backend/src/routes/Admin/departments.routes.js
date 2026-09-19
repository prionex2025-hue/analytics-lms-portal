const express = require("express");
const env = require("../../config/env");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const validate = require("../../middleware/validate");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const {
  getScopedDepartments,
  createScopedDepartment,
  updateScopedDepartment,
  deleteScopedDepartment,
} = require("../../controllers/Admin/departments-management.controller");
const {
  createScopedDepartmentSchema,
  updateScopedDepartmentSchema,
  deleteScopedDepartmentSchema,
} = require("../../schemas/Admin/admin-management.schema");

const router = express.Router();

const adminDepartmentReadLimiter = createRateLimiter({
  scope: "admin-department-read",
  routeLabel: "/api/admin/departments/*",
  windowMs: env.rateLimit.adminEntityReadWindowMs,
  max: env.rateLimit.adminEntityReadMax,
  message: "Department reads are rate limited. Please retry shortly.",
});

const adminDepartmentWriteLimiter = createRateLimiter({
  scope: "admin-department-write",
  routeLabel: "/api/admin/departments/*",
  windowMs: env.rateLimit.adminEntityWriteWindowMs,
  max: env.rateLimit.adminEntityWriteMax,
  message: "Department management actions are rate limited. Please retry shortly.",
});

router.get(
  "/",
  authenticatePlatformAdmin,
  adminDepartmentReadLimiter,
  requireAnyPermission("manage_batches", "view_batches", "manage_departments"),
  getScopedDepartments
);
router.post(
  "/",
  authenticatePlatformAdmin,
  adminDepartmentWriteLimiter,
  requirePermission("manage_departments"),
  validate(createScopedDepartmentSchema),
  createScopedDepartment
);
router.patch(
  "/:departmentId",
  authenticatePlatformAdmin,
  adminDepartmentWriteLimiter,
  requirePermission("manage_departments"),
  validate(updateScopedDepartmentSchema),
  updateScopedDepartment
);
router.delete(
  "/:departmentId",
  authenticatePlatformAdmin,
  adminDepartmentWriteLimiter,
  requirePermission("manage_departments"),
  validate(deleteScopedDepartmentSchema),
  deleteScopedDepartment
);

module.exports = router;
