const mongoose = require("mongoose");

const AnswerSnapshotSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true, index: true },
    selectedOption: { type: String, default: null },
    selectedOptions: { type: [String], default: [] },
    answerText: { type: String, default: null },
    answerBoolean: { type: Boolean, default: null },
    markedForReview: { type: Boolean, default: false },
    savedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const AttemptSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    testId: { type: String, required: true, index: true },
    departmentId: { type: String, default: null, index: true },
    submissionId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["IN_PROGRESS", "SUBMITTED", "AUTO_SUBMITTED", "DISCONNECTED"],
      default: "IN_PROGRESS",
      index: true,
    },
    startedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    submittedAt: { type: Date, default: null },
    totalTimeTaken: { type: Number, default: 0 },
    answers: { type: [AnswerSnapshotSchema], default: [] },
    violationCount: { type: Number, default: 0 },
    connectionStatus: {
      type: String,
      enum: ["ONLINE", "DISCONNECTED", "OFFLINE"],
      default: "ONLINE",
      index: true,
    },
    clientSessionId: { type: String, default: null, index: true },
    lastHeartbeat: { type: Date, default: Date.now, index: true },
    completionLockAt: { type: Date, default: null },
    completedReason: { type: String, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

AttemptSchema.index({ userId: 1, testId: 1, status: 1 });
AttemptSchema.index({ testId: 1, status: 1, updatedAt: -1 });
AttemptSchema.index({ departmentId: 1, testId: 1 });

module.exports = mongoose.models.Attempt || mongoose.model("Attempt", AttemptSchema);
