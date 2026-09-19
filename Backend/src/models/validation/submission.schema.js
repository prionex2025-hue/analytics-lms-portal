const mongoose = require("mongoose");
const { referenceValidator } = require("./shared");

const SUBMISSION_STATUSES = ["IN_PROGRESS", "SUBMITTED", "AUTO_SUBMITTED", "GRADED", "ARCHIVED"];

const SubmissionValidationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, validate: referenceValidator, index: true },
    testId: { type: String, required: true, validate: referenceValidator, index: true },
    collegeId: { type: String, required: true, validate: referenceValidator, index: true },
    attemptNumber: { type: Number, required: true, min: 1, default: 1 },
    score: { type: Number, min: 0, default: 0 },
    accuracy: { type: Number, min: 0, max: 100, default: 0 },
    status: {
      type: String,
      enum: SUBMISSION_STATUSES,
      default: "IN_PROGRESS",
    },
    startedAt: { type: Date, default: () => new Date() },
    agreedToInstructions: { type: Boolean, default: false },
    agreedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    timeSpentSeconds: { type: Number, min: 0, default: 0 },
    violationCount: { type: Number, min: 0, default: 0 },
    violationLimit: { type: Number, min: 1, default: 20 },
    isAutoSubmitted: { type: Boolean, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

// Compound index for user's submissions on a test
SubmissionValidationSchema.index({ userId: 1, testId: 1 });
SubmissionValidationSchema.index({ userId: 1, testId: 1, attemptNumber: 1 }, { unique: true });

module.exports = mongoose.models.SubmissionValidation || mongoose.model("SubmissionValidation", SubmissionValidationSchema);
