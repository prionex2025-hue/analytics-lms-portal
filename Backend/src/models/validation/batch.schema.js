const mongoose = require("mongoose");
const { referenceValidator } = require("./shared");

const BatchValidationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2 },
    collegeId: { type: String, required: true, validate: referenceValidator, index: true },
    departmentId: { type: String, required: true, validate: referenceValidator, index: true },
    capacity: { type: Number, min: 1, default: 100 },
    academicYear: { type: String, default: null, trim: true },
    section: { type: String, default: null, trim: true },
    isActive: { type: Boolean, default: true },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

// Compound unique index for batch name per college+department
BatchValidationSchema.index({ collegeId: 1, departmentId: 1, name: 1 }, { unique: false });

module.exports = mongoose.models.BatchValidation || mongoose.model("BatchValidation", BatchValidationSchema);
