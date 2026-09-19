const mongoose = require("mongoose");
const {
  normalizeUpperEnumValue,
  referenceValidator,
  optionalReferenceValidator,
} = require("./shared");

const QUESTION_TYPES = [
  "MCQ",
  "MCQ_MULTI",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "TRUE_FALSE",
  "BOOLEAN",
  "FILL_BLANK",
  "PARAGRAPH",
];

const optionalHttpUrlValidator = {
  validator(value) {
    if (value == null || String(value).trim() === "") return true;
    try {
      const parsed = new URL(String(value).trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  },
  message: "explanationVideoUrl must be a valid http(s) URL",
};

const QuestionValidationSchema = new mongoose.Schema(
  {
    testId: { type: String, required: true, validate: referenceValidator },
    collegeId: { type: String, required: true, validate: referenceValidator },
    prompt: { type: String, required: true, trim: true, minlength: 1 },
    type: {
      type: String,
      required: true,
      enum: QUESTION_TYPES,
      set: normalizeUpperEnumValue,
    },
    options: { type: [mongoose.Schema.Types.Mixed], default: [] },
    correctOption: { type: String, default: null, trim: true },
    correctBoolean: { type: Boolean, default: null },
    correctText: { type: String, default: null, trim: true },
    marks: { type: Number, required: true, min: 0 },
    order: { type: Number, required: true, min: 0 },
    // MODULE_TEST question grouping. Null for OPEN_TEST (legacy/default) questions.
    category: {
      type: String,
      enum: ["Quantitative Aptitude", "Logical Reasoning", "Verbal", null],
      default: null,
    },
    explanation: { type: String, default: null, trim: true },
    explanationVideoUrl: { type: String, default: null, trim: true, maxlength: 2048, validate: optionalHttpUrlValidator },
    sourceQuestionId: { type: String, default: null, validate: optionalReferenceValidator },
    isActive: { type: Boolean, default: true },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

QuestionValidationSchema.pre("validate", function normalizeQuestionType(next) {
  if (this.type) {
    this.type = normalizeUpperEnumValue(this.type);
  }

  if (typeof this.explanationVideoUrl === "string" && this.explanationVideoUrl.trim() === "") {
    this.explanationVideoUrl = null;
  }

  next();
});

module.exports = mongoose.models.QuestionValidation || mongoose.model("QuestionValidation", QuestionValidationSchema);
