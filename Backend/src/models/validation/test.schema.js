const mongoose = require("mongoose");
const {
  normalizeUpperEnumValue,
  referenceValidator,
  optionalReferenceValidator,
} = require("./shared");
const { SYSTEM_DEFAULT_TEST_SETTINGS } = require("../../services/test-config.service");

const TEST_STATUSES = ["DRAFT", "SCHEDULED", "ACTIVE", "PUBLISHED", "ARCHIVED", "COMPLETED"];
const ASSIGNMENT_METHODS = ["everyone", "department_wise", "batch_wise"];

const TestValidationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 3 },
    subject: { type: String, default: null, trim: true },
    description: { type: String, default: null, trim: true },
    instructions: { type: String, default: null, trim: true },
    durationMins: { type: Number, min: 1, default: SYSTEM_DEFAULT_TEST_SETTINGS.durationMins },
    totalMarks: { type: Number, min: 0, default: 0 },
    attemptsAllowed: { type: Number, min: 1, default: SYSTEM_DEFAULT_TEST_SETTINGS.attemptsAllowed },
    evaluationRule: {
      type: String,
      enum: ["BEST_ATTEMPT", "LAST_ATTEMPT"],
      default: SYSTEM_DEFAULT_TEST_SETTINGS.evaluationRule,
      set: normalizeUpperEnumValue,
    },
    negativeMarkingEnabled: { type: Boolean, default: false },
    negativeMarks: { type: Number, min: 0, default: 0 },
    shuffleQuestions: { type: Boolean, default: false },
    shuffleAnswers: { type: Boolean, default: false },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    isPublished: { type: Boolean, default: false },
    status: {
      type: String,
      enum: TEST_STATUSES,
      default: "DRAFT",
      set: normalizeUpperEnumValue,
    },
    isGlobal: { type: Boolean, default: false },
    assignmentMethod: {
      type: String,
      enum: ASSIGNMENT_METHODS,
      default: "everyone",
    },
    sourceTestId: { type: String, default: null, validate: optionalReferenceValidator },
    collegeId: { type: String, required: true, validate: referenceValidator },
    departmentId: { type: String, default: null, validate: optionalReferenceValidator },
    batchId: { type: String, default: null, validate: optionalReferenceValidator },
    createdByAdminId: { type: String, required: true, validate: referenceValidator },
    testType: { type: String, default: SYSTEM_DEFAULT_TEST_SETTINGS.testType },
    assessmentFormat: { type: String, enum: ["OPEN_TEST", "MODULE_TEST"], default: "OPEN_TEST" },
    modules: {
      type: [
        new mongoose.Schema(
          {
            key: { type: String, required: true },
            name: { type: String, required: true },
            order: { type: Number, required: true, min: 1 },
            category: { type: String, required: true },
            durationMins: { type: Number, required: true, min: 1 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    proctoringPreset: { type: String, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringPreset },
    proctoringEnabled: { type: Boolean, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.enabled },
    restrictTabSwitch: { type: Boolean, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.tabSwitch === "monitored" },
    restrictCopyPaste: { type: Boolean, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.copyPaste === "monitored" },
    restrictRightClick: { type: Boolean, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.rightClickDisabled },
    requireFullscreen: { type: Boolean, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.fullscreenRequired },
    violationLimit: { type: Number, min: 0, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.violationThreshold },
    monitorWindowBlur: { type: Boolean, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.windowBlur },
    detectScreenshot: { type: Boolean, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.screenshotDetection },
    detectDevtools: { type: Boolean, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.devtoolsDetection },
    autoNextSingle: { type: Boolean, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.autoNextSingle },
    paragraphWordLimit: { type: Number, min: 0, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.paragraphWordLimit },
    proctoringConfig: { type: mongoose.Schema.Types.Mixed, default: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig },
    questions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    assignedTo: { type: [String], default: [] },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

TestValidationSchema.pre("validate", function normalizeTestFields(next) {
  if (this.status) {
    this.status = normalizeUpperEnumValue(this.status);
  }

  if (this.evaluationRule) {
    this.evaluationRule = normalizeUpperEnumValue(this.evaluationRule);
  }

  next();
});

module.exports = mongoose.models.TestValidation || mongoose.model("TestValidation", TestValidationSchema);
