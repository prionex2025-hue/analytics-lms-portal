const express = require("express");
const env = require("../../config/env");
const { authenticate } = require("../../middleware/auth");
const validate = require("../../middleware/validate");
const { createRateLimiter, examWriteKey } = require("../../middleware/rate-limit");
const {
  listOngoingTests,
  listUpcomingTests,
  getTestAccessDetails,
  agreeToTestInstructions,
  startTest,
  getSession,
  saveAnswer,
  heartbeatTest,
  reportViolation,
  submitTest,
  advanceModuleAttempt,
} = require("../../controllers/Students/tests.controller");
const {
  startTestSchema,
  agreeInstructionsSchema,
  saveAnswerSchema,
  submitSchema,
  advanceModuleSchema,
  violationSchema,
  heartbeatSchema,
  testIdOnlySchema,
} = require("../../schemas/Students/tests.schema");

const router = express.Router();

const examStartLimiter = createRateLimiter({
  scope: "student-exam-start",
  routeLabel: "/api/tests/:testId/start",
  windowMs: env.rateLimit.examStartWindowMs,
  max: env.rateLimit.examStartMax,
  failOpen: false,
  message: "Too many test start requests. Please retry shortly.",
  keySelector: (req, actorIdentity) => `${actorIdentity}:test:${req.params?.testId || "unknown-test"}`,
});

const examListLimiter = createRateLimiter({
  scope: "student-exam-list",
  routeLabel: "/api/tests/list",
  windowMs: env.rateLimit.examListWindowMs,
  max: env.rateLimit.examListMax,
  failOpen: false,
  message: "Too many test list requests in a short window. Please wait a moment.",
});

const examSessionLimiter = createRateLimiter({
  scope: "student-exam-session",
  routeLabel: "/api/tests/:testId/session",
  windowMs: env.rateLimit.examSessionWindowMs,
  max: env.rateLimit.examSessionMax,
  failOpen: false,
  keySelector: (req, actorIdentity) => `${actorIdentity}:test:${req.params?.testId || "unknown-test"}`,
  message: "Too many session fetch requests in a short window. Please wait a moment.",
});

const examAnswerLimiter = createRateLimiter({
  scope: "student-exam-answer",
  routeLabel: "/api/tests/:testId/answer",
  windowMs: env.rateLimit.examAnswerWindowMs,
  max: env.rateLimit.examAnswerMax,
  failOpen: false,
  keySelector: examWriteKey,
  message: "Too many answer save requests in a short window. Please wait a moment.",
});

const examHeartbeatLimiter = createRateLimiter({
  scope: "student-exam-heartbeat",
  routeLabel: "/api/tests/:testId/heartbeat",
  windowMs: env.rateLimit.examHeartbeatWindowMs,
  max: env.rateLimit.examHeartbeatMax,
  failOpen: false,
  keySelector: examWriteKey,
  message: "Too many heartbeat requests in a short window. Please wait a moment.",
});

const examViolationLimiter = createRateLimiter({
  scope: "student-exam-violation",
  routeLabel: "/api/tests/:testId/violation",
  windowMs: env.rateLimit.examViolationWindowMs,
  max: env.rateLimit.examViolationMax,
  failOpen: false,
  keySelector: examWriteKey,
  message: "Too many violation reports in a short window. Please wait a moment.",
});

const examSubmitLimiter = createRateLimiter({
  scope: "student-exam-submit",
  routeLabel: "/api/tests/:testId/submit",
  windowMs: env.rateLimit.examSubmitWindowMs,
  max: env.rateLimit.examSubmitMax,
  failOpen: false,
  keySelector: examWriteKey,
  message: "Submission is already in progress. Please wait for it to complete.",
});

router.get("/ongoing", authenticate, examListLimiter, listOngoingTests);
router.get("/upcoming", authenticate, examListLimiter, listUpcomingTests);
router.get("/:testId/access", authenticate, examSessionLimiter, validate(testIdOnlySchema), getTestAccessDetails);
router.post("/:testId/agree", authenticate, examStartLimiter, validate(agreeInstructionsSchema), agreeToTestInstructions);
router.post("/:testId/start", authenticate, examStartLimiter, validate(startTestSchema), startTest);
router.get("/:testId/session", authenticate, examSessionLimiter, validate(testIdOnlySchema), getSession);
router.post("/:testId/answer", authenticate, examAnswerLimiter, validate(saveAnswerSchema), saveAnswer);
router.post("/:testId/heartbeat", authenticate, examHeartbeatLimiter, validate(heartbeatSchema), heartbeatTest);
router.post("/:testId/violation", authenticate, examViolationLimiter, validate(violationSchema), reportViolation);
router.post("/:testId/submit", authenticate, examSubmitLimiter, validate(submitSchema), submitTest);
router.post("/:testId/module/advance", authenticate, examSubmitLimiter, validate(advanceModuleSchema), advanceModuleAttempt);

module.exports = router;
