const mongoose = require("mongoose");
const { referenceValidator } = require("./shared");

const AnswerValidationSchema = new mongoose.Schema(
  {
    submissionId: { type: String, required: true, validate: referenceValidator, index: true },
    questionId: { type: String, required: true, validate: referenceValidator, index: true },
    selectedOption: { type: String, default: null, trim: true },
    selectedOptions: { type: [String], default: [] },
    selectedBoolean: { type: Boolean, default: null },
    selectedText: { type: String, default: null, trim: true },
    answerBoolean: { type: Boolean, default: null },
    answerText: { type: String, default: null, trim: true },
    isCorrect: { type: Boolean, default: null },
    markedForReview: { type: Boolean, default: false },
    timeSpentSeconds: { type: Number, min: 0, default: 0 },
    attemptCount: { type: Number, min: 1, default: 1 },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

// Unique constraint: one answer per submission per question
AnswerValidationSchema.index({ submissionId: 1, questionId: 1 }, { unique: true });

module.exports = mongoose.models.AnswerValidation || mongoose.model("AnswerValidation", AnswerValidationSchema);
