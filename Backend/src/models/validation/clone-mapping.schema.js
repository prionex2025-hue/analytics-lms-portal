const mongoose = require("mongoose");
const { referenceValidator, optionalReferenceValidator } = require("./shared");

const CloneMappingValidationSchema = new mongoose.Schema(
  {
    sourceTestId: { type: String, required: true, validate: referenceValidator },
    clonedTestId: { type: String, required: true, validate: referenceValidator },
    targetCollegeId: { type: String, required: true, validate: referenceValidator },
    targetDepartmentId: { type: String, default: null, validate: optionalReferenceValidator },
    createdBy: { type: String, default: null, validate: optionalReferenceValidator },
    createdAt: { type: Date, default: Date.now },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

module.exports = mongoose.models.CloneMappingValidation || mongoose.model("CloneMappingValidation", CloneMappingValidationSchema);