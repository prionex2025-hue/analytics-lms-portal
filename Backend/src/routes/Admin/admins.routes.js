const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const {
  managedAdminListQuerySchema,
  createManagedAdminSchema,
  updateManagedAdminSchema,
  resetManagedAdminPasswordSchema,
  deactivateManagedAdminSchema,
} = require("../../schemas/Admin/admin-management.schema");
const {
  getManagedAdmins,
  createManagedAdmin,
  updateManagedAdmin,
  resetManagedAdminPassword,
  deactivateManagedAdmin,
} = require("../../controllers/Admin/admins.controller");

const router = express.Router();

const adminManagedAdminReadLimiter = createRateLimiter({
  scope: "admin-managed-admin-read",
  routeLabel: "/api/admin/admins/*",
  windowMs: env.rateLimit.adminEntityReadWindowMs,
  max: env.rateLimit.adminEntityReadMax,
  message: "Admin management reads are rate limited. Please retry shortly.",
});

const adminManagedAdminWriteLimiter = createRateLimiter({
  scope: "admin-managed-admin-write",
  routeLabel: "/api/admin/admins/*",
  windowMs: env.rateLimit.adminEntityWriteWindowMs,
  max: env.rateLimit.adminEntityWriteMax,
  message: "Admin management actions are rate limited. Please retry shortly.",
});

router.get(
  "/",
  authenticatePlatformAdmin,
  adminManagedAdminReadLimiter,
  requirePermission("manage_admins"),
  validate(managedAdminListQuerySchema),
  getManagedAdmins
);
router.post(
  "/",
  authenticatePlatformAdmin,
  adminManagedAdminWriteLimiter,
  requirePermission("manage_admins"),
  validate(createManagedAdminSchema),
  createManagedAdmin
);
router.patch(
  "/:adminId",
  authenticatePlatformAdmin,
  adminManagedAdminWriteLimiter,
  requirePermission("manage_admins"),
  validate(updateManagedAdminSchema),
  updateManagedAdmin
);
router.patch(
  "/:adminId/reset-password",
  authenticatePlatformAdmin,
  adminManagedAdminWriteLimiter,
  requirePermission("manage_admins"),
  validate(resetManagedAdminPasswordSchema),
  resetManagedAdminPassword
);
router.delete(
  "/:adminId",
  authenticatePlatformAdmin,
  adminManagedAdminWriteLimiter,
  requirePermission("manage_admins"),
  validate(deactivateManagedAdminSchema),
  deactivateManagedAdmin
);

module.exports = router;
