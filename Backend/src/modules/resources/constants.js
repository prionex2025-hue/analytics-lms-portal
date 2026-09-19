const RESOURCE_TYPES = Object.freeze({
  PDF: "PDF",
  DOCX: "DOCX",
  PPTX: "PPTX",
  ZIP: "ZIP",
  IMAGE: "IMAGE",
  LINK: "LINK",
  YOUTUBE_URL: "YOUTUBE_URL",
  GOOGLE_DRIVE_URL: "GOOGLE_DRIVE_URL",
});

const FILE_RESOURCE_TYPES = Object.freeze([
  RESOURCE_TYPES.PDF,
  RESOURCE_TYPES.DOCX,
  RESOURCE_TYPES.PPTX,
  RESOURCE_TYPES.ZIP,
  RESOURCE_TYPES.IMAGE,
]);

const LINK_RESOURCE_TYPES = Object.freeze([
  RESOURCE_TYPES.LINK,
  RESOURCE_TYPES.YOUTUBE_URL,
  RESOURCE_TYPES.GOOGLE_DRIVE_URL,
]);

const VISIBILITY_SCOPES = Object.freeze({
  COLLEGE: "COLLEGE",
  DEPARTMENT: "DEPARTMENT",
  BATCH: "BATCH",
  STUDENT: "STUDENT",
  GLOBAL: "GLOBAL",
});

const MIME_TYPES_BY_RESOURCE_TYPE = Object.freeze({
  [RESOURCE_TYPES.PDF]: ["application/pdf"],
  [RESOURCE_TYPES.DOCX]: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
  ],
  [RESOURCE_TYPES.PPTX]: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
  ],
  [RESOURCE_TYPES.ZIP]: [
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ],
  [RESOURCE_TYPES.IMAGE]: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ],
});

const EXTENSIONS_BY_RESOURCE_TYPE = Object.freeze({
  [RESOURCE_TYPES.PDF]: [".pdf"],
  [RESOURCE_TYPES.DOCX]: [".docx", ".doc"],
  [RESOURCE_TYPES.PPTX]: [".pptx", ".ppt"],
  [RESOURCE_TYPES.ZIP]: [".zip"],
  [RESOURCE_TYPES.IMAGE]: [".jpg", ".jpeg", ".png", ".webp", ".gif"],
});

const DANGEROUS_FILE_EXTENSIONS = Object.freeze([
  ".ade",
  ".adp",
  ".apk",
  ".app",
  ".bat",
  ".bin",
  ".cmd",
  ".com",
  ".cpl",
  ".dll",
  ".dmg",
  ".exe",
  ".gadget",
  ".hta",
  ".ins",
  ".iso",
  ".jar",
  ".js",
  ".jse",
  ".lnk",
  ".mjs",
  ".msc",
  ".msi",
  ".msp",
  ".pif",
  ".ps1",
  ".py",
  ".rb",
  ".reg",
  ".scr",
  ".sh",
  ".vb",
  ".vbe",
  ".vbs",
  ".ws",
  ".wsc",
  ".wsf",
  ".wsh",
]);

module.exports = {
  RESOURCE_TYPES,
  FILE_RESOURCE_TYPES,
  LINK_RESOURCE_TYPES,
  VISIBILITY_SCOPES,
  MIME_TYPES_BY_RESOURCE_TYPE,
  EXTENSIONS_BY_RESOURCE_TYPE,
  DANGEROUS_FILE_EXTENSIONS,
};
