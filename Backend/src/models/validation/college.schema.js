const mongoose = require("mongoose");

const CollegeValidationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2 },
    code: { type: String, required: true, trim: true, minlength: 2, maxlength: 32 },
    location: { type: String, trim: true, default: null },
    isActive: { type: Boolean, default: true },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

module.exports = mongoose.models.CollegeValidation || mongoose.model("CollegeValidation", CollegeValidationSchema);