const mongoose = require("mongoose");
const { referenceValidator } = require("./shared");

const StudentPassoutCohortValidationSchema = new mongoose.Schema(
  {
    collegeId: { type: String, required: true, validate: referenceValidator, index: true },
    passoutYear: { type: Number, required: true, min: 2000, max: 2100, index: true },
    academicLabel: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["PROCESSING", "COMPLETED", "FAILED"],
      default: "PROCESSING",
      index: true,
    },
    promotedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    promotedByType: { type: String, enum: ["ADMIN", "SUPER_ADMIN"], required: true },
    promotedById: { type: String, required: true, validate: referenceValidator },
    totalStudents: { type: Number, min: 0, default: 0 },
    updatedSubmissions: { type: Number, min: 0, default: 0 },
    studentIds: { type: [String], default: [] },
    departmentStats: { type: [mongoose.Schema.Types.Mixed], default: [] },
    batchStats: { type: [mongoose.Schema.Types.Mixed], default: [] },
    errorMessage: { type: String, default: null },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

StudentPassoutCohortValidationSchema.index({ collegeId: 1, passoutYear: -1, createdAt: -1 });

module.exports = mongoose.models.StudentPassoutCohortValidation
  || mongoose.model("StudentPassoutCohortValidation", StudentPassoutCohortValidationSchema);
