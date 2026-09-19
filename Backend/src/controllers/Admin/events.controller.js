const models = require("../../models");
const { asyncHandler, ApiError } = require("../../utils/http");
const { createAuditLog } = require("../../services/audit.service");
const { uploadImageBuffer } = require("../../services/cloudinary.service");
const {
  buildEventFeedKey,
  getCachedEventFeed,
  setCachedEventFeed,
  invalidateEventFeedCache,
  clearRemainingSeats,
} = require("../../services/event-cache.service");

const stringifyCsv = (headers, rows) => {
  const serialized = [headers.join(",")];
  rows.forEach((row) => {
    serialized.push(
      headers
        .map((header) => {
          const value = row[header] == null ? "" : String(row[header]);
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(",")
    );
  });
  return serialized.join("\n");
};

const buildEventUpdateData = (body, uploadedImage = null) => {
  const data = {};
  const copyStringFields = ["title", "description", "eventType", "location", "registrationUrl", "visibilityScope"];

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
  if (Object.prototype.hasOwnProperty.call(data, "visibilityScope")) {
    data.isInterCollege = data.visibilityScope === "INTER_COLLEGE";
  }
  if (uploadedImage) {
    data.imageUrl = uploadedImage.url;
    data.imagePublicId = uploadedImage.publicId;
  }

  return data;
};

const createEvent = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;

  const maxParticipants = Number(req.body.maxParticipants ?? req.body.registrationLimit ?? 0);
  const startsAt = new Date(req.body.startsAt);
  const eventDate = req.body.eventDate ? new Date(req.body.eventDate) : startsAt;
  const registrationDeadline = req.body.registrationDeadline ? new Date(req.body.registrationDeadline) : null;

  if (registrationDeadline && registrationDeadline > eventDate) {
    throw new ApiError(422, "registration_deadline must be less than or equal to event_date");
  }

  if (!Number.isFinite(maxParticipants) || maxParticipants < 1) {
    throw new ApiError(422, "max_participants must be at least 1");
  }

  const uploadedImage = req.file
    ? await uploadImageBuffer(req.file.buffer, {
        folder: "events",
        publicIdPrefix: `event-${collegeId}`,
        mimeType: req.file.mimetype,
      })
    : null;

  const event = await db.event.create({
    data: {
      title: req.body.title,
      description: req.body.description,
      eventType: req.body.eventType,
      startsAt,
      endsAt: req.body.endsAt ? new Date(req.body.endsAt) : null,
      eventDate,
      registrationDeadline,
      location: req.body.location || null,
      registrationLimit: maxParticipants,
      registrationUrl: req.body.registrationUrl || null,
      visibilityScope: req.body.visibilityScope || "COLLEGE_ONLY",
      isInterCollege: req.body.visibilityScope === "INTER_COLLEGE",
      registrationFields: Array.isArray(req.body.registrationFields) ? req.body.registrationFields : [],
      registrants: [],
      isCancelled: false,
      imageUrl: uploadedImage?.url || null,
      imagePublicId: uploadedImage?.publicId || null,
      collegeId,
      createdByAdminId: req.admin.id,
    },
  });

  await createAuditLog({
    action: "ADMIN_EVENT_CREATED",
    targetType: "EVENT",
    targetId: event.id,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      title: event.title,
      startsAt: event.startsAt,
      registrationLimit: event.registrationLimit,
      imageUrl: event.imageUrl || null,
    },
  });

  await invalidateEventFeedCache();

  res.status(201).json(event);
});

const getEvents = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const cacheKey = buildEventFeedKey("admin", { collegeId });

  const cached = await getCachedEventFeed(cacheKey);
  if (cached) {
    res.setHeader("X-Event-Cache", "HIT");
    return res.status(200).json(cached);
  }

  const events = await db.event.findMany({
    where: { collegeId },
    orderBy: { startsAt: "asc" },
  });

  const withParticipants = events.map((event) => {
    const registrants = Array.isArray(event.registrants) ? event.registrants : [];
    return {
      ...event,
      registrantCount: registrants.length,
      spotsLeft: Math.max(Number(event.registrationLimit || 0) - registrants.length, 0),
    };
  });

  await setCachedEventFeed(cacheKey, withParticipants);
  res.setHeader("X-Event-Cache", "MISS");
  res.status(200).json(withParticipants);
});

const updateEvent = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { eventId } = req.params;

  const event = await db.event.findFirst({
    where: { id: eventId, collegeId },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const uploadedImage = req.file
    ? await uploadImageBuffer(req.file.buffer, {
        folder: "events",
        publicIdPrefix: `event-${collegeId}`,
        mimeType: req.file.mimetype,
      })
    : null;

  const updated = await db.event.update({
    where: { id: eventId },
    data: buildEventUpdateData(req.body, uploadedImage),
  });

  await createAuditLog({
    action: "ADMIN_EVENT_UPDATED",
    targetType: "EVENT",
    targetId: eventId,
    collegeId,
    adminId: req.admin.id,
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

const deleteEvent = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { eventId } = req.params;

  const event = await db.event.findFirst({
    where: { id: eventId, collegeId },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  await db.event.delete({
    where: { id: eventId },
  });

  await createAuditLog({
    action: "ADMIN_EVENT_DELETED",
    targetType: "EVENT",
    targetId: eventId,
    collegeId,
    adminId: req.admin.id,
    beforeState: {
      title: event.title,
      startsAt: event.startsAt,
      registrantCount: Array.isArray(event.registrants) ? event.registrants.length : 0,
    },
  });

  await clearRemainingSeats(eventId);
  await invalidateEventFeedCache();

  res.status(200).json({ message: "Event deleted", eventId });
});

const getEventRegistrants = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { eventId } = req.params;

  const event = await db.event.findFirst({
    where: { id: eventId, collegeId },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const registrants = Array.isArray(event.registrants) ? event.registrants : [];
  const studentIds = registrants.map((item) => item.studentId).filter(Boolean);
  const students = studentIds.length
    ? await db.student.findMany({
        where: {
          id: { in: studentIds },
          collegeId,
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          studentId: true,
          batch: { select: { name: true } },
          department: { select: { name: true } },
        },
      })
    : [];

  const studentMap = new Map(students.map((item) => [item.id, item]));
  const enriched = registrants.map((item) => ({
    ...item,
    student: studentMap.get(item.studentId) || null,
  }));

  res.status(200).json({
    eventId,
    title: event.title,
    registrants: enriched,
  });
});

const exportEventRegistrants = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { eventId } = req.params;

  const event = await db.event.findFirst({
    where: { id: eventId, collegeId },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const registrants = Array.isArray(event.registrants) ? event.registrants : [];
  const headers = ["studentId", "fullName", "email", "registeredAt", "status"];
  const csv = stringifyCsv(
    headers,
    registrants.map((item) => ({
      studentId: item.studentId || "",
      fullName: item.fullName || "",
      email: item.email || "",
      registeredAt: item.registeredAt || "",
      status: item.status || "REGISTERED",
    }))
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=event-${eventId}-registrants.csv`);
  res.status(200).send(csv);
});

const cancelEvent = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { eventId } = req.params;
  const { reason } = req.body;

  const event = await db.event.findFirst({
    where: { id: eventId, collegeId },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const updated = await db.event.update({
    where: { id: eventId },
    data: {
      isCancelled: true,
      cancelReason: reason,
      cancelledAt: new Date(),
    },
  });

  await createAuditLog({
    action: "ADMIN_EVENT_CANCELLED",
    targetType: "EVENT",
    targetId: eventId,
    collegeId,
    adminId: req.admin.id,
    beforeState: {
      isCancelled: Boolean(event.isCancelled),
    },
    afterState: {
      isCancelled: true,
      reason,
    },
  });

  await clearRemainingSeats(eventId);
  await invalidateEventFeedCache();

  res.status(200).json({ message: "Event cancelled", event: updated });
});

module.exports = {
  createEvent,
  getEvents,
  updateEvent,
  deleteEvent,
  getEventRegistrants,
  exportEventRegistrants,
  cancelEvent,
};
