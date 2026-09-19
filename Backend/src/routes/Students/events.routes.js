const express = require("express");
const env = require("../../config/env");
const { authenticate } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { getEvents, registerEvent } = require("../../controllers/Students/events.controller");

const router = express.Router();

const eventRegisterLimiter = createRateLimiter({
	scope: "student-event-register",
	routeLabel: "/api/events/:eventId/register",
	windowMs: env.rateLimit.eventRegisterWindowMs,
	max: env.rateLimit.eventRegisterMax,
	keySelector: (req, actorIdentity) => `${actorIdentity}:event:${req.params?.eventId || "unknown-event"}`,
	message: "Too many event registration attempts. Please try again shortly.",
});

router.get("/", authenticate, getEvents);
router.post("/:eventId/register", authenticate, eventRegisterLimiter, registerEvent);

module.exports = router;
