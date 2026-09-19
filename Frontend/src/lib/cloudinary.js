const CLOUDINARY_UPLOAD_SEGMENT = "/upload/";

export function optimizeCloudinaryImage(url, options = {}) {
  if (!url || typeof url !== "string") {
    return "";
  }

  const uploadIndex = url.indexOf(CLOUDINARY_UPLOAD_SEGMENT);
  if (uploadIndex === -1 || !url.includes("res.cloudinary.com")) {
    return url;
  }

  const {
    width,
    height,
    crop = "fill",
    gravity = "auto",
    quality = "auto",
    format = "auto",
  } = options;

  const transforms = [
    width ? `w_${width}` : null,
    height ? `h_${height}` : null,
    crop ? `c_${crop}` : null,
    gravity ? `g_${gravity}` : null,
    quality ? `q_${quality}` : null,
    format ? `f_${format}` : null,
  ]
    .filter(Boolean)
    .join(",");

  if (!transforms) {
    return url;
  }

  const prefix = url.slice(0, uploadIndex + CLOUDINARY_UPLOAD_SEGMENT.length);
  const suffix = url.slice(uploadIndex + CLOUDINARY_UPLOAD_SEGMENT.length);
  return `${prefix}${transforms}/${suffix}`;
}
