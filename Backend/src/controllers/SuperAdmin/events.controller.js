const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");
const { uploadImageBuffer } = require("../../services/cloudinary.service");
const { getPagination } = require("../../utils/pagination");
const {
  buildEventFeedKey,
  getCachedEventFeed,
  setCachedEventFeed,
  invalidateEventFeedCache,
  clearRemainingSeats,
} = require("../../services/event-cache.service");

const buildGlobalEventUpdateData = (body, uploadedImage = null) => {
  const data = {};
  const copyStringFields = ["title", "description", "eventType", "location", "registrationUrl"];

  copyStringFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      data[field] = body[field] || null;
    }
  });

  if (body.startsAt) data.startsAt = new Date(body.startsAt);
  if (Object.prototype.hasOwnProperty.call(body, "endsAt")) data.endsAt = body.endsAt ? new Date(body.endsAt) : null;
  if (Object.prototype.hasOwnProperty.call(body, "eventDate")) data.eventDate = body.eventDate ? new Date(body.eventDate) : data.startsAt;
  if (Object.prototype.hasOwnProperty.call(body, "registrationDeadline")) {
    data.registrationDeadline = body.registrationDeadline ? new Date(body.registrationDeadline) : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "registrationLimit") || Object.prototype.hasOwnProperty.call(body, "maxParticipants")) {
    data.registrationLimit = Number(body.maxParticipants ?? body.registrationLimit);
  }
  if (Object.prototype.hasOwnProperty.call(body, "registrationFields")) {
    data.registrationFields = Array.isArray(body.registrationFields) ? body.registrationFields : [];
  }
  if (uploadedImage) {
    data.imageUrl = uploadedImage.url;
    data.imagePublicId = uploadedImage.publicId;
  }

  return data;
};

const getEventsGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { page, limit, skip } = getPagination(req.query);
  const cacheKey = buildEventFeedKey("super-admin", { page, limit });

  const cached = await getCachedEventFeed(cacheKey);
  if (cached) {
    res.setHeader("X-Event-Cache", "HIT");
    return res.status(200).json(cached);
  }

  const [items, total] = await Promise.all([
    db.event.findMany({
      include: {
        college: true,
        createdByAdmin: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: { startsAt: "desc" },
      skip,
      take: limit,
    }),
    db.event.count(),
  ]);

  const payload = {
    data: items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };

  await setCachedEventFeed(cacheKey, payload);
  res.setHeader("X-Event-Cache", "MISS");
  res.status(200).json(payload);
});

const createGlobalEvent = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const payload = req.body;
  const startsAt = new Date(payload.startsAt);
  const eventDate = payload.eventDate ? new Date(payload.eventDate) : startsAt;
  const registrationDeadline = payload.registrationDeadline ? new Date(payload.registrationDeadline) : null;
  const maxParticipants = Number(payload.maxParticipants ?? payload.registrationLimit ?? 1);

  let collegeIds = payload.collegeIds || [];
  if (payload.allColleges) {
    const colleges = await db.college.findMany({ where: { isActive: true }, select: { id: true } });
    collegeIds = colleges.map((item) => item.id);
  }

  if (!collegeIds.length) {
    throw new ApiError(400, "At least one college must be targeted");
  }

  const uploadedImage = req.file
    ? await uploadImageBuffer(req.file.buffer, {
        folder: "events",
        publicIdPrefix: `global-event-${req.superAdmin.id}`,
        mimeType: req.file.mimetype,
      })
    : null;

  const createdEvents = [];
  for (const collegeId of collegeIds) {
    const admin = await db.admin.findFirst({
      where: {
        collegeId,
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (!admin) {
      continue;
    }

    const event = await db.event.create({
      data: {
        title: payload.title,
        description: payload.description,
        eventType: payload.eventType,
        startsAt,
        endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
        eventDate,
        registrationDeadline,
        location: payload.location || null,
        registrationLimit: maxParticipants,
        registrationUrl: payload.registrationUrl || null,
        registrationFields: Array.isArray(payload.registrationFields) ? payload.registrationFields : [],
        registrants: [],
        isCancelled: false,
        isGlobal: true,
        imageUrl: uploadedImage?.url || null,
        imagePublicId: uploadedImage?.publicId || null,
        createdByAdminId: admin.id,
        collegeId,
      },
    });

    createdEvents.push(event);
  }

  await createAuditLog({
    action: "SUPER_ADMIN_CREATE_GLOBAL_EVENT",
    targetType: "EVENT",
    targetId: createdEvents[0]?.id || "multi",
    superAdminId: req.superAdmin.id,
    afterState: {
      eventType: payload.eventType,
      colleges: collegeIds,
      createdCount: createdEvents.length,
      imageUrl: uploadedImage?.url || null,
    },
  });

  await invalidateEventFeedCache();

  res.status(201).json({
    message: "Global event created",
    createdCount: createdEvents.length,
    data: createdEvents,
  });
});

const updateGlobalEvent = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { eventId } = req.params;

  const event = await db.event.findFirst({
    where: { id: eventId },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const uploadedImage = req.file
    ? await uploadImageBuffer(req.file.buffer, {
        folder: "events",
        publicIdPrefix: `global-event-${req.superAdmin.id}`,
        mimeType: req.file.mimetype,
      })
    : null;

  const updated = await db.event.update({
    where: { id: eventId },
    data: buildGlobalEventUpdateData(req.body, uploadedImage),
  });

  await createAuditLog({
    action: "SUPER_ADMIN_UPDATE_EVENT",
    targetType: "EVENT",
    targetId: eventId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      title: event.title,
      startsAt: event.startsAt,
      registrationLimit: event.registrationLimit,
      imageUrl: event.imageUrl || null,
    },
    afterState: {
      title: updated.title,
      startsAt: updated.startsAt,
      registrationLimit: updated.registrationLimit,
      imageUrl: updated.imageUrl || null,
    },
  });

  await clearRemainingSeats(eventId);
  await invalidateEventFeedCache();

  res.status(200).json(updated);
});

const deleteGlobalEvent = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { eventId } = req.params;

  const event = await db.event.findFirst({
    where: { id: eventId },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await db.event.delete({
    where: { id: eventId },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_DELETE_EVENT",
    targetType: "EVENT",
    targetId: eventId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      title: event.title,
      startsAt: event.startsAt,
      collegeId: event.collegeId,
      registrantCount: Array.isArray(event.registrants) ? event.registrants.length : 0,
    },
  });

  await clearRemainingSeats(eventId);
  await invalidateEventFeedCache();

  res.status(200).json({ message: "Event deleted", eventId });
});

module.exports = {
  getEventsGlobal,
  createGlobalEvent,
  updateGlobalEvent,
  deleteGlobalEvent,
};
