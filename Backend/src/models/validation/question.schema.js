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
    normalizedPrompt: { type: String, default: null, trim: true },
    fingerprint: { type: String, default: null, trim: true },
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

function normalizeText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s\u00A0\u2000-\u200B\u3000]+/g, " ")
    .replace(/[.,;:!?+\-*/=()\[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt) => normalizeText(opt))
    .filter((opt) => opt.length > 0)
    .sort();
}

function normalizeCorrectAnswer(answer, type) {
  if (answer === null || answer === undefined) return "";
  const normalized = normalizeText(String(answer));
  if (type === "TRUE_FALSE" || type === "BOOLEAN") {
    return normalized === "true" ? "true" : "false";
  }
  return normalized;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function generateQuestionFingerprint(doc) {
  const normalizedPrompt = normalizeText(doc.prompt);
  const normalizedOpts = normalizeOptions(doc.options);
  const normalizedCorrect = normalizeCorrectAnswer(
    doc.correctOption || doc.correctText || doc.correctBoolean,
    doc.type
  );

  const promptHash = hashString(normalizedPrompt);
  const optionsHash = hashString(normalizedOpts.join("|"));
  const correctHash = hashString(normalizedCorrect);

  return `${promptHash}:${optionsHash}:${correctHash}`;
}

QuestionValidationSchema.pre("validate", function normalizeQuestionFields(next) {
  if (this.type) {
    this.type = normalizeUpperEnumValue(this.type);
  }

  if (typeof this.explanationVideoUrl === "string" && this.explanationVideoUrl.trim() === "") {
    this.explanationVideoUrl = null;
  }

  if (this.prompt && !this.normalizedPrompt) {
    this.normalizedPrompt = normalizeText(this.prompt);
  }

  if ((this.prompt || this.options?.length || this.correctOption || this.correctText || this.correctBoolean) && !this.fingerprint) {
    this.fingerprint = generateQuestionFingerprint(this);
  }

  next();
});

module.exports = mongoose.models.QuestionValidation || mongoose.model("QuestionValidation", QuestionValidationSchema);
