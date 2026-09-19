const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { updateAdminSettingsSchema, changeAdminPasswordSchema } = require("../../schemas/Admin/admin-core.schema");
const { getAdminSettings, updateAdminSettings, changeAdminPassword } = require("../../controllers/Admin/settings.controller");

const router = express.Router();

const adminSettingsLimiter = createRateLimiter({
	scope: "admin-settings",
	routeLabel: "/api/admin/settings/*",
	windowMs: env.rateLimit.adminSettingsWindowMs,
	max: env.rateLimit.adminSettingsMax,
	message: "Settings operations are rate limited. Please retry shortly.",
});

router.get("/", authenticatePlatformAdmin, adminSettingsLimiter, getAdminSettings);
router.patch("/", authenticatePlatformAdmin, adminSettingsLimiter, validate(updateAdminSettingsSchema), updateAdminSettings);
router.patch("/password", authenticatePlatformAdmin, adminSettingsLimiter, validate(changeAdminPasswordSchema), changeAdminPassword);

module.exports = router;
