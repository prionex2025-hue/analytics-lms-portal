/**
 * Cross-field and compound validators
 *
 * These are validation rules that check multiple fields or relationships
 * Used in services to enforce business logic before persistence
 */

const { ApiError } = require("../utils/http");
const models = require("../models");

/**
 * Validate that question marks sum to test total marks
 *
 * @param {Array} questions - Array of questions with marks
 * @param {number} totalMarks - Expected total marks
 * @throws {ApiError} if marks don't match
 */
async function validateQuestionMarksSum(questions, totalMarks) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new ApiError(422, "Questions must be a non-empty array", {}, "INVALID_QUESTIONS");
  }

  const marksSum = questions.reduce((sum, q) => sum + (q.marks || 0), 0);

  if (marksSum !== totalMarks) {
    throw new ApiError(
      422,
      "Sum of question marks must equal test total marks",
      {
        expected: totalMarks,
        actual: marksSum,
        difference: totalMarks - marksSum,
        questionCount: questions.length,
      },
      "MARKS_MISMATCH"
    );
  }

  return true;
}

/**
 * Validate test status transition
 *
 * Allowed transitions:
 * DRAFT → SCHEDULED → ACTIVE → COMPLETED
 * DRAFT → ARCHIVED
 * ACTIVE → COMPLETED
 * Any → ARCHIVED
 */
async function validateTestStatusTransition(currentStatus, newStatus) {
  const allowedTransitions = {
    DRAFT: ["SCHEDULED", "PUBLISHED", "ARCHIVED"],
    SCHEDULED: ["ACTIVE", "ARCHIVED", "DRAFT"],
    ACTIVE: ["COMPLETED", "ARCHIVED"],
    PUBLISHED: ["ARCHIVED"],
    COMPLETED: ["ARCHIVED"],
    ARCHIVED: [], // Terminal state
  };

  if (!allowedTransitions[currentStatus]) {
    throw new ApiError(422, `Unknown status: ${currentStatus}`, { currentStatus }, "INVALID_STATUS");
  }

  if (!allowedTransitions[currentStatus].includes(newStatus)) {
    throw new ApiError(
      422,
      `Cannot transition from ${currentStatus} to ${newStatus}`,
      {
        from: currentStatus,
        to: newStatus,
        allowed: allowedTransitions[currentStatus],
      },
      "INVALID_STATUS_TRANSITION"
    );
  }

  return true;
}

/**
 * Validate submission status transition
 *
 * Allowed transitions:
 * IN_PROGRESS → SUBMITTED → GRADED → ARCHIVED
 * IN_PROGRESS → GRADED (auto-submitted)
 * Any → ARCHIVED
 */
async function validateSubmissionStatusTransition(currentStatus, newStatus) {
  const allowedTransitions = {
    IN_PROGRESS: ["SUBMITTED", "AUTO_SUBMITTED", "GRADED", "ARCHIVED"],
    SUBMITTED: ["GRADED", "ARCHIVED"],
    AUTO_SUBMITTED: ["GRADED", "ARCHIVED"],
    GRADED: ["ARCHIVED"],
    ARCHIVED: [],
  };

  if (!allowedTransitions[currentStatus]) {
    throw new ApiError(422, `Unknown submission status: ${currentStatus}`, {}, "INVALID_SUBMISSION_STATUS");
  }

  if (!allowedTransitions[currentStatus].includes(newStatus)) {
    throw new ApiError(
      422,
      `Cannot transition submission from ${currentStatus} to ${newStatus}`,
      {
        from: currentStatus,
        to: newStatus,
        allowed: allowedTransitions[currentStatus],
      },
      "INVALID_SUBMISSION_STATUS_TRANSITION"
    );
  }

  return true;
}

/**
 * Validate that test time window is valid
 */
async function validateTestTimeWindow(startsAt, endsAt, durationMins) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const now = new Date();

  // Set seconds to 0 for comparison
  now.setSeconds(0, 0);
  start.setSeconds(0, 0);
  end.setSeconds(0, 0);

  if (isNaN(start.getTime())) {
    throw new ApiError(422, "Invalid start date/time", { startsAt }, "INVALID_START_TIME");
  }

  if (isNaN(end.getTime())) {
    throw new ApiError(422, "Invalid end date/time", { endsAt }, "INVALID_END_TIME");
  }

  if (start < now) {
    throw new ApiError(422, "Test start time cannot be in the past", { startsAt }, "START_TIME_PAST");
  }

  if (end <= start) {
    throw new ApiError(422, "Test end time must be after start time", { startsAt, endsAt }, "END_TIME_BEFORE_START");
  }

  // Validate duration matches window
  const windowMins = (end.getTime() - start.getTime()) / 60000;
  const tolerance = 1; // Allow 1 minute tolerance

  if (Math.abs(windowMins - durationMins) > tolerance) {
    console.warn(`Time window mismatch: window=${windowMins}min, duration=${durationMins}min`);
  }

  return true;
}

/**
 * Validate no duplicate questions in test
 */
async function validateNoDuplicateQuestions(questions) {
  if (!Array.isArray(questions)) {
    return true;
  }

  const normalized = questions.map((q) => `${q.type}:${String(q.prompt || "").trim().toLowerCase()}`);

  const unique = new Set(normalized);

  if (unique.size !== normalized.length) {
    const duplicates = normalized.filter((item, index) => normalized.indexOf(item) !== index);
    throw new ApiError(
      422,
      "Duplicate questions not allowed",
      {
        count: normalized.length,
        unique: unique.size,
        duplicateCount: normalized.length - unique.size,
        duplicates: [...new Set(duplicates)].slice(0, 10),
      },
      "DUPLICATE_QUESTIONS"
    );
  }

  return true;
}

/**
 * Validate batch name uniqueness per college+department
 */
async function validateUniqueBatchName(batchName, collegeId, departmentId, excludeBatchId = null) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.batch.findFirst({
    where: {
      name: { equals: batchName, mode: "insensitive" },
      collegeId,
      departmentId,
      ...(excludeBatchId ? { id: { not: excludeBatchId } } : {}),
    },
  });

  if (existing) {
    throw new ApiError(
      422,
      `Batch name "${batchName}" already exists in this college and department`,
      {
        name: batchName,
        collegeId,
        departmentId,
      },
      "DUPLICATE_BATCH_NAME"
    );
  }

  return true;
}

/**
 * Validate email uniqueness per college
 */
async function validateUniqueEmail(email, collegeId, excludeId = null) {
  const m = await models.init();
  const db = m.dbClient;
  const normalized = (email || "").toLowerCase();

  const existing = await db.student.findFirst({
    where: {
      email: { equals: normalized, mode: "insensitive" },
      collegeId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });

  if (existing) {
    throw new ApiError(
      422,
      `Email already registered in this college`,
      { email: normalized, collegeId },
      "DUPLICATE_EMAIL"
    );
  }

  return true;
}

/**
 * Validate assignment method consistency
 *
 * If everyone: no department/batch constraints
 * If department_wise: departmentId required
 * If batch_wise: batchIds required
 */
async function validateAssignmentMethod(assignmentMethod, departmentId, batchIds) {
  if (assignmentMethod === "everyone") {
    return true;
  }

  if (assignmentMethod === "department_wise") {
    if (!departmentId) {
      throw new ApiError(
        422,
        "Department ID required for department-wise assignment",
        { assignmentMethod, departmentId },
        "MISSING_DEPARTMENT_ID"
      );
    }
    return true;
  }

  if (assignmentMethod === "batch_wise") {
    if (!Array.isArray(batchIds) || batchIds.length === 0) {
      throw new ApiError(
        422,
        "At least one batch ID required for batch-wise assignment",
        { assignmentMethod, batchCount: batchIds?.length },
        "MISSING_BATCH_IDS"
      );
    }
    return true;
  }

  throw new ApiError(422, `Unknown assignment method: ${assignmentMethod}`, {}, "INVALID_ASSIGNMENT_METHOD");
}

module.exports = {
  validateQuestionMarksSum,
  validateTestStatusTransition,
  validateSubmissionStatusTransition,
  validateTestTimeWindow,
  validateNoDuplicateQuestions,
  validateUniqueBatchName,
  validateUniqueEmail,
  validateAssignmentMethod,
};
