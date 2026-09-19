const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { updatePlatformSettingsSchema, changeSuperAdminPasswordSchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const { getPlatformSettings, updatePlatformSettings, changeSuperAdminPassword } = require("../../controllers/SuperAdmin/settings.controller");

const router = express.Router();

const superAdminSettingsLimiter = createRateLimiter({
  scope: "super-admin-settings",
  routeLabel: "/api/super-admin/settings/*",
  windowMs: env.rateLimit.adminSettingsWindowMs,
  max: env.rateLimit.adminSettingsMax,
  message: "Settings operations are rate limited. Please retry shortly.",
});

router.get("/", authenticateSuperAdmin, superAdminSettingsLimiter, getPlatformSettings);
router.patch("/", authenticateSuperAdmin, superAdminSettingsLimiter, validate(updatePlatformSettingsSchema), updatePlatformSettings);
router.patch(
  "/password",
  authenticateSuperAdmin,
  superAdminSettingsLimiter,
  validate(changeSuperAdminPasswordSchema),
  changeSuperAdminPassword
);

module.exports = router;
