const { ApiError } = require("../utils/http");
const { logValidationSuccess, logValidationFailure } = require("./validation-monitoring.service");

const toValidationDetails = (error) => {
  const details = {};
  for (const issue of Object.values(error?.errors || {})) {
    if (issue?.path) {
      details[issue.path] = issue.message;
    }
  }
  return details;
};

const normalizeValidatedDocument = (document) =>
  document.toObject({
    depopulate: true,
    versionKey: false,
    minimize: false,
    transform: (_doc, ret) => ret,
  });

/**
 * Validate a single document with monitoring
 *
 * @param {Model} Model - Mongoose model (e.g., TestValidation)
 * @param {object} payload - Data to validate
 * @param {string} label - Human-readable label for logging
 * @returns {object} Validated document as plain object
 * @throws {ApiError} If validation fails
 */
async function validateDocument(Model, payload, label = Model.modelName) {
  const start = Date.now();
  const document = new Model(payload);

  try {
    await document.validate();

    const latency = Date.now() - start;
    await logValidationSuccess(Model.modelName, label, latency);

    return normalizeValidatedDocument(document);
  } catch (error) {
    const latency = Date.now() - start;

    if (error?.name === "ValidationError") {
      const apiError = new ApiError(
        422,
        `${label} validation failed`,
        toValidationDetails(error),
        `${Model.modelName.toUpperCase()}_VALIDATION_FAILED`
      );

      // Log failure to monitoring
      await logValidationFailure(Model.modelName, apiError, label, {
        latency,
      });

      throw apiError;
    }

    throw error;
  }
}

/**
 * Validate multiple documents with monitoring
 *
 * @param {Model} Model - Mongoose model
 * @param {array} rows - Array of data to validate
 * @param {string} label - Label for logging
 * @returns {array} Array of validated documents
 * @throws {ApiError} If any validation fails
 */
async function validateDocuments(Model, rows, label = Model.modelName) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const output = [];
  for (let index = 0; index < rows.length; index += 1) {
    output.push(await validateDocument(Model, rows[index], `${label}[${index}]`));
  }

  return output;
}

module.exports = {
  validateDocument,
  validateDocuments,
};