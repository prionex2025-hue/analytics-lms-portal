const models = require("../models");
const { validateDocument } = require("./model-validation.service");
const { SubmissionValidation } = require("../models/validation");
const { ApiError } = require("../utils/http");
const { validateSubmissionStatusTransition } = require("./cross-field-validators.service");
const { logValidationSuccess, logValidationFailure } = require("./validation-monitoring.service");
const { isStudentAssignedToTest } = require("./student-test-assignment.service");
const { recordExamViolation } = require("./exam-violation.service");

/**
 * Create a new submission with validation
 *
 * Validates:
 * - Student, test, college exist
 * - Test is active and student has access
 * - Submission status is valid
 */
async function createSubmission(payload, studentId, collegeId) {
  const m = await models.init();
  const db = m.dbClient;
  const start = Date.now();

  try {
    // Verify student exists
    const student = await db.student.findUnique({ where: { id: studentId } });
    if (!student || student.collegeId !== collegeId) {
      throw new ApiError(403, "Student not found");
    }

    // Verify test exists and is accessible
    const test = await db.test.findUnique({
      where: { id: payload.testId },
    });

    if (!test || test.collegeId !== collegeId) {
      throw new ApiError(403, "Test not found");
    }

    // Check if student has access to this test
    const batchAssignment = await db.testBatch.findFirst({
      where: {
        testId: test.id,
        batchId: { in: student.batchIds || [] },
      },
    });

    if (!isStudentAssignedToTest({
      test,
      student,
      hasBatchAssignment: Boolean(batchAssignment),
    })) {
      throw new ApiError(403, "Student does not have access to this test", {}, "TEST_NOT_ASSIGNED");
    }

    // Validate submission payload
    const validated = await validateDocument(
      SubmissionValidation,
      {
        userId: studentId,
        testId: payload.testId,
        collegeId,
        attemptNumber: payload.attemptNumber || 1,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        violationLimit: test.violationLimit || 20,
      },
      "Submission creation"
    );

    // Persist
    const submission = await db.submission.create({
      data: validated,
    });

    await logValidationSuccess("SubmissionValidation", "Submission creation", Date.now() - start);

    return submission;
  } catch (error) {
    if (error.statusCode) {
      await logValidationFailure("SubmissionValidation", error, "Submission creation", { studentId, collegeId, testId: payload.testId });
    }
    throw error;
  }
}

/**
 * Update submission status with validation
 *
 * Validates status transition is allowed
 */
async function updateSubmissionStatus(submissionId, newStatus, collegeId, reason = null) {
  const m = await models.init();
  const db = m.dbClient;
  const start = Date.now();

  try {
    const existing = await db.submission.findUnique({ where: { id: submissionId } });

    if (!existing || existing.collegeId !== collegeId) {
      throw new ApiError(403, "Submission not found");
    }

    // Validate status transition
    await validateSubmissionStatusTransition(existing.status, newStatus);

    // Validate with new status
    const validated = await validateDocument(
      SubmissionValidation,
      {
        ...existing,
        status: newStatus,
      },
      "Submission status update"
    );

    // Persist
    const updateData = { status: validated.status };
    if (newStatus === "SUBMITTED") {
      updateData.submittedAt = new Date();
    }

    const updated = await db.submission.update({
      where: { id: submissionId },
      data: updateData,
    });

    // Audit
    await db.auditLog.create({
      data: {
        action: "SUBMISSION_STATUS_UPDATED",
        entityType: "submission",
        entityId: submissionId,
        userId: existing.userId,
        collegeId,
        metadata: {
          from: existing.status,
          to: newStatus,
          reason,
        },
      },
    });

    await logValidationSuccess("SubmissionValidation", "Status update", Date.now() - start);

    return updated;
  } catch (error) {
    if (error.statusCode) {
      await logValidationFailure("SubmissionValidation", error, "Status update", { submissionId, collegeId, newStatus });
    }
    throw error;
  }
}

/**
 * Record violation in submission
 *
 * Tracks proctoring violations and auto-submits if limit exceeded
 */
async function recordViolation(submissionId, collegeId, violationType, metadata = {}) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.submission.findUnique({ where: { id: submissionId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Submission not found");
  }

  const { violationCount: newViolationCount } = await recordExamViolation({
    db,
    submission: existing,
    user: {
      id: existing.userId,
      collegeId: existing.collegeId,
      departmentId: existing.departmentId || null,
    },
    type: violationType,
    metadata,
  });

  const updated = await db.submission.update({
    where: { id: submissionId },
    data: {
      violationCount: newViolationCount,
    },
  });

  // Auto-submit if limit exceeded
  if (newViolationCount >= (existing.violationLimit || 20) && existing.status === "IN_PROGRESS") {
    await updateSubmissionStatus(submissionId, "AUTO_SUBMITTED", collegeId, `Auto-submitted: violation limit (${newViolationCount}/${existing.violationLimit}) reached`);
  }

  return updated;
}

/**
 * Update submission metadata (time spent, etc)
 */
async function updateSubmissionMetadata(submissionId, collegeId, updates) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.submission.findUnique({ where: { id: submissionId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Submission not found");
  }

  const validated = await validateDocument(
    SubmissionValidation,
    {
      ...existing,
      ...updates,
    },
    "Submission metadata update"
  );

  return db.submission.update({
    where: { id: submissionId },
    data: validated,
  });
}

module.exports = {
  createSubmission,
  updateSubmissionStatus,
  recordViolation,
  updateSubmissionMetadata,
};
