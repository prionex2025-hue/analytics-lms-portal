const express = require("express");
const validate = require("../../middleware/validate");
const { imageUpload } = require("../../middleware/upload");
const { normalizeEventForm } = require("../../middleware/normalize-event-form");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { paginationQuerySchema, createGlobalEventSchema, updateGlobalEventSchema, globalEventIdParamSchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const { getEventsGlobal, createGlobalEvent, updateGlobalEvent, deleteGlobalEvent } = require("../../controllers/SuperAdmin/events.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getEventsGlobal);
router.post("/", authenticateSuperAdmin, imageUpload.single("eventImage"), normalizeEventForm, validate(createGlobalEventSchema), createGlobalEvent);
router.patch("/:eventId", authenticateSuperAdmin, imageUpload.single("eventImage"), normalizeEventForm, validate(updateGlobalEventSchema), updateGlobalEvent);
router.delete("/:eventId", authenticateSuperAdmin, validate(globalEventIdParamSchema), deleteGlobalEvent);

module.exports = router;
