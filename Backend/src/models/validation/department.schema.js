const mongoose = require("mongoose");
const { referenceValidator, optionalReferenceValidator } = require("./shared");

const DepartmentValidationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2 },
    collegeId: { type: String, required: true, validate: referenceValidator },
    headId: { type: String, default: null, validate: optionalReferenceValidator },
    isActive: { type: Boolean, default: true },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

module.exports = mongoose.models.DepartmentValidation || mongoose.model("DepartmentValidation", DepartmentValidationSchema);