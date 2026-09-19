const models = require("../../models");
const { asyncHandler, ApiError } = require("../../utils/http");
const { withRedisLock } = require("../../services/redis-lock.service");
const { getPagination } = require("../../utils/pagination");
const {
  buildEventFeedKey,
  getCachedEventFeed,
  setCachedEventFeed,
  invalidateEventFeedCache,
  primeRemainingSeats,
  decrementRemainingSeats,
} = require("../../services/event-cache.service");

const getEvents = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 10, maxLimit: 50 });
  const eventType = String(req.query.eventType || "").trim();
  const cacheKey = buildEventFeedKey("student", {
    userId: req.user.id,
    collegeId: req.user.collegeId,
    page,
    limit,
    eventType,
  });

  const cached = await getCachedEventFeed(cacheKey);
  if (cached) {
    res.setHeader("X-Event-Cache", "HIT");
    return res.status(200).json(cached);
  }

  const where = {
    OR: [
      { collegeId: req.user.collegeId },
      { isInterCollege: true },
      { visibilityScope: "INTER_COLLEGE" },
    ],
    ...(eventType
      ? {
          eventType: {
            equals: eventType,
            mode: "insensitive",
          },
        }
      : {}),
  };

  const [total, events] = await Promise.all([
    db.event.count({
      where,
    }),
    db.event.findMany({
      where,
      orderBy: { startsAt: "asc" },
      skip,
      take: limit,
    }),
  ]);

  const payload = {
    data: events.map((event) => {
      const registrants = Array.isArray(event.registrants) ? event.registrants : [];
      const isRegistered = registrants.some((item) => item.studentId === req.user.id);
      const availableSpots = Math.max(Number(event.registrationLimit || 0) - registrants.length, 0);
      return {
        ...event,
        isRegistered,
        availableSpots,
      };
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };

  await setCachedEventFeed(cacheKey, payload);
  res.setHeader("X-Event-Cache", "MISS");
  res.status(200).json(payload);
});

const registerEvent = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { eventId } = req.params;

  const result = await withRedisLock({
    lockKey: `lock:event-register:${eventId}`,
    ttlMs: 8_000,
    waitTimeoutMs: 3_000,
    onLockTimeout: () => {
      throw new ApiError(409, "Event registration is busy. Please try again.", { eventId }, "EVENT_REGISTRATION_BUSY");
    },
    task: async () => {
      const submittedDetails = req.body?.details && typeof req.body.details === "object" ? req.body.details : {};
      const normalize = (value) => {
        if (value == null) return "";
        return String(value).trim();
      };

      const event = await db.event.findFirst({
        where: {
          id: eventId,
          OR: [
            { collegeId: req.user.collegeId },
            { isInterCollege: true },
            { visibilityScope: "INTER_COLLEGE" },
          ],
        },
      });

      if (!event) {
        throw new ApiError(404, "Event not found");
      }

      if (event.isCancelled) {
        throw new ApiError(409, "Event cancelled", { eventId }, "EVENT_CANCELLED");
      }

      const now = new Date();
      if (event.registrationDeadline && new Date(event.registrationDeadline) < now) {
        throw new ApiError(409, "Registration closed", { eventId }, "EVENT_REGISTRATION_CLOSED");
      }

      const registrants = Array.isArray(event.registrants) ? event.registrants : [];
      if (registrants.some((item) => item.studentId === req.user.id)) {
        throw new ApiError(409, "Already registered", { eventId }, "ALREADY_REGISTERED");
      }

      const limit = Number(event.registrationLimit || 0);
      const remainingSeats = limit > 0 ? limit - registrants.length : Number.POSITIVE_INFINITY;
      if (limit > 0) {
        await primeRemainingSeats(eventId, Math.max(remainingSeats, 0));
      }
      if (limit > 0 && remainingSeats <= 0) {
        throw new ApiError(409, "Event full", { eventId }, "EVENT_FULL");
      }

      const nextRegistrant = {
        studentId: req.user.id,
        fullName: normalize(submittedDetails.fullName) || req.user.fullName,
        email: normalize(submittedDetails.email) || req.user.email,
        studentCode: normalize(submittedDetails.studentId || submittedDetails.studentCode || req.user.studentId || req.user.rollNumber),
        phone: normalize(submittedDetails.phone || req.user.phone || req.user.mobile),
        customFields: submittedDetails.customFields && typeof submittedDetails.customFields === "object" ? submittedDetails.customFields : {},
        registeredAt: now.toISOString(),
        status: "REGISTERED",
      };

      const updated = await db.event.update({
        where: { id: eventId },
        data: {
          registrants: [...registrants, nextRegistrant],
        },
      });

      if (limit > 0) {
        await decrementRemainingSeats(eventId);
      }
      await invalidateEventFeedCache();

      return {
        message: "Registered successfully",
        eventId,
        registrantCount: Array.isArray(updated.registrants) ? updated.registrants.length : registrants.length + 1,
      };
    },
  });

  res.status(200).json(result);
});

module.exports = { getEvents, registerEvent };
