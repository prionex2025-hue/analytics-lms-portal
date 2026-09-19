const fs = require("fs");
const path = require("path");

const { asyncHandler } = require("../../../utils/http");
const {
  createResource,
  createResourceSubject,
  deleteResource,
  deleteResourceSubject,
  getActorFromRequest,
  getPopularResources,
  getResourceAnalytics,
  getResourceById,
  getResourceSubjects,
  listResources,
  prepareResourceDownload,
  updateResource,
} = require("../services/resource.service");

const sanitizeAttachmentFileName = (value) => {
  const baseName = path.basename(String(value || "resource"));
  const cleaned = baseName
    .replace(/[\r\n"\\]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .trim();

  return cleaned || "resource";
};

const getSubjects = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  const subjects = await getResourceSubjects({ actor, query: req.query || {} });
  res.status(200).json(subjects);
});

const createSubject = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  const subject = await createResourceSubject({ actor, body: req.body });
  res.status(201).json(subject);
});

const removeSubject = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  await deleteResourceSubject({ actor, subjectId: req.params.id });
  res.status(200).json({ message: "Subject deleted" });
});

const uploadResource = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  const resource = await createResource({ actor, body: req.body, file: req.file });
  res.status(201).json(resource);
});

const getResources = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  const payload = await listResources({ actor, query: req.query || {} });
  res.status(200).json(payload);
});

const getResource = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  const resource = await getResourceById({
    actor,
    resourceId: req.params.id,
    recordView: true,
  });
  res.status(200).json(resource);
});

const downloadResource = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  const download = await prepareResourceDownload({ actor, resourceId: req.params.id });

  if (download.type === "external") {
    return res.status(200).json({
      redirectUrl: download.externalUrl,
    });
  }

  const fileName = sanitizeAttachmentFileName(download.originalFileName);
  res.setHeader("Content-Type", download.mimeType);
  res.setHeader("Content-Length", String(download.fileSize));
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");

  const stream = fs.createReadStream(download.filePath);
  stream.on("error", (error) => {
    if (!res.headersSent) {
      res.status(500).json({ message: "Unable to stream resource file", code: "RESOURCE_STREAM_FAILED" });
    } else {
      res.destroy(error);
    }
  });
  return stream.pipe(res);
});

const editResource = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  const resource = await updateResource({
    actor,
    resourceId: req.params.id,
    body: req.body,
    file: req.file,
  });
  res.status(200).json(resource);
});

const removeResource = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  await deleteResource({ actor, resourceId: req.params.id });
  res.status(200).json({ message: "Resource deleted" });
});

const getPopular = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  const resources = await getPopularResources({ actor, query: req.query || {} });
  res.status(200).json(resources);
});

const getAnalytics = asyncHandler(async (req, res) => {
  const actor = getActorFromRequest(req);
  const analytics = await getResourceAnalytics({ actor, query: req.query || {} });
  res.status(200).json(analytics);
});

module.exports = {
  getSubjects,
  createSubject,
  removeSubject,
  uploadResource,
  getResources,
  getResource,
  downloadResource,
  editResource,
  removeResource,
  getPopular,
  getAnalytics,
};
