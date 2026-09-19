const mongoose = require("mongoose");

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const normalizeEnumValue = (value) => String(value || "").trim();

const normalizeUpperEnumValue = (value) => normalizeEnumValue(value).toUpperCase();

const normalizeLowerEnumValue = (value) => normalizeEnumValue(value).toLowerCase();

const isReferenceId = (value) => {
  if (value === null || typeof value === "undefined") {
    return false;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return false;
  }

  return mongoose.Types.ObjectId.isValid(normalized) || OBJECT_ID_PATTERN.test(normalized);
};

const referenceValidator = {
  validator: isReferenceId,
  message: "{PATH} must be a valid ObjectId",
};

const optionalReferenceValidator = {
  validator: (value) => value === null || typeof value === "undefined" || isReferenceId(value),
  message: "{PATH} must be a valid ObjectId",
};

module.exports = {
  normalizeEnumValue,
  normalizeUpperEnumValue,
  normalizeLowerEnumValue,
  isReferenceId,
  referenceValidator,
  optionalReferenceValidator,
};