const mongoose = require("mongoose");

const ResourceDownloadSchema = new mongoose.Schema(
  {
    resourceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userRole: { type: String, required: true },
    downloadedAt: { type: Date, default: Date.now, index: true },
    collegeId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    departmentId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    batchIds: [{ type: mongoose.Schema.Types.ObjectId, index: true }],
  },
  {
    collection: "resourceDownload",
    timestamps: true,
    minimize: false,
  }
);

ResourceDownloadSchema.index({ resourceId: 1, userId: 1 });
ResourceDownloadSchema.index({ collegeId: 1, downloadedAt: -1 });
ResourceDownloadSchema.index({ departmentId: 1, downloadedAt: -1 });

module.exports = mongoose.models.ResourceDownload || mongoose.model("ResourceDownload", ResourceDownloadSchema);
