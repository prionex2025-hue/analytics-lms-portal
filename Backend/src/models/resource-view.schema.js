const mongoose = require("mongoose");

const ResourceViewSchema = new mongoose.Schema(
  {
    resourceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userRole: { type: String, required: true },
    viewedAt: { type: Date, default: Date.now, index: true },
    collegeId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    departmentId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    batchIds: [{ type: mongoose.Schema.Types.ObjectId, index: true }],
  },
  {
    collection: "resourceView",
    timestamps: true,
    minimize: false,
  }
);

ResourceViewSchema.index({ resourceId: 1, userId: 1 });
ResourceViewSchema.index({ collegeId: 1, viewedAt: -1 });
ResourceViewSchema.index({ departmentId: 1, viewedAt: -1 });

module.exports = mongoose.models.ResourceView || mongoose.model("ResourceView", ResourceViewSchema);
