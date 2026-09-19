const mongoose = require("mongoose");
const {
  normalizeLowerEnumValue,
  optionalReferenceValidator,
} = require("./shared");
const { ROLES } = require("../../constants/roles");

const UserValidationSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, minlength: 2 },
    email: { type: String, required: true, trim: true, lowercase: true },
    role: {
      type: String,
      required: true,
      enum: [
        "student",
        "admin",
        "college_admin",
        "super_admin",
        "superadmin",
        "STUDENT",
        "ADMIN",
        "COLLEGE_ADMIN",
        "SUPER_ADMIN",
      ],
      set: normalizeLowerEnumValue,
    },
    password: { type: String, trim: true, minlength: 8, default: undefined },
    collegeId: { type: String, default: null, validate: optionalReferenceValidator },
    departmentId: { type: String, default: null, validate: optionalReferenceValidator },
    batchId: { type: String, default: null, validate: optionalReferenceValidator },
    year: { type: Number, required: true, min: 1, max: 4 },
    isActive: { type: Boolean, default: true },
    lifecycleStatus: {
      type: String,
      enum: ["ACTIVE", "ALUMNI", "SUSPENDED", "DROPPED", "BLOCKED", "GRADUATED"],
      default: "ACTIVE",
    },
    disabledReason: {
      type: String,
      enum: ["MANUAL_SUSPEND", "MANUAL_DROP", "MANUAL_BLOCK", "PASSOUT", null],
      default: null,
    },
    disabledAt: { type: Date, default: null },
    passoutYear: { type: Number, min: 2000, max: 2100, default: null },
    passoutCohortId: { type: String, default: null, validate: optionalReferenceValidator },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

UserValidationSchema.pre("validate", function normalizeRole(next) {
  if (this.role) {
    this.role = normalizeLowerEnumValue(this.role);
  }

  const role = String(this.role || "").toUpperCase();

  if (role === ROLES.SUPER_ADMIN) {
    this.collegeId = null;
    this.departmentId = null;
  }

  if (role === ROLES.COLLEGE_ADMIN) {
    if (!this.collegeId) {
      this.invalidate("collegeId", "collegeId is required for COLLEGE_ADMIN");
    }
    this.departmentId = null;
  }

  if (role === ROLES.ADMIN) {
    if (!this.collegeId) {
      this.invalidate("collegeId", "collegeId is required for ADMIN");
    }
    if (!this.departmentId) {
      this.invalidate("departmentId", "departmentId is required for ADMIN");
    }
  }

  next();
});

module.exports = mongoose.models.UserValidation || mongoose.model("UserValidation", UserValidationSchema);
