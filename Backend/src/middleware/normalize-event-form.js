const parseJsonMaybe = (value, fallback) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return fallback;
  }
};

const readScalar = (value) => (Array.isArray(value) ? value[value.length - 1] : value);

const readOptionalString = (value) => {
  const scalar = readScalar(value);
  if (scalar == null) {
    return null;
  }

  const trimmed = String(scalar).trim();
  return trimmed ? trimmed : null;
};

const readOptionalNumber = (value) => {
  const scalar = readOptionalString(value);
  if (scalar == null) {
    return null;
  }

  const parsed = Number(scalar);
  return Number.isFinite(parsed) ? parsed : value;
};

const readOptionalBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") {
    return value;
  }

  const scalar = readOptionalString(value);
  if (scalar == null) {
    return fallback;
  }

  const normalized = scalar.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

const readStringArray = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  const parsed = parseJsonMaybe(value, null);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  }

  const scalar = readOptionalString(value);
  return scalar ? [scalar] : [];
};

const readRegistrationFields = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  const parsed = parseJsonMaybe(value, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((field) => ({
    key: String(field?.key || "").trim(),
    label: String(field?.label || "").trim(),
    type: String(field?.type || "text").trim(),
    required: readOptionalBoolean(field?.required, false),
    options: readStringArray(field?.options),
    ...(field && typeof field === "object" && field.meta ? { meta: field.meta } : {}),
  }));
};

const normalizeEventForm = (req, _res, next) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};

  req.body = {
    ...body,
    title: readOptionalString(body.title) || "",
    description: readOptionalString(body.description) || "",
    eventType: readOptionalString(body.eventType) || "",
    startsAt: readOptionalString(body.startsAt) || "",
    endsAt: readOptionalString(body.endsAt),
    eventDate: readOptionalString(body.eventDate),
    registrationDeadline: readOptionalString(body.registrationDeadline),
    location: readOptionalString(body.location),
    registrationLimit: readOptionalNumber(body.registrationLimit),
    maxParticipants: readOptionalNumber(body.maxParticipants),
    registrationUrl: readOptionalString(body.registrationUrl),
    visibilityScope: readOptionalString(body.visibilityScope) || "COLLEGE_ONLY",
    registrationFields: readRegistrationFields(body.registrationFields),
    feeType: readOptionalString(body.feeType) || undefined,
    registrationFee: readOptionalNumber(body.registrationFee),
    allColleges: readOptionalBoolean(body.allColleges, false),
    collegeIds: readStringArray(body.collegeIds),
  };

  next();
};

module.exports = {
  normalizeEventForm,
};
