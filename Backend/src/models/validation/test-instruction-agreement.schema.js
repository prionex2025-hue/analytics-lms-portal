const mongoose = require("mongoose");
const { referenceValidator } = require("./shared");

const TestInstructionAgreementValidationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, validate: referenceValidator, index: true },
    testId: { type: String, required: true, validate: referenceValidator, index: true },
    collegeId: { type: String, required: true, validate: referenceValidator, index: true },
    agreedAt: { type: Date, default: () => new Date() },
    instructionsVersion: { type: String, default: null },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

TestInstructionAgreementValidationSchema.index({ userId: 1, testId: 1 }, { unique: true });

module.exports =
  mongoose.models.TestInstructionAgreementValidation ||
  mongoose.model("TestInstructionAgreementValidation", TestInstructionAgreementValidationSchema);
