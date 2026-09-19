const multer = require("multer");
const { ApiError } = require("../utils/http");

const storage = multer.memoryStorage();

const startsWithBytes = (buffer, signature) =>
  Buffer.isBuffer(buffer) && signature.every((byte, index) => buffer[index] === byte);

const hasValidImageSignature = (file) => {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer)) {
    return false;
  }

  if (file.mimetype === "image/jpeg") {
    return startsWithBytes(buffer, [0xff, 0xd8, 0xff]);
  }

  if (file.mimetype === "image/png") {
    return startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }

  return false;
};

const rawImageUpload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
      return cb(new ApiError(400, "Only JPEG and PNG images are allowed", null, "INVALID_IMAGE_TYPE"));
    }

    cb(null, true);
  },
});

const imageUpload = {
  single(fieldName) {
    const upload = rawImageUpload.single(fieldName);

    return (req, res, next) => {
      upload(req, res, (error) => {
        if (error) {
          return next(error);
        }

        if (req.file && !hasValidImageSignature(req.file)) {
          return next(new ApiError(400, "Uploaded image content is invalid", null, "INVALID_IMAGE_SIGNATURE"));
        }

        return next();
      });
    };
  },
};

module.exports = {
  imageUpload,
  hasValidImageSignature,
};
