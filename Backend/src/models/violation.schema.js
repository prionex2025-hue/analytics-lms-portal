const mongoose = require("mongoose");

const ViolationLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "TAB_SWITCH",
        "WINDOW_BLUR",
        "COPY_PASTE",
        "RIGHT_CLICK",
        "FULLSCREEN_EXIT",
        "SCREENSHOT_ATTEMPT",
        "DEVTOOLS_OPEN",
      ],
      required: true,
      index: true,
    },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const ViolationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    testId: { type: String, required: true, index: true },
    collegeId: { type: String, required: true, index: true },
    departmentId: { type: String, default: null, index: true },
    submissionId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        "TAB_SWITCH",
        "WINDOW_BLUR",
        "COPY_PASTE",
        "RIGHT_CLICK",
        "FULLSCREEN_EXIT",
        "SCREENSHOT_ATTEMPT",
        "DEVTOOLS_OPEN",
      ],
      required: true,
      index: true,
    },
    violationType: { type: String, default: null },
    count: { type: Number, default: 0 },
    logs: { type: [ViolationLogSchema], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    detectedAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

ViolationSchema.index({ submissionId: 1, createdAt: -1 });
ViolationSchema.index({ submissionId: 1, type: 1, createdAt: -1 });
ViolationSchema.index({ userId: 1, testId: 1 });
ViolationSchema.index({ collegeId: 1, testId: 1, createdAt: -1 });
ViolationSchema.index({ collegeId: 1, userId: 1, createdAt: -1 });
ViolationSchema.index({ departmentId: 1, testId: 1 });

module.exports = mongoose.models.Violation || mongoose.model("Violation", ViolationSchema);
