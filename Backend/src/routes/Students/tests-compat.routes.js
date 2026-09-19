const express = require("express");
const db = require("../../config/db");
const env = require("../../config/env");
const { authenticate } = require("../../middleware/auth");
const validate = require("../../middleware/validate");
const { createRateLimiter, examWriteKey } = require("../../middleware/rate-limit");
const { ApiError } = require("../../utils/http");
const { bulkSaveAnswers } = require("../../services/answer.service");
const { isModuleAttempt, getModuleByKey } = require("../../services/module-attempt.service");
const { normalizeQuestionCategory } = require("../../services/test-config.service");
const {
  listOngoingTests,
  getAttemptSession,
  getSession,
  heartbeatTest,
  saveAnswer,
  submitTest,
  advanceModuleAttempt,
  reportViolation,
  getAttemptResult,
} = require("../../controllers/Students/tests.controller");
const {
  testIdOnlySchema,
  saveAnswerCompatSchema,
  submitCompatSchema,
  heartbeatCompatSchema,
  submitAttemptCompatSchema,
  advanceModuleCompatSchema,
  violationCompatSchema,
  attemptAnswersCompatSchema,
  attemptIdOnlySchema,
} = require("../../schemas/Students/tests.schema");

const router = express.Router();

const examAnswerLimiter = createRateLimiter({
  scope: "student-exam-answer",
  routeLabel: "/api/answer",
  windowMs: env.rateLimit.examAnswerWindowMs,
  max: env.rateLimit.examAnswerMax,
  keySelector: examWriteKey,
  message: "Too many answer save requests in a short window. Please wait a moment.",
});

const examHeartbeatLimiter = createRateLimiter({
  scope: "student-exam-heartbeat",
  routeLabel: "/api/attempts/:attemptId/heartbeat",
  windowMs: env.rateLimit.examHeartbeatWindowMs,
  max: env.rateLimit.examHeartbeatMax,
  keySelector: examWriteKey,
  message: "Too many heartbeat requests in a short window. Please wait a moment.",
});

const examViolationLimiter = createRateLimiter({
  scope: "student-exam-violation",
  routeLabel: "/api/attempts/:attemptId/violations",
  windowMs: env.rateLimit.examViolationWindowMs,
  max: env.rateLimit.examViolationMax,
  keySelector: examWriteKey,
  message: "Too many violation reports in a short window. Please wait a moment.",
});

const examSubmitLimiter = createRateLimiter({
  scope: "student-exam-submit",
  routeLabel: "/api/attempts/:attemptId/submit",
  windowMs: env.rateLimit.examSubmitWindowMs,
  max: env.rateLimit.examSubmitMax,
  keySelector: examWriteKey,
  message: "Submission is already in progress. Please wait for it to complete.",
});

const examListLimiter = createRateLimiter({
  scope: "student-exam-list",
  routeLabel: "/api/attempts/active",
  windowMs: env.rateLimit.examListWindowMs,
  max: env.rateLimit.examListMax,
  message: "Too many test list requests in a short window. Please wait a moment.",
});

const examSessionLimiter = createRateLimiter({
  scope: "student-exam-session",
  routeLabel: "/api/attempts/:attemptId/session",
  windowMs: env.rateLimit.examSessionWindowMs,
  max: env.rateLimit.examSessionMax,
  keySelector: (req, actorIdentity) => {
    const attemptId = req.params?.attemptId || req.body?.attemptId || req.body?.submissionId || "unknown-attempt";
    const testId = req.params?.testId || req.body?.testId || "unknown-test";
    return `${actorIdentity}:attempt:${attemptId}:test:${testId}`;
  },
  message: "Too many session fetch requests in a short window. Please wait a moment.",
});

const loadOwnedAttempt = async (req) => {
  const submission = await db.submission.findUnique({ where: { id: req.params.attemptId } });
  const sameUser = submission?.userId === req.user?.id;
  const sameCollege = !req.user?.collegeId || !submission?.collegeId || submission.collegeId === req.user.collegeId;

  if (!submission || !sameUser || !sameCollege) {
    throw new ApiError(404, "Attempt not found", null, "ATTEMPT_NOT_FOUND");
  }

  return submission;
};

const attachAttemptToTestRequest = async (req, _res, next) => {
  try {
    const submission = await loadOwnedAttempt(req);

    req.params.testId = submission.testId;
    req.body = {
      ...req.body,
      submissionId: submission.id,
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

const resolveQuestionIdLocal = (payload) => payload?.questionId || payload?.question_id || null;

const saveAttemptAnswersCompat = async (req, res, next) => {
  try {
    const submission = await loadOwnedAttempt(req);

    const test = await db.test.findUnique({
      where: { id: submission.testId },
      select: { assessmentFormat: true, modules: true, durationMins: true },
    });

    const session = await db.testSession.findUnique({
      where: { userId_testId: { userId: submission.userId, testId: submission.testId } },
      select: { moduleExpiresAt: true, currentModuleKey: true, expiresAt: true },
    });

    // Whole-test hard cap (testSession.expiresAt is Mongo-authoritative; fall
    // back to startedAt + duration). Mirrors isSubmissionExpired in
    // Students/tests.controller.js so bulk answer saves cannot outlive the
    // exam deadline like the per-question saveAnswer path.
    const sessionExpiryMs = session?.expiresAt ? new Date(session.expiresAt).getTime() : NaN;
    const fallbackExpiryMs =
      submission?.startedAt && test?.durationMins
        ? new Date(submission.startedAt).getTime() + test.durationMins * 60 * 1000
        : NaN;
    const wholeTestExpiryMs = Number.isFinite(sessionExpiryMs) ? sessionExpiryMs : fallbackExpiryMs;
    if (Number.isFinite(wholeTestExpiryMs) && Date.now() > wholeTestExpiryMs) {
      throw new ApiError(409, "Test time expired. Submission auto-submitted.", null, "TEST_TIME_EXPIRED");
    }

    // MODULE_TEST: only answers for the active module are accepted. Mirrors the
    // per-question guard in Students/tests.controller.js saveAnswer.
    if (test && isModuleAttempt(test)) {
      const requestedIds = Array.isArray(req.body?.answers)
        ? req.body.answers.map((answer) => resolveQuestionIdLocal(answer)).filter(Boolean)
        : [];

      const questions = requestedIds.length > 0
        ? await db.question.findMany({
            where: {
              testId: submission.testId,
              OR: [
                { id: { in: requestedIds } },
                { sourceQuestionId: { in: requestedIds } },
              ],
            },
            select: { id: true, sourceQuestionId: true, category: true },
          })
        : [];

      const questionById = new Map();
      for (const question of questions) {
        if (question?.id) questionById.set(String(question.id), question);
        if (question?.sourceQuestionId) questionById.set(String(question.sourceQuestionId), question);
      }

      const moduleExpiresAt = session?.moduleExpiresAt || submission.moduleExpiresAt;
      if (moduleExpiresAt && Date.now() > new Date(moduleExpiresAt).getTime()) {
        throw new ApiError(409, "Module time expired.", { currentModuleKey: submission.currentModuleKey }, "MODULE_TIME_EXPIRED");
      }

      const currentModule = getModuleByKey(test, submission.currentModuleKey || session?.currentModuleKey);
      for (const answer of req.body.answers || []) {
        const requestedId = resolveQuestionIdLocal(answer);
        if (!requestedId) continue;
        const resolved = questionById.get(String(requestedId));
        const questionCategory = normalizeQuestionCategory(resolved?.category)
          || (resolved?.category != null ? String(resolved.category) : null);
        if (!currentModule || questionCategory !== currentModule.category) {
          throw new ApiError(403, "Question does not belong to the active module", null, "QUESTION_NOT_IN_ACTIVE_MODULE");
        }
      }
    }

    const result = await bulkSaveAnswers(req.body.answers, submission.id, req.user.collegeId || submission.collegeId);

    return res.status(200).json({
      saved: true,
      success: true,
      result,
      message: "Answers saved successfully",
    });
  } catch (error) {
    return next(error);
  }
};

router.get("/attempts/active", authenticate, examListLimiter, listOngoingTests);
router.get("/attempts/:attemptId", authenticate, examSessionLimiter, validate(attemptIdOnlySchema), getAttemptSession);
router.patch("/attempts/:attemptId/answers", authenticate, examAnswerLimiter, validate(attemptAnswersCompatSchema), saveAttemptAnswersCompat);
router.patch("/attempts/:attemptId/heartbeat", authenticate, examHeartbeatLimiter, validate(heartbeatCompatSchema), attachAttemptToTestRequest, heartbeatTest);
router.post("/attempts/:attemptId/submit", authenticate, examSubmitLimiter, validate(submitAttemptCompatSchema), attachAttemptToTestRequest, submitTest);
router.post("/attempts/:attemptId/module/advance", authenticate, examSubmitLimiter, validate(advanceModuleCompatSchema), attachAttemptToTestRequest, advanceModuleAttempt);
router.post("/attempts/:attemptId/violations", authenticate, examViolationLimiter, validate(violationCompatSchema), attachAttemptToTestRequest, reportViolation);

router.get("/test/:testId", authenticate, examSessionLimiter, validate(testIdOnlySchema), getSession);
router.get("/results/:attemptId", authenticate, examSessionLimiter, validate(attemptIdOnlySchema), getAttemptResult);
router.get("/submission/:attemptId", authenticate, examSessionLimiter, validate(attemptIdOnlySchema), getAttemptResult);

router.post("/answer", authenticate, examAnswerLimiter, validate(saveAnswerCompatSchema), (req, _res, next) => {
  req.params.testId = req.body.testId;
  next();
}, saveAnswer);

router.post("/submit", authenticate, examSubmitLimiter, validate(submitCompatSchema), (req, _res, next) => {
  req.params.testId = req.body.testId;
  next();
}, submitTest);

module.exports = router;
