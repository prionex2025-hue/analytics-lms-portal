const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { imageUpload } = require("../../middleware/upload");
const { normalizeEventForm } = require("../../middleware/normalize-event-form");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const { createEventSchema, updateEventSchema, eventIdParamSchema, cancelEventSchema } = require("../../schemas/Admin/admin-core.schema");
const { createEvent, getEvents, updateEvent, deleteEvent, getEventRegistrants, exportEventRegistrants, cancelEvent } = require("../../controllers/Admin/events.controller");

const router = express.Router();

const adminEventReadLimiter = createRateLimiter({
	scope: "admin-event-read",
	routeLabel: "/api/admin/events/*",
	windowMs: env.rateLimit.adminEntityReadWindowMs,
	max: env.rateLimit.adminEntityReadMax,
	message: "Event reads are rate limited. Please retry shortly.",
});

const adminEventWriteLimiter = createRateLimiter({
	scope: "admin-event-write",
	routeLabel: "/api/admin/events/*",
	windowMs: env.rateLimit.adminEntityWriteWindowMs,
	max: env.rateLimit.adminEntityWriteMax,
	message: "Event management actions are rate limited. Please retry shortly.",
});

router.get("/", authenticatePlatformAdmin, adminEventReadLimiter, requireAnyPermission("manage_events", "view_events"), getEvents);
router.post("/", authenticatePlatformAdmin, adminEventWriteLimiter, requirePermission("manage_events"), imageUpload.single("eventImage"), normalizeEventForm, validate(createEventSchema), createEvent);
router.patch("/:eventId", authenticatePlatformAdmin, adminEventWriteLimiter, requirePermission("manage_events"), imageUpload.single("eventImage"), normalizeEventForm, validate(updateEventSchema), updateEvent);
router.delete("/:eventId", authenticatePlatformAdmin, adminEventWriteLimiter, requirePermission("manage_events"), validate(eventIdParamSchema), deleteEvent);
router.get("/:eventId/registrants", authenticatePlatformAdmin, adminEventReadLimiter, requireAnyPermission("manage_events", "view_events"), validate(eventIdParamSchema), getEventRegistrants);
router.get("/:eventId/export", authenticatePlatformAdmin, adminEventReadLimiter, requireAnyPermission("manage_events", "view_events"), validate(eventIdParamSchema), exportEventRegistrants);
router.patch("/:eventId/cancel", authenticatePlatformAdmin, adminEventWriteLimiter, requirePermission("manage_events"), validate(cancelEventSchema), cancelEvent);

module.exports = router;
