const models = require("../models");
const { validateDocument, validateDocuments } = require("./model-validation.service");
const { AnswerValidation } = require("../models/validation");
const { ApiError } = require("../utils/http");

const resolveQuestionId = (payload) => payload?.questionId || payload?.question_id || null;

const resolveAnswerBoolean = (payload) => {
  if (typeof payload?.answerBoolean === "boolean") return payload.answerBoolean;
  if (typeof payload?.selectedBoolean === "boolean") return payload.selectedBoolean;
  if (typeof payload?.answer_boolean === "boolean") return payload.answer_boolean;
  if (typeof payload?.selected_boolean === "boolean") return payload.selected_boolean;
  return null;
};

const resolveAnswerText = (payload) => {
  const raw =
    payload?.answerText
    ?? payload?.selectedText
    ?? payload?.answer_text
    ?? payload?.selected_text
    ?? null;
  return raw === null || typeof raw === "undefined" ? null : String(raw);
};

const resolveSelectedOptions = (payload) => {
  if (Array.isArray(payload?.selectedOptions)) return payload.selectedOptions;
  if (Array.isArray(payload?.selected_options)) return payload.selected_options;
  return [];
};

const normalizeAnswerPayload = (payload, { submissionId, questionId }) => {
  const answerBoolean = resolveAnswerBoolean(payload);
  const answerText = resolveAnswerText(payload);

  return {
    submissionId,
    questionId,
    selectedOption: payload?.selectedOption ?? payload?.selected_option ?? null,
    selectedOptions: resolveSelectedOptions(payload),
    answerBoolean,
    answerText,
    selectedBoolean: answerBoolean,
    selectedText: answerText,
    markedForReview: Boolean(payload?.markedForReview ?? payload?.marked_for_review),
    timeSpentSeconds: Number(payload?.timeSpentSeconds ?? payload?.time_spent_seconds ?? 0) || 0,
  };
};

/**
 * Create or update an answer with validation
 *
 * Validates:
 * - Submission and question exist
 * - Answer data is appropriate for question type
 */
async function saveAnswer(payload, submissionId, collegeId) {
  const m = await models.init();
  const db = m.dbClient;

  // Verify submission exists
  const submission = await db.submission.findUnique({ where: { id: submissionId } });
  if (!submission || submission.collegeId !== collegeId) {
    throw new ApiError(403, "Submission not found");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(422, "Cannot save answers to a completed submission", {}, "SUBMISSION_NOT_IN_PROGRESS");
  }

  let resolvedQuestionId = resolveQuestionId(payload);
  if (!resolvedQuestionId) {
    throw new ApiError(422, "questionId is required", null, "QUESTION_ID_REQUIRED");
  }

  // Verify question exists in this test
  let question = await db.question.findUnique({
    where: { id: resolvedQuestionId },
  });

  if (!question || question.testId !== submission.testId) {
    const sourceMatch = await db.question.findFirst({
      where: { sourceQuestionId: resolvedQuestionId, testId: submission.testId },
    });

    if (sourceMatch) {
      question = sourceMatch;
      resolvedQuestionId = sourceMatch.id;
    }
  }

  if (!question || question.testId !== submission.testId) {
    throw new ApiError(403, "Question not found in this test");
  }

  // Validate answer
  const validated = await validateDocument(
    AnswerValidation,
    normalizeAnswerPayload(payload, { submissionId, questionId: resolvedQuestionId }),
    "Answer save"
  );

  // Check if answer already exists (update vs create)
  const existing = await db.answer.findFirst({
    where: {
      submissionId,
      questionId: resolvedQuestionId,
    },
  });

  if (existing) {
    // Update existing
    return db.answer.update({
      where: { id: existing.id },
      data: {
        ...validated,
        attemptCount: (existing.attemptCount || 0) + 1,
      },
    });
  } else {
    // Create new
    return db.answer.create({
      data: {
        ...validated,
        id: `${submissionId}-${resolvedQuestionId}`,
      },
    });
  }
}

/**
 * Bulk save answers with validation
 *
 * Efficient bulk save during submission
 */
async function bulkSaveAnswers(answers, submissionId, collegeId) {
  const m = await models.init();
  const db = m.dbClient;

  // Verify submission exists and is in progress
  const submission = await db.submission.findUnique({ where: { id: submissionId } });
  if (!submission || submission.collegeId !== collegeId) {
    throw new ApiError(403, "Submission not found");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(422, "Cannot save answers to a completed submission");
  }

  if (!Array.isArray(answers) || answers.length === 0) {
    return { count: 0 };
  }

  const requestedIds = answers
    .map((answer) => resolveQuestionId(answer))
    .filter(Boolean);

  if (requestedIds.length !== answers.length) {
    throw new ApiError(422, "questionId is required for all answers", null, "QUESTION_ID_REQUIRED");
  }

  // Verify all questions belong to this test
  const questions = await db.question.findMany({
    where: {
      testId: submission.testId,
      OR: [
        { id: { in: requestedIds } },
        { sourceQuestionId: { in: requestedIds } },
      ],
    },
    select: { id: true, sourceQuestionId: true, type: true },
  });

  const idMap = new Map();
  for (const question of questions) {
    if (question?.id) idMap.set(String(question.id), question.id);
    if (question?.sourceQuestionId) idMap.set(String(question.sourceQuestionId), question.id);
  }

  const missingIds = requestedIds.filter((qid) => !idMap.has(String(qid)));

  if (missingIds.length > 0) {
    throw new ApiError(403, "Some questions not found in this test");
  }

  // Validate all answers
  const validated = await validateDocuments(
    AnswerValidation,
    answers.map((answer) => {
      const requestedId = resolveQuestionId(answer);
      const resolvedId = idMap.get(String(requestedId));
      return normalizeAnswerPayload(answer, { submissionId, questionId: resolvedId });
    }),
    "Bulk answer save"
  );

  // Bulk upsert in transaction
  return db.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;

    for (const answer of validated) {
      const existing = await tx.answer.findFirst({
        where: {
          submissionId: answer.submissionId,
          questionId: answer.questionId,
        },
      });

      if (existing) {
        await tx.answer.update({
          where: { id: existing.id },
          data: {
            ...answer,
            attemptCount: (existing.attemptCount || 0) + 1,
          },
        });
        updated += 1;
      } else {
        await tx.answer.create({
          data: {
            ...answer,
            id: `${answer.submissionId}-${answer.questionId}`,
          },
        });
        created += 1;
      }
    }

    return { created, updated, total: validated.length };
  });
}

/**
 * Mark answer for review
 */
async function markAnswerForReview(answerId, submissionId, collegeId, markedForReview = true) {
  const m = await models.init();
  const db = m.dbClient;

  // Verify answer and submission
  const answer = await db.answer.findUnique({ where: { id: answerId } });
  const submission = await db.submission.findUnique({ where: { id: submissionId } });

  if (!answer || !submission || submission.collegeId !== collegeId) {
    throw new ApiError(403, "Answer or submission not found");
  }

  if (answer.submissionId !== submissionId) {
    throw new ApiError(403, "Answer does not belong to this submission");
  }

  // Validate before update
  const validated = await validateDocument(
    AnswerValidation,
    {
      ...answer,
      markedForReview,
    },
    "Mark answer for review"
  );

  return db.answer.update({
    where: { id: answerId },
    data: { markedForReview: validated.markedForReview },
  });
}

/**
 * Get all answers for a submission
 */
async function getSubmissionAnswers(submissionId, collegeId) {
  const m = await models.init();
  const db = m.dbClient;

  const submission = await db.submission.findUnique({ where: { id: submissionId } });

  if (!submission || submission.collegeId !== collegeId) {
    throw new ApiError(403, "Submission not found");
  }

  return db.answer.findMany({
    where: { submissionId },
    include: {
      question: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

/**
 * Calculate accuracy for a submission
 *
 * Compares student answers against correct answers
 */
async function calculateAccuracy(submissionId, collegeId) {
  const m = await models.init();
  const db = m.dbClient;

  const submission = await db.submission.findUnique({ where: { id: submissionId } });

  if (!submission || submission.collegeId !== collegeId) {
    throw new ApiError(403, "Submission not found");
  }

  const answers = await db.answer.findMany({
    where: { submissionId },
    include: { question: true },
  });

  if (answers.length === 0) {
    return 0;
  }

  let correctCount = 0;

  for (const answer of answers) {
    const q = answer.question;

    // Check correctness based on question type
    let isCorrect = false;

    if (q.type === "MCQ" || q.type === "SINGLE_SELECT") {
      isCorrect = answer.selectedOption === q.correctOption;
    } else if (q.type === "TRUE_FALSE" || q.type === "BOOLEAN") {
      const resolvedBoolean = typeof answer.answerBoolean === "boolean"
        ? answer.answerBoolean
        : answer.selectedBoolean;
      isCorrect = resolvedBoolean === q.correctBoolean;
    } else if (q.type === "FILL_BLANK" || q.type === "PARAGRAPH") {
      // Text matching (exact or case-insensitive)
      const student = (answer.answerText ?? answer.selectedText ?? "").trim().toLowerCase();
      const correct = (q.correctText || "").trim().toLowerCase();
      isCorrect = student === correct;
    }

    if (isCorrect) {
      correctCount += 1;
    }
  }

  const accuracy = (correctCount / answers.length) * 100;

  // Update submission
  await db.submission.update({
    where: { id: submissionId },
    data: {
      accuracy,
      score: correctCount, // Could be weighted by marks
    },
  });

  return accuracy;
}

module.exports = {
  saveAnswer,
  bulkSaveAnswers,
  markAnswerForReview,
  getSubmissionAnswers,
  calculateAccuracy,
};
