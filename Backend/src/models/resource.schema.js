const mongoose = require("mongoose");

const RESOURCE_TYPES = ["PDF", "DOCX", "PPTX", "ZIP", "IMAGE", "LINK", "YOUTUBE_URL", "GOOGLE_DRIVE_URL"];
const VISIBILITY_SCOPES = ["COLLEGE", "DEPARTMENT", "BATCH", "STUDENT", "GLOBAL"];
const UPLOADER_ROLES = ["SUPER_ADMIN", "COLLEGE_ADMIN", "ADMIN", "STUDENT"];

const ResourceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, index: "text" },
    description: { type: String, trim: true, default: null },
    subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    resourceType: { type: String, required: true, enum: RESOURCE_TYPES, index: true },
    fileName: { type: String, default: null },
    originalFileName: { type: String, default: null },
    fileSize: { type: Number, default: null, min: 0 },
    filePath: { type: String, default: null, select: false },
    mimeType: { type: String, default: null },
    externalUrl: { type: String, default: null },
    visibilityScope: { type: String, required: true, enum: VISIBILITY_SCOPES },
    collegeId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    departmentIds: [{ type: mongoose.Schema.Types.ObjectId, index: true }],
    batchIds: [{ type: mongoose.Schema.Types.ObjectId, index: true }],
    studentIds: [{ type: mongoose.Schema.Types.ObjectId, index: true }],
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    uploadedByRole: { type: String, required: true, enum: UPLOADER_ROLES },
    downloadCount: { type: Number, default: 0, min: 0 },
    viewCount: { type: Number, default: 0, min: 0 },
    tags: [{ type: String, trim: true, lowercase: true }],
    isActive: { type: Boolean, default: true, index: true },
  },
  {
    collection: "resource",
    timestamps: true,
    minimize: false,
  }
);

ResourceSchema.index({ collegeId: 1, subjectId: 1 });
ResourceSchema.index({ title: "text", description: "text", tags: "text" });
ResourceSchema.index({ tags: 1 });
ResourceSchema.index({ visibilityScope: 1 });
ResourceSchema.index({ collegeId: 1, visibilityScope: 1, isActive: 1, createdAt: -1 });
ResourceSchema.index({ subjectId: 1, isActive: 1, createdAt: -1 });

module.exports = mongoose.models.Resource || mongoose.model("Resource", ResourceSchema);
