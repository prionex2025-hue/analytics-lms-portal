const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const models = require("../../../models");
const env = require("../../../config/env");
const { redisClient, isRedisAvailable } = require("../../../config/redis");
const { scanFileForThreats } = require("../../../services/clamav.service");
const { ApiError } = require("../../../utils/http");
const { ROLES, normalizeRole } = require("../../../constants/roles");
const { isCurrentStudent } = require("../../../services/student-lifecycle.service");
const { uploadRoot } = require("../middlewares/upload.middleware");
const {
  EXTENSIONS_BY_RESOURCE_TYPE,
  FILE_RESOURCE_TYPES,
  LINK_RESOURCE_TYPES,
  MIME_TYPES_BY_RESOURCE_TYPE,
  RESOURCE_TYPES,
  VISIBILITY_SCOPES,
} = require("../constants");

const RESOURCE_CACHE_TTL_SECONDS = 10 * 60;
const POPULAR_CACHE_TTL_SECONDS = 30 * 60;
const SEARCH_CACHE_TTL_SECONDS = 5 * 60;
const CACHE_VERSION_KEY = "resources:cache-version";
const MAX_ZIP_ENTRIES = 2_000;
const MAX_ZIP_UNCOMPRESSED_BYTES = Math.max(env.resourceUpload.maxFileSizeBytes * 10, 250 * 1024 * 1024);
const MAX_ZIP_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hashValue = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

const normalizeIdentifier = (value) => {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  const text = String(value).trim();
  return text || null;
};

const uniqueStrings = (items = []) => [...new Set(items.map(normalizeIdentifier).filter(Boolean))];

const parseArrayField = (value) => {
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => parseArrayField(item)));
  }

  if (value === null || typeof value === "undefined" || value === "") {
    return [];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        return parseArrayField(parsed);
      } catch {
        return [];
      }
    }

    return uniqueStrings(trimmed.split(",").map((item) => item.trim()));
  }

  return uniqueStrings([value]);
};

const normalizeResourceType = (value) => {
  const normalized = String(value || "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();

  if (normalized === "YOUTUBE" || normalized === "YOUTUBE_LINK") {
    return RESOURCE_TYPES.YOUTUBE_URL;
  }

  if (normalized === "GOOGLE_DRIVE" || normalized === "DRIVE" || normalized === "GOOGLE_DRIVE_LINK") {
    return RESOURCE_TYPES.GOOGLE_DRIVE_URL;
  }

  if (normalized === "URL" || normalized === "EXTERNAL_LINK") {
    return RESOURCE_TYPES.LINK;
  }

  return normalized;
};

const normalizeVisibilityScope = (value) => String(value || VISIBILITY_SCOPES.COLLEGE).trim().toUpperCase();

const normalizeResourcePayload = (body = {}) => ({
  title: String(body.title || "").trim(),
  description: String(body.description || "").trim(),
  subjectId: normalizeIdentifier(body.subjectId),
  resourceType: normalizeResourceType(body.resourceType),
  externalUrl: String(body.externalUrl || "").trim(),
  visibilityScope: normalizeVisibilityScope(body.visibilityScope),
  collegeId: normalizeIdentifier(body.collegeId),
  departmentIds: parseArrayField(body.departmentIds),
  batchIds: parseArrayField(body.batchIds),
  studentIds: parseArrayField(body.studentIds),
  tags: uniqueStrings(parseArrayField(body.tags).map((tag) => String(tag).trim().toLowerCase())),
  isActive: typeof body.isActive === "boolean"
    ? body.isActive
    : String(body.isActive || "").toLowerCase() === "false"
      ? false
      : undefined,
});

const getActorFromRequest = (req) => {
  if (req.superAdmin) {
    return {
      id: req.superAdmin.id,
      role: ROLES.SUPER_ADMIN,
      type: "superAdmin",
      collegeId: null,
      departmentId: null,
      batchIds: [],
    };
  }

  if (req.admin) {
    return {
      id: req.admin.id,
      role: normalizeRole(req.admin.role),
      type: "admin",
      collegeId: req.admin.collegeId || req.collegeId || null,
      departmentId: req.admin.departmentId || null,
      batchIds: [],
    };
  }

  if (req.user) {
    const batchIds = uniqueStrings([
      ...(Array.isArray(req.user.batchIds) ? req.user.batchIds : []),
      req.user.batchId,
    ]);

    return {
      id: req.user.id,
      role: ROLES.STUDENT,
      type: "student",
      collegeId: req.user.collegeId || req.collegeId || null,
      departmentId: req.user.departmentId || null,
      batchIds,
      lifecycleStatus: req.user.lifecycleStatus || null,
      isActive: req.user.isActive !== false,
    };
  }

  throw new ApiError(401, "Authentication required");
};

const isManagerActor = (actor) => actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.COLLEGE_ADMIN || actor.role === ROLES.ADMIN;

const appendAnd = (...filters) => {
  const present = filters.filter((filter) => isPlainObject(filter) && Object.keys(filter).length > 0);
  if (present.length === 0) {
    return {};
  }
  if (present.length === 1) {
    return present[0];
  }
  return { AND: present };
};

const buildVisibilityWhereForActor = (actor, options = {}) => {
  const includeInactive = Boolean(options.includeInactive && isManagerActor(actor));
  const activeWhere = includeInactive ? {} : { isActive: { not: false } };

  if (actor.role === ROLES.SUPER_ADMIN) {
    return appendAnd(
      activeWhere,
      options.collegeId ? { OR: [{ collegeId: options.collegeId }, { visibilityScope: VISIBILITY_SCOPES.GLOBAL }] } : {}
    );
  }

  if (actor.role === ROLES.COLLEGE_ADMIN) {
    return appendAnd(activeWhere, {
      OR: [
        { visibilityScope: VISIBILITY_SCOPES.GLOBAL },
        { collegeId: actor.collegeId },
      ],
    });
  }

  if (actor.role === ROLES.ADMIN) {
    return appendAnd(activeWhere, {
      OR: [
        { visibilityScope: VISIBILITY_SCOPES.GLOBAL },
        { collegeId: actor.collegeId, visibilityScope: VISIBILITY_SCOPES.COLLEGE },
        { collegeId: actor.collegeId, departmentIds: { in: [actor.departmentId] } },
        { collegeId: actor.collegeId, uploadedBy: actor.id },
      ],
    });
  }

  if (actor.role === ROLES.STUDENT && !isCurrentStudent(actor)) {
    return { id: "__NO_ACTIVE_STUDENT_RESOURCES__" };
  }

  return appendAnd(activeWhere, {
    OR: [
      { visibilityScope: VISIBILITY_SCOPES.GLOBAL },
      { collegeId: actor.collegeId, visibilityScope: VISIBILITY_SCOPES.COLLEGE },
      {
        collegeId: actor.collegeId,
        visibilityScope: VISIBILITY_SCOPES.DEPARTMENT,
        departmentIds: actor.departmentId ? { in: [actor.departmentId] } : { in: [] },
      },
      {
        collegeId: actor.collegeId,
        visibilityScope: VISIBILITY_SCOPES.BATCH,
        batchIds: actor.batchIds.length > 0 ? { in: actor.batchIds } : { in: [] },
      },
      {
        collegeId: actor.collegeId,
        visibilityScope: VISIBILITY_SCOPES.STUDENT,
        studentIds: { in: [actor.id] },
      },
    ],
  });
};

const canAccessResource = (actor, resource, action = "read") => {
  if (!resource) {
    return false;
  }

  if (actor.role === ROLES.STUDENT && resource.isActive === false) {
    return false;
  }

  if (actor.role === ROLES.STUDENT && !isCurrentStudent(actor)) {
    return false;
  }

  if (actor.role === ROLES.SUPER_ADMIN) {
    return true;
  }

  if (resource.visibilityScope === VISIBILITY_SCOPES.GLOBAL) {
    return action === "read" || action === "download";
  }

  if (String(resource.collegeId || "") !== String(actor.collegeId || "")) {
    return false;
  }

  if (actor.role === ROLES.COLLEGE_ADMIN) {
    return true;
  }

  if (actor.role === ROLES.ADMIN) {
    if (action === "manage") {
      return String(resource.uploadedBy || "") === String(actor.id || "") ||
        (Array.isArray(resource.departmentIds) && resource.departmentIds.some((id) => String(id) === String(actor.departmentId)));
    }

    return resource.visibilityScope === VISIBILITY_SCOPES.COLLEGE ||
      String(resource.uploadedBy || "") === String(actor.id || "") ||
      (Array.isArray(resource.departmentIds) && resource.departmentIds.some((id) => String(id) === String(actor.departmentId)));
  }

  if (resource.visibilityScope === VISIBILITY_SCOPES.COLLEGE) {
    return true;
  }

  if (resource.visibilityScope === VISIBILITY_SCOPES.DEPARTMENT) {
    return Array.isArray(resource.departmentIds) && resource.departmentIds.some((id) => String(id) === String(actor.departmentId));
  }

  if (resource.visibilityScope === VISIBILITY_SCOPES.BATCH) {
    return Array.isArray(resource.batchIds) && resource.batchIds.some((id) => actor.batchIds.some((batchId) => String(batchId) === String(id)));
  }

  if (resource.visibilityScope === VISIBILITY_SCOPES.STUDENT) {
    return Array.isArray(resource.studentIds) && resource.studentIds.some((id) => String(id) === String(actor.id));
  }

  return false;
};

const sanitizeResource = (resource) => {
  if (!resource) {
    return null;
  }

  const {
    filePath: _filePath,
    fileName: _fileName,
    subjectRef,
    ...safe
  } = resource;

  return {
    ...safe,
    subject: subjectRef || resource.subject || null,
    hasFile: Boolean(resource.filePath),
  };
};

const cleanupTempFile = async (file) => {
  if (!file?.path) {
    return;
  }

  await fs.promises.unlink(file.path).catch(() => {});
};

const safeUnlink = async (filePath) => {
  if (!filePath) {
    return;
  }

  await fs.promises.unlink(filePath).catch(() => {});
};

const assertSafeStoredPath = (filePath) => {
  const resolvedRoot = path.resolve(uploadRoot);
  const resolvedPath = path.resolve(String(filePath || ""));
  const rootForCompare = resolvedRoot.toLowerCase();
  const pathForCompare = resolvedPath.toLowerCase();

  if (!pathForCompare.startsWith(`${rootForCompare}${path.sep}`)) {
    throw new ApiError(500, "Stored resource path is outside the upload root", null, "UNSAFE_RESOURCE_PATH");
  }

  return resolvedPath;
};

const assertValidExternalUrl = (resourceType, externalUrl) => {
  if (!LINK_RESOURCE_TYPES.includes(resourceType)) {
    return;
  }

  if (!externalUrl) {
    throw new ApiError(422, "externalUrl is required for link resources");
  }

  let parsed;
  try {
    parsed = new URL(externalUrl);
  } catch {
    throw new ApiError(422, "externalUrl must be a valid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ApiError(422, "Only http and https resource URLs are allowed");
  }

  const host = parsed.hostname.toLowerCase();
  if (resourceType === RESOURCE_TYPES.YOUTUBE_URL && !host.endsWith("youtube.com") && host !== "youtu.be") {
    throw new ApiError(422, "YouTube resources must use a youtube.com or youtu.be URL");
  }

  if (resourceType === RESOURCE_TYPES.GOOGLE_DRIVE_URL && !host.endsWith("drive.google.com") && !host.endsWith("docs.google.com")) {
    throw new ApiError(422, "Google Drive resources must use a Google Drive or Google Docs URL");
  }
};

const readFileWindow = async (filePath, { start = 0, length = 16 } = {}) => {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const startsWithBytes = (buffer, signature) =>
  signature.every((byte, index) => buffer[index] === byte);

const hasValidImageSignature = (header) =>
  startsWithBytes(header, [0xff, 0xd8, 0xff]) ||
  startsWithBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
  startsWithBytes(header, [0x47, 0x49, 0x46, 0x38]) ||
  (startsWithBytes(header, [0x52, 0x49, 0x46, 0x46]) && header.subarray(8, 12).toString("ascii") === "WEBP");

const assertZipStructureIsReasonable = async (filePath) => {
  const stat = await fs.promises.stat(filePath);
  const tailLength = Math.min(stat.size, 65_557);
  const tail = await readFileWindow(filePath, { start: Math.max(0, stat.size - tailLength), length: tailLength });

  let eocdOffset = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new ApiError(400, "Invalid ZIP container", null, "INVALID_ZIP_CONTAINER");
  }

  const entryCount = tail.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = tail.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = tail.readUInt32LE(eocdOffset + 16);

  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new ApiError(400, "ZIP file contains too many entries", { maxEntries: MAX_ZIP_ENTRIES }, "ZIP_ENTRY_LIMIT_EXCEEDED");
  }

  if (centralDirectorySize > MAX_ZIP_CENTRAL_DIRECTORY_BYTES || centralDirectoryOffset + centralDirectorySize > stat.size) {
    throw new ApiError(400, "ZIP central directory is invalid", null, "INVALID_ZIP_CENTRAL_DIRECTORY");
  }

  const central = await readFileWindow(filePath, { start: centralDirectoryOffset, length: centralDirectorySize });
  let cursor = 0;
  let totalUncompressed = 0;
  let parsedEntries = 0;

  while (cursor + 46 <= central.length && central.readUInt32LE(cursor) === 0x02014b50) {
    const compressedSize = central.readUInt32LE(cursor + 20);
    const uncompressedSize = central.readUInt32LE(cursor + 24);
    const fileNameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;

    if (nameEnd > central.length) {
      throw new ApiError(400, "ZIP central directory is malformed", null, "INVALID_ZIP_CENTRAL_DIRECTORY");
    }

    const entryName = central.subarray(nameStart, nameEnd).toString("utf8");
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      entryName.startsWith("/") ||
      entryName.startsWith("\\") ||
      entryName.includes("../") ||
      entryName.includes("..\\")
    ) {
      throw new ApiError(400, "ZIP file contains unsafe entries", null, "UNSAFE_ZIP_ENTRY");
    }

    totalUncompressed += uncompressedSize;
    parsedEntries += 1;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new ApiError(
        400,
        "ZIP file expands beyond the allowed size",
        { maxUncompressedBytes: MAX_ZIP_UNCOMPRESSED_BYTES },
        "ZIP_UNCOMPRESSED_LIMIT_EXCEEDED"
      );
    }

    cursor = nameEnd + extraLength + commentLength;
  }

  if (parsedEntries !== entryCount) {
    throw new ApiError(400, "ZIP central directory entry count mismatch", null, "INVALID_ZIP_CENTRAL_DIRECTORY");
  }
};

const assertFileSignature = async (resourceType, file) => {
  if (!file?.path) {
    return;
  }

  const header = await readFileWindow(file.path, { length: 16 });
  const extension = path.extname(file.originalname || "").toLowerCase();
  const isZipContainer = startsWithBytes(header, [0x50, 0x4b, 0x03, 0x04]);
  const isOleContainer = startsWithBytes(header, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

  if (resourceType === RESOURCE_TYPES.PDF && !startsWithBytes(header, [0x25, 0x50, 0x44, 0x46])) {
    throw new ApiError(400, "Uploaded PDF content is invalid", null, "INVALID_FILE_SIGNATURE");
  }

  if (resourceType === RESOURCE_TYPES.IMAGE && !hasValidImageSignature(header)) {
    throw new ApiError(400, "Uploaded image content is invalid", null, "INVALID_FILE_SIGNATURE");
  }

  if (resourceType === RESOURCE_TYPES.DOCX || resourceType === RESOURCE_TYPES.PPTX || resourceType === RESOURCE_TYPES.ZIP) {
    const allowsLegacyOffice = [".doc", ".ppt"].includes(extension);
    if (!isZipContainer && !(allowsLegacyOffice && isOleContainer)) {
      throw new ApiError(400, "Uploaded document/archive content is invalid", null, "INVALID_FILE_SIGNATURE");
    }

    if (isZipContainer) {
      await assertZipStructureIsReasonable(file.path);
    }
  }
};

const assertValidFileUpload = async (resourceType, file) => {
  if (!FILE_RESOURCE_TYPES.includes(resourceType)) {
    return;
  }

  if (!file) {
    throw new ApiError(422, "A file is required for this resource type");
  }

  const allowedMimeTypes = MIME_TYPES_BY_RESOURCE_TYPE[resourceType] || [];
  const allowedExtensions = EXTENSIONS_BY_RESOURCE_TYPE[resourceType] || [];
  const extension = path.extname(file.originalname || "").toLowerCase();

  if (!allowedExtensions.includes(extension)) {
    throw new ApiError(400, `Invalid file extension for ${resourceType}`, { allowedExtensions }, "INVALID_RESOURCE_EXTENSION");
  }

  if (!allowedMimeTypes.includes(file.mimetype)) {
    throw new ApiError(400, `Invalid MIME type for ${resourceType}`, { allowedMimeTypes }, "INVALID_RESOURCE_MIME_TYPE");
  }

  await assertFileSignature(resourceType, file);
  if (file.path) {
    await scanFileForThreats(file.path);
  }
};

const validateResourceBasics = (payload) => {
  if (!payload.title || payload.title.length < 2) {
    throw new ApiError(422, "Resource title is required");
  }

  if (!payload.subjectId) {
    throw new ApiError(422, "subjectId is required");
  }

  if (!Object.values(RESOURCE_TYPES).includes(payload.resourceType)) {
    throw new ApiError(422, "Invalid resource type");
  }

  if (!Object.values(VISIBILITY_SCOPES).includes(payload.visibilityScope)) {
    throw new ApiError(422, "Invalid visibility scope");
  }
};

const getCacheVersion = async () => {
  if (!isRedisAvailable()) {
    return "0";
  }

  const value = await redisClient.get(CACHE_VERSION_KEY);
  return value || "1";
};

const bumpResourcesCacheVersion = async () => {
  if (!isRedisAvailable()) {
    return;
  }

  await redisClient.incr(CACHE_VERSION_KEY).catch(() => {});
};

const getCachedJson = async (key) => {
  if (!isRedisAvailable()) {
    return null;
  }

  const raw = await redisClient.get(key).catch(() => null);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const setCachedJson = async (key, payload, ttlSeconds) => {
  if (!isRedisAvailable()) {
    return;
  }

  await redisClient.set(key, JSON.stringify(payload), "EX", ttlSeconds).catch(() => {});
};

const actorCacheScope = (actor) => JSON.stringify({
  role: actor.role,
  id: actor.id,
  collegeId: actor.collegeId,
  departmentId: actor.departmentId,
  batchIds: actor.batchIds,
});

const getModels = async () => {
  const m = await models.init();
  return m.dbClient;
};

const buildSubjectWhereForActor = (actor, query = {}) => {
  const resourceSubjectWhere = { resourceSubjectScope: { in: ["GLOBAL", "COLLEGE"] } };

  if (actor.role === ROLES.SUPER_ADMIN) {
    return query.collegeId
      ? appendAnd(resourceSubjectWhere, { OR: [{ collegeId: null }, { collegeId: query.collegeId }] })
      : appendAnd(resourceSubjectWhere, { collegeId: null });
  }

  return actor.collegeId
    ? appendAnd(resourceSubjectWhere, { OR: [{ collegeId: null }, { collegeId: actor.collegeId }] })
    : appendAnd(resourceSubjectWhere, { collegeId: null });
};

const findSubjectForPayload = async (db, actor, payload) => {
  const subject = await db.subject.findFirst({
    where: {
      id: payload.subjectId,
      resourceSubjectScope: { in: ["GLOBAL", "COLLEGE"] },
    },
  });

  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  if (subject.collegeId && actor.role !== ROLES.SUPER_ADMIN && String(subject.collegeId) !== String(actor.collegeId)) {
    throw new ApiError(403, "Cross-college subject access denied", null, "CROSS_COLLEGE_ACCESS_DENIED");
  }

  if (payload.visibilityScope === VISIBILITY_SCOPES.GLOBAL && subject.collegeId) {
    throw new ApiError(422, "Global resources must use a global subject");
  }

  if (
    payload.visibilityScope !== VISIBILITY_SCOPES.GLOBAL &&
    subject.collegeId &&
    payload.collegeId &&
    String(subject.collegeId) !== String(payload.collegeId)
  ) {
    throw new ApiError(403, "Subject does not belong to the selected college", null, "CROSS_COLLEGE_ACCESS_DENIED");
  }

  return subject;
};

const validateScopedReferences = async (db, actor, payload) => {
  if ([VISIBILITY_SCOPES.BATCH, VISIBILITY_SCOPES.STUDENT].includes(payload.visibilityScope)) {
    throw new ApiError(422, "Learning resources can only be assigned globally, college-wide, or to departments");
  }

  if (payload.visibilityScope === VISIBILITY_SCOPES.GLOBAL) {
    if (actor.role !== ROLES.SUPER_ADMIN) {
      throw new ApiError(403, "Only Super Admin can publish global resources");
    }

    payload.collegeId = null;
    payload.departmentIds = [];
    payload.batchIds = [];
    payload.studentIds = [];
    return payload;
  }

  if (actor.role === ROLES.SUPER_ADMIN) {
    if (!payload.collegeId) {
      throw new ApiError(422, "collegeId is required for non-global resources");
    }
  } else {
    payload.collegeId = actor.collegeId;
  }

  if (actor.role === ROLES.ADMIN && payload.visibilityScope !== VISIBILITY_SCOPES.DEPARTMENT) {
    throw new ApiError(403, "Department admins can only publish resources to their own department");
  }

  if (actor.role === ROLES.ADMIN) {
    if (!actor.departmentId) {
      throw new ApiError(422, "departmentId is required for department admin resource assignment");
    }
    payload.departmentIds = [actor.departmentId];
  }

  if (payload.visibilityScope === VISIBILITY_SCOPES.DEPARTMENT && payload.departmentIds.length === 0) {
    throw new ApiError(422, "departmentIds are required for department visibility");
  }

  if (payload.departmentIds.length > 0) {
    const departments = await db.department.findMany({
      where: { collegeId: payload.collegeId, id: { in: payload.departmentIds } },
    });

    if (departments.length !== payload.departmentIds.length) {
      throw new ApiError(422, "One or more departments are invalid for this college");
    }

    if (actor.role === ROLES.ADMIN && !payload.departmentIds.every((id) => String(id) === String(actor.departmentId))) {
      throw new ApiError(403, "Cross-department resource assignment denied", null, "CROSS_DEPARTMENT_ACCESS_DENIED");
    }
  }

  payload.batchIds = [];
  payload.studentIds = [];

  return payload;
};

const buildFinalFilePath = async ({ resourceId, collegeId, subjectId, originalFileName }) => {
  const collegeDirectory = collegeId ? String(collegeId) : "global";
  const subjectDirectory = String(subjectId);
  const finalDirectory = path.join(uploadRoot, collegeDirectory, subjectDirectory);
  await fs.promises.mkdir(finalDirectory, { recursive: true });

  const extension = path.extname(originalFileName || "").toLowerCase();
  const fileName = `${resourceId}${extension}`;
  return {
    fileName,
    filePath: path.join(finalDirectory, fileName),
  };
};

const createResource = async ({ actor, body, file }) => {
  const db = await getModels();
  const payload = normalizeResourcePayload(body);

  try {
    validateResourceBasics(payload);
    await validateScopedReferences(db, actor, payload);
    await findSubjectForPayload(db, actor, payload);
    assertValidExternalUrl(payload.resourceType, payload.externalUrl);
    await assertValidFileUpload(payload.resourceType, file);

    if (LINK_RESOURCE_TYPES.includes(payload.resourceType) && file) {
      throw new ApiError(422, "Files are not accepted for link resources");
    }

    const resourceId = new mongoose.Types.ObjectId().toString();
    let fileMetadata = {
      fileName: null,
      originalFileName: null,
      fileSize: null,
      filePath: null,
      mimeType: null,
    };

    if (FILE_RESOURCE_TYPES.includes(payload.resourceType)) {
      const finalFile = await buildFinalFilePath({
        resourceId,
        collegeId: payload.collegeId,
        subjectId: payload.subjectId,
        originalFileName: file.originalname,
      });
      await fs.promises.rename(file.path, finalFile.filePath);
      fileMetadata = {
        fileName: finalFile.fileName,
        originalFileName: file.originalname,
        fileSize: file.size,
        filePath: finalFile.filePath,
        mimeType: file.mimetype,
      };
    }

    try {
      const resource = await db.resource.create({
        data: {
          id: resourceId,
          title: payload.title,
          description: payload.description || null,
          subjectId: payload.subjectId,
          resourceType: payload.resourceType,
          ...fileMetadata,
          externalUrl: LINK_RESOURCE_TYPES.includes(payload.resourceType) ? payload.externalUrl : null,
          visibilityScope: payload.visibilityScope,
          collegeId: payload.collegeId,
          departmentIds: payload.departmentIds,
          batchIds: payload.batchIds,
          studentIds: payload.studentIds,
          uploadedBy: actor.id,
          uploadedByRole: actor.role,
          downloadCount: 0,
          viewCount: 0,
          tags: payload.tags,
          isActive: true,
        },
        include: { subjectRef: true },
      });

      await bumpResourcesCacheVersion();
      return sanitizeResource(resource);
    } catch (error) {
      await safeUnlink(fileMetadata.filePath);
      throw error;
    }
  } catch (error) {
    await cleanupTempFile(file);
    throw error;
  }
};

const buildSearchWhere = async (db, actor, query = {}) => {
  const searchText = String(query.q || query.search || "").trim();
  const subjectName = String(query.subject || "").trim();
  const tags = parseArrayField(query.tags);
  const filters = [];

  if (query.subjectId) {
    filters.push({ subjectId: query.subjectId });
  }

  if (query.resourceType) {
    filters.push({ resourceType: query.resourceType });
  }

  if (query.visibilityScope && isManagerActor(actor)) {
    filters.push({ visibilityScope: query.visibilityScope });
  }

  if (subjectName) {
    const visibleSubjectWhere = buildSubjectWhereForActor(actor, query);

    const subjects = await db.subject.findMany({
      where: appendAnd(visibleSubjectWhere, { name: { contains: subjectName, mode: "insensitive" } }),
      take: 50,
    });
    const subjectIds = subjects.map((subject) => subject.id);
    filters.push(subjectIds.length > 0 ? { subjectId: { in: subjectIds } } : { subjectId: "__none__" });
  }

  if (tags.length > 0) {
    filters.push({ tags: { in: tags.map((tag) => String(tag).toLowerCase()) } });
  }

  if (searchText) {
    const subjects = await db.subject.findMany({
      where: appendAnd(buildSubjectWhereForActor(actor, query), { name: { contains: searchText, mode: "insensitive" } }),
      take: 50,
    });
    const subjectIds = subjects.map((subject) => subject.id);
    filters.push({
      OR: [
        { title: { contains: searchText, mode: "insensitive" } },
        { description: { contains: searchText, mode: "insensitive" } },
        { tags: { in: [searchText.toLowerCase()] } },
        ...(subjectIds.length > 0 ? [{ subjectId: { in: subjectIds } }] : []),
      ],
    });
  }

  return appendAnd(...filters);
};

const listResources = async ({ actor, query = {} }) => {
  const db = await getModels();

  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  const page = Math.max(Number(query.page || 1), 1);
  const skip = query.cursor ? 0 : (page - 1) * limit;
  const sortBy = query.cursor ? "createdAt" : (query.sortBy || "createdAt");
  const sortDir = query.cursor ? "desc" : (query.sortDir || "desc");
  const includeInactive = query.includeInactive === "true";
  const cacheVersion = await getCacheVersion();
  const cacheKey = `resource-search:${cacheVersion}:${hashValue(JSON.stringify({ actor: actorCacheScope(actor), query }))}`;
  const cached = await getCachedJson(cacheKey);

  if (cached) {
    return cached;
  }

  const visibilityWhere = buildVisibilityWhereForActor(actor, {
    includeInactive,
    collegeId: query.collegeId,
  });
  const searchWhere = await buildSearchWhere(db, actor, query);
  let cursorWhere = {};

  if (query.cursor) {
    const cursorResource = await db.resource.findFirst({ where: { id: query.cursor } });
    if (cursorResource?.createdAt) {
      cursorWhere = { createdAt: { lt: cursorResource.createdAt } };
    }
  }

  const where = appendAnd(visibilityWhere, searchWhere, cursorWhere);
  const [total, resources] = await Promise.all([
    query.cursor ? Promise.resolve(null) : db.resource.count({ where }),
    db.resource.findMany({
      where,
      include: { subjectRef: true },
      orderBy: { [sortBy]: sortDir },
      skip,
      take: limit,
    }),
  ]);

  const data = resources.map(sanitizeResource);
  const payload = {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === null ? null : Math.ceil(total / limit),
      nextCursor: data.length === limit ? data[data.length - 1]?.id || null : null,
    },
  };

  await setCachedJson(cacheKey, payload, SEARCH_CACHE_TTL_SECONDS);
  return payload;
};

const getResourceById = async ({ actor, resourceId, recordView = false }) => {
  const db = await getModels();
  const cacheVersion = await getCacheVersion();
  const cacheKey = `resource:${cacheVersion}:${resourceId}`;
  let resource = await getCachedJson(cacheKey);

  if (!resource) {
    resource = await db.resource.findFirst({
      where: { id: resourceId },
      include: { subjectRef: true },
    });
    if (resource) {
      await setCachedJson(cacheKey, resource, RESOURCE_CACHE_TTL_SECONDS);
    }
  }

  if (!resource || !canAccessResource(actor, resource, "read")) {
    throw new ApiError(404, "Resource not found");
  }

  if (recordView) {
    await recordResourceView(db, actor, resource);
  }

  return sanitizeResource(resource);
};

const getNativeCollection = async (db, collectionName) => {
  if (!mongoose.connection.db) {
    await db.resource.count({ where: {} });
  }

  return mongoose.connection.db.collection(collectionName);
};

const toObjectId = (value) => (mongoose.Types.ObjectId.isValid(String(value || "")) ? new mongoose.Types.ObjectId(String(value)) : value);

const incrementResourceCounter = async (db, resourceId, field) => {
  const collection = await getNativeCollection(db, "resource");
  await collection.updateOne({ _id: toObjectId(resourceId) }, { $inc: { [field]: 1 }, $set: { updatedAt: new Date() } });
};

const recordResourceView = async (db, actor, resource) => {
  await db.resourceView.create({
    data: {
      resourceId: resource.id,
      userId: actor.id,
      userRole: actor.role,
      viewedAt: new Date(),
      collegeId: actor.collegeId || resource.collegeId || null,
      departmentId: actor.departmentId || null,
      batchIds: actor.batchIds || [],
    },
  });
  await incrementResourceCounter(db, resource.id, "viewCount");
};

const recordResourceDownload = async (db, actor, resource) => {
  await db.resourceDownload.create({
    data: {
      resourceId: resource.id,
      userId: actor.id,
      userRole: actor.role,
      downloadedAt: new Date(),
      collegeId: actor.collegeId || resource.collegeId || null,
      departmentId: actor.departmentId || null,
      batchIds: actor.batchIds || [],
    },
  });
  await incrementResourceCounter(db, resource.id, "downloadCount");
};

const prepareResourceDownload = async ({ actor, resourceId }) => {
  const db = await getModels();
  const resource = await db.resource.findFirst({
    where: { id: resourceId },
  });

  if (!resource || !canAccessResource(actor, resource, "download")) {
    throw new ApiError(404, "Resource not found");
  }

  if (resource.isActive === false && actor.role === ROLES.STUDENT) {
    throw new ApiError(404, "Resource not found");
  }

  if (LINK_RESOURCE_TYPES.includes(resource.resourceType)) {
    await recordResourceDownload(db, actor, resource);
    return {
      type: "external",
      externalUrl: resource.externalUrl,
    };
  }

  if (!resource.filePath) {
    throw new ApiError(404, "Resource file not found");
  }

  const safePath = assertSafeStoredPath(resource.filePath);
  const stat = await fs.promises.stat(safePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new ApiError(404, "Resource file not found");
  }

  await recordResourceDownload(db, actor, resource);

  return {
    type: "file",
    filePath: safePath,
    mimeType: resource.mimeType || "application/octet-stream",
    originalFileName: resource.originalFileName || `${resource.title || "resource"}`,
    fileSize: stat.size,
  };
};

const updateResource = async ({ actor, resourceId, body, file }) => {
  const db = await getModels();
  const existing = await db.resource.findFirst({ where: { id: resourceId } });
  if (!existing || !canAccessResource(actor, existing, "manage")) {
    await cleanupTempFile(file);
    throw new ApiError(404, "Resource not found");
  }

  const payload = normalizeResourcePayload({
    ...existing,
    ...body,
    departmentIds: Object.prototype.hasOwnProperty.call(body || {}, "departmentIds") ? body.departmentIds : existing.departmentIds,
    batchIds: Object.prototype.hasOwnProperty.call(body || {}, "batchIds") ? body.batchIds : existing.batchIds,
    studentIds: Object.prototype.hasOwnProperty.call(body || {}, "studentIds") ? body.studentIds : existing.studentIds,
    tags: Object.prototype.hasOwnProperty.call(body || {}, "tags") ? body.tags : existing.tags,
  });

  try {
    validateResourceBasics(payload);
    await validateScopedReferences(db, actor, payload);
    await findSubjectForPayload(db, actor, payload);
    assertValidExternalUrl(payload.resourceType, payload.externalUrl);

    if (file || FILE_RESOURCE_TYPES.includes(payload.resourceType)) {
      await assertValidFileUpload(payload.resourceType, file || (existing.filePath ? {
        originalname: existing.originalFileName,
        mimetype: existing.mimeType,
      } : null));
    }

    if (LINK_RESOURCE_TYPES.includes(payload.resourceType) && file) {
      throw new ApiError(422, "Files are not accepted for link resources");
    }

    let fileMetadata = {};
    let oldFilePathToDelete = null;

    if (file) {
      const finalFile = await buildFinalFilePath({
        resourceId,
        collegeId: payload.collegeId,
        subjectId: payload.subjectId,
        originalFileName: file.originalname,
      });
      await fs.promises.rename(file.path, finalFile.filePath);
      fileMetadata = {
        fileName: finalFile.fileName,
        originalFileName: file.originalname,
        fileSize: file.size,
        filePath: finalFile.filePath,
        mimeType: file.mimetype,
      };
      oldFilePathToDelete = existing.filePath;
    }

    if (LINK_RESOURCE_TYPES.includes(payload.resourceType)) {
      fileMetadata = {
        fileName: null,
        originalFileName: null,
        fileSize: null,
        filePath: null,
        mimeType: null,
      };
      oldFilePathToDelete = existing.filePath;
    }

    const updated = await db.resource.update({
      where: { id: resourceId },
      data: {
        title: payload.title,
        description: payload.description || null,
        subjectId: payload.subjectId,
        resourceType: payload.resourceType,
        externalUrl: LINK_RESOURCE_TYPES.includes(payload.resourceType) ? payload.externalUrl : null,
        visibilityScope: payload.visibilityScope,
        collegeId: payload.collegeId,
        departmentIds: payload.departmentIds,
        batchIds: payload.batchIds,
        studentIds: payload.studentIds,
        tags: payload.tags,
        ...(typeof payload.isActive === "boolean" ? { isActive: payload.isActive } : {}),
        ...fileMetadata,
      },
      include: { subjectRef: true },
    });

    if (oldFilePathToDelete) {
      await safeUnlink(oldFilePathToDelete);
    }

    await bumpResourcesCacheVersion();
    return sanitizeResource(updated);
  } catch (error) {
    await cleanupTempFile(file);
    throw error;
  }
};

const deleteResource = async ({ actor, resourceId }) => {
  const db = await getModels();
  const existing = await db.resource.findFirst({ where: { id: resourceId } });
  if (!existing || !canAccessResource(actor, existing, "manage")) {
    throw new ApiError(404, "Resource not found");
  }

  await db.resource.update({
    where: { id: resourceId },
    data: { isActive: false },
  });
  await bumpResourcesCacheVersion();
};

const getPopularResources = async ({ actor, query = {} }) => {
  const db = await getModels();
  const cacheVersion = await getCacheVersion();
  const limit = Math.min(Math.max(Number(query.limit || 10), 1), 50);
  const cacheKey = `top-resources:${cacheVersion}:${hashValue(JSON.stringify({ actor: actorCacheScope(actor), limit }))}`;
  const cached = await getCachedJson(cacheKey);

  if (cached) {
    return cached;
  }

  const where = buildVisibilityWhereForActor(actor, { collegeId: query.collegeId });
  const data = await db.resource.findMany({
    where,
    include: { subjectRef: true },
    orderBy: { downloadCount: "desc" },
    take: limit,
  });
  const payload = data.map(sanitizeResource);
  await setCachedJson(cacheKey, payload, POPULAR_CACHE_TTL_SECONDS);
  return payload;
};

const nativeMatchForActor = (actor, query = {}) => {
  if (actor.role === ROLES.SUPER_ADMIN) {
    return query.collegeId ? { collegeId: toObjectId(query.collegeId) } : {};
  }

  if (actor.role === ROLES.COLLEGE_ADMIN) {
    return { collegeId: toObjectId(actor.collegeId) };
  }

  if (actor.role === ROLES.ADMIN) {
    return {
      collegeId: toObjectId(actor.collegeId),
      $or: [
        { visibilityScope: VISIBILITY_SCOPES.COLLEGE },
        { departmentIds: toObjectId(actor.departmentId) },
        { uploadedBy: toObjectId(actor.id) },
      ],
    };
  }

  return {
    collegeId: toObjectId(actor.collegeId),
  };
};

const getResourceAnalytics = async ({ actor, query = {} }) => {
  if (!isManagerActor(actor)) {
    throw new ApiError(403, "Analytics are only available to administrators");
  }

  const db = await getModels();
  await db.resource.count({ where: {} });
  const resourceCollection = await getNativeCollection(db, "resource");
  const viewCollection = await getNativeCollection(db, "resourceView");
  const downloadCollection = await getNativeCollection(db, "resourceDownload");
  const resourceMatch = nativeMatchForActor(actor, query);
  const eventMatch = nativeMatchForActor(actor, query);

  const [
    totalResources,
    activeResources,
    mostDownloaded,
    mostViewed,
    departmentUsage,
    collegeUsage,
    totalViewRows,
    totalDownloadRows,
  ] = await Promise.all([
    resourceCollection.countDocuments(resourceMatch),
    resourceCollection.countDocuments({ ...resourceMatch, isActive: { $ne: false } }),
    resourceCollection.find({ ...resourceMatch, isActive: { $ne: false } }).sort({ downloadCount: -1 }).limit(10).toArray(),
    resourceCollection.find({ ...resourceMatch, isActive: { $ne: false } }).sort({ viewCount: -1 }).limit(10).toArray(),
    downloadCollection.aggregate([
      { $match: { ...eventMatch, departmentId: { $ne: null } } },
      { $group: { _id: "$departmentId", downloads: { $sum: 1 } } },
      { $sort: { downloads: -1 } },
      { $limit: 20 },
    ]).toArray(),
    downloadCollection.aggregate([
      { $match: { ...eventMatch, collegeId: { $ne: null } } },
      { $group: { _id: "$collegeId", downloads: { $sum: 1 } } },
      { $sort: { downloads: -1 } },
      { $limit: 20 },
    ]).toArray(),
    viewCollection.countDocuments(eventMatch),
    downloadCollection.countDocuments(eventMatch),
  ]);

  return {
    summary: {
      totalResources,
      activeResources,
      totalViews: totalViewRows,
      totalDownloads: totalDownloadRows,
    },
    mostDownloaded: mostDownloaded.map((resource) => sanitizeResource({
      ...resource,
      id: String(resource._id),
    })),
    mostViewed: mostViewed.map((resource) => sanitizeResource({
      ...resource,
      id: String(resource._id),
    })),
    departmentUsage: departmentUsage.map((row) => ({
      departmentId: row._id ? String(row._id) : null,
      downloads: row.downloads,
    })),
    collegeUsage: collegeUsage.map((row) => ({
      collegeId: row._id ? String(row._id) : null,
      downloads: row.downloads,
    })),
  };
};

const getResourceSubjects = async ({ actor, query = {} }) => {
  const db = await getModels();
  const where = buildSubjectWhereForActor(actor, query);

  const subjects = await db.subject.findMany({
    where,
    orderBy: { name: "asc" },
  });

  const visibilityWhere = buildVisibilityWhereForActor(actor, { collegeId: query.collegeId });
  const counts = await Promise.all(
    subjects.map((subject) =>
      db.resource.count({
        where: appendAnd(visibilityWhere, { subjectId: subject.id }),
      })
    )
  );

  return subjects.map((subject, index) => ({
    ...subject,
    resourceCount: counts[index] || 0,
    isGlobal: !subject.collegeId,
  }));
};

const createResourceSubject = async ({ actor, body }) => {
  if (![ROLES.SUPER_ADMIN, ROLES.COLLEGE_ADMIN, ROLES.ADMIN].includes(actor.role)) {
    throw new ApiError(403, "Only Super Admin, College Admin, and Admin can create resource subjects");
  }

  const db = await getModels();
  const name = String(body?.name || "").trim();

  if (!name) {
    throw new ApiError(422, "Subject name is required");
  }

  if (actor.role !== ROLES.SUPER_ADMIN && !actor.collegeId) {
    throw new ApiError(422, "collegeId is required to create a resource subject");
  }

  const collegeId = actor.role === ROLES.SUPER_ADMIN ? null : actor.collegeId;
  const duplicate = await db.subject.findFirst({
    where: {
      collegeId,
      resourceSubjectScope: actor.role === ROLES.SUPER_ADMIN ? "GLOBAL" : "COLLEGE",
      name: { equals: name, mode: "insensitive" },
    },
  });

  if (duplicate) {
    throw new ApiError(409, "Subject already exists");
  }

  const subject = await db.subject.create({
    data: {
      name,
      collegeId,
      createdByAdminId: actor.role === ROLES.SUPER_ADMIN ? null : actor.id,
      createdBySuperAdminId: actor.role === ROLES.SUPER_ADMIN ? actor.id : null,
      resourceSubjectScope: actor.role === ROLES.SUPER_ADMIN ? "GLOBAL" : "COLLEGE",
    },
  });

  await bumpResourcesCacheVersion();
  return subject;
};

const deleteResourceSubject = async ({ actor, subjectId }) => {
  if (![ROLES.SUPER_ADMIN, ROLES.COLLEGE_ADMIN, ROLES.ADMIN].includes(actor.role)) {
    throw new ApiError(403, "Only Super Admin, College Admin, and Admin can delete resource subjects");
  }

  if (actor.role !== ROLES.SUPER_ADMIN && !actor.collegeId) {
    throw new ApiError(422, "collegeId is required to delete a resource subject");
  }

  const db = await getModels();
  const subject = await db.subject.findFirst({
    where: {
      id: subjectId,
      resourceSubjectScope: { in: ["GLOBAL", "COLLEGE"] },
    },
  });
  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  if (actor.role === ROLES.SUPER_ADMIN && subject.collegeId) {
    throw new ApiError(403, "Super Admin can only delete global resource subjects from this endpoint");
  }

  if (actor.role !== ROLES.SUPER_ADMIN && !subject.collegeId) {
    throw new ApiError(403, "Only Super Admin can delete global resource subjects");
  }

  if (actor.role !== ROLES.SUPER_ADMIN && String(subject.collegeId || "") !== String(actor.collegeId || "")) {
    throw new ApiError(403, "Cross-college subject access denied", null, "CROSS_COLLEGE_ACCESS_DENIED");
  }

  const resourceCount = await db.resource.count({ where: { subjectId } });
  if (resourceCount > 0) {
    throw new ApiError(409, "Cannot delete a subject with resources", { resourceCount }, "SUBJECT_IN_USE");
  }

  await db.subject.delete({ where: { id: subjectId } });
  await bumpResourcesCacheVersion();
};

module.exports = {
  normalizeResourcePayload,
  getActorFromRequest,
  buildVisibilityWhereForActor,
  canAccessResource,
  assertSafeStoredPath,
  buildSubjectWhereForActor,
  getResourceSubjects,
  createResourceSubject,
  deleteResourceSubject,
  createResource,
  listResources,
  getResourceById,
  prepareResourceDownload,
  updateResource,
  deleteResource,
  getPopularResources,
  getResourceAnalytics,
};
