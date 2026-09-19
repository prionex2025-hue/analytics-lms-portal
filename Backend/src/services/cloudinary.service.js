const { v2: cloudinary } = require("cloudinary");
const env = require("../config/env");
const { ApiError } = require("../utils/http");

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
  secure: true,
});

const ensureCloudinaryConfigured = () => {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new ApiError(
      500,
      "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in backend .env",
      null,
      "CLOUDINARY_NOT_CONFIGURED"
    );
  }
};

const uploadImageBuffer = async (
  buffer,
  { folder = "general", publicIdPrefix = "asset", mimeType = "image/jpeg" } = {}
) => {
  ensureCloudinaryConfigured();

  const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const publicId = `${publicIdPrefix}-${Date.now()}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: `${env.cloudinaryFolder}/${folder}`,
    public_id: publicId,
    overwrite: true,
    resource_type: "image",
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
};

const deleteAsset = async (publicId) => {
  if (!publicId) {
    return;
  }

  ensureCloudinaryConfigured();
  await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
};

module.exports = {
  uploadImageBuffer,
  deleteAsset,
};
