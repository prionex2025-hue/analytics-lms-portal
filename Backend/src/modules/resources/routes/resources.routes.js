const express = require("express");

const validate = require("../../../middleware/validate");
const { requireAnyPermission, requirePermission } = require("../../../middleware/permissions");
const { uploadResourceFile } = require("../middlewares/upload.middleware");
const {
  resourceDownloadLimiter,
  resourceSearchLimiter,
  resourceUploadLimiter,
} = require("../middlewares/rate-limit.middleware");
const {
  createSubjectSchema,
  resourceParamSchema,
  resourceQuerySchema,
} = require("../validators/resource.validator");
const {
  createSubject,
  downloadResource,
  editResource,
  getAnalytics,
  getPopular,
  getResource,
  getResources,
  getSubjects,
  removeResource,
  removeSubject,
  uploadResource,
} = require("../controllers/resource.controller");

const requireResourceRead = (req, res, next) => {
  if (!req.admin) {
    return next();
  }

  return requireAnyPermission("view_resources", "manage_resources")(req, res, next);
};

const requireResourceManage = (req, res, next) => {
  if (!req.admin) {
    return next();
  }

  return requirePermission("manage_resources")(req, res, next);
};

const createResourcesRouter = ({ managementEnabled = false, analyticsEnabled = false } = {}) => {
  const router = express.Router();

  router.get("/subjects", requireResourceRead, validate(resourceQuerySchema), getSubjects);

  if (managementEnabled) {
    router.post("/subjects", requireResourceManage, validate(createSubjectSchema), createSubject);
    router.delete("/subjects/:id", requireResourceManage, validate(resourceParamSchema), removeSubject);
  }

  router.get("/", requireResourceRead, resourceSearchLimiter, validate(resourceQuerySchema), getResources);
  router.get("/popular", requireResourceRead, validate(resourceQuerySchema), getPopular);

  if (analyticsEnabled) {
    router.get("/analytics", requireResourceRead, validate(resourceQuerySchema), getAnalytics);
  }

  router.get("/download/:id", resourceDownloadLimiter, validate(resourceParamSchema), downloadResource);
  router.get("/:id", requireResourceRead, validate(resourceParamSchema), getResource);

  if (managementEnabled) {
    router.post("/upload", requireResourceManage, resourceUploadLimiter, uploadResourceFile, uploadResource);
    router.put("/:id", requireResourceManage, resourceUploadLimiter, uploadResourceFile, validate(resourceParamSchema), editResource);
    router.delete("/:id", requireResourceManage, validate(resourceParamSchema), removeResource);
  }

  return router;
};

module.exports = {
  createResourcesRouter,
};
