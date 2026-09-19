const fs = require("fs");
const path = require("path");
const multer = require("multer");

const env = require("../../../config/env");
const { ApiError } = require("../../../utils/http");
const { DANGEROUS_FILE_EXTENSIONS } = require("../constants");

const uploadRoot = path.resolve(process.cwd(), env.resourceUpload.root);
const tempUploadDir = path.join(uploadRoot, "_tmp");

const ensureUploadDirectory = (directory) => {
  fs.mkdirSync(directory, { recursive: true });
};

const getLowercaseExtensions = (fileName = "") => {
  const lower = String(fileName || "").toLowerCase();
  const parts = lower.split(".").filter(Boolean);
  if (parts.length <= 1) {
    return [];
  }
  return parts.slice(1).map((part) => `.${part}`);
};

const hasDangerousExtension = (fileName = "") => {
  const extensions = getLowercaseExtensions(fileName);
  return extensions.some((extension) => DANGEROUS_FILE_EXTENSIONS.includes(extension));
};

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      ensureUploadDirectory(tempUploadDir);
      cb(null, tempUploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename(_req, file, cb) {
    const safeSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const extension = path.extname(file.originalname || "").toLowerCase();
    cb(null, `resource-${safeSuffix}${extension}`);
  },
});

const uploadResourceFile = multer({
  storage,
  limits: {
    fileSize: env.resourceUpload.maxFileSizeBytes,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (hasDangerousExtension(file.originalname)) {
      return cb(new ApiError(400, "Executable and script uploads are not allowed", null, "DANGEROUS_UPLOAD_REJECTED"));
    }

    cb(null, true);
  },
}).single("file");

module.exports = {
  uploadRoot,
  uploadResourceFile,
  hasDangerousExtension,
};
