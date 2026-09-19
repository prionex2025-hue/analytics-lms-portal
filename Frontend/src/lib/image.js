const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;
const allowedAvatarTypes = new Set(["image/jpeg", "image/png"]);

export const validateImageFile = (file, { maxSizeBytes = MAX_AVATAR_SIZE_BYTES, label = "Image" } = {}) => {
  if (!file) {
    return "Please select an image file.";
  }

  if (!allowedAvatarTypes.has(file.type)) {
    return "Only JPG and PNG files are allowed.";
  }

  if (file.size > maxSizeBytes) {
    return `${label} size must be 2MB or less.`;
  }

  return null;
};

export const validateAvatarFile = (file) => validateImageFile(file, { label: "Avatar" });

const readFileAsImage = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to decode image."));
      image.src = String(reader.result || "");
    };
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });

export const cropImageToSquare = async (file) => {
  const image = await readFileAsImage(file);
  const side = Math.min(image.width, image.height);
  const offsetX = Math.floor((image.width - side) / 2);
  const offsetY = Math.floor((image.height - side) / 2);
  const outputSize = Math.min(512, side);

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Image processing is unavailable.");
  }

  ctx.drawImage(image, offsetX, offsetY, side, side, 0, 0, outputSize, outputSize);

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (nextBlob) => {
        if (!nextBlob) {
          reject(new Error("Failed to create cropped image."));
          return;
        }
        resolve(nextBlob);
      },
      outputType,
      0.92
    );
  });

  return new File([blob], file.name, {
    type: outputType,
    lastModified: Date.now(),
  });
};
