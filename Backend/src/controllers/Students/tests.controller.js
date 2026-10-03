const crypto = require("crypto");
const models = require("../../models");
const {
  completeSubmission,
  calculateSubmissionScore,
  findAnswerForQuestion,
  getAnswerBoolean,
  getAnswerSelectedOption,
  getAnswerSelectedOptions,
  getAnswerText,
  isAnswerProvided,
  isQuestionCorrect,
} = require("../../services/test.service");
const {
  canRevealCorrectAnswers,
  isTestCompleted,
  maskCorrectAnswer,
  resolveReviewMode,
} = require("../../services/student-review-policy.service");
const { createAuditLog } = require("../../services/audit.service");
const { withRedisLock } = require("../../services/redis-lock.service");
const { setExamState, clearExamState } = require("../../services/exam-state-cache.service");
const { bufferHeartbeat } = require("../../services/heartbeat-buffer.service");
const { shouldEmitPresence } = require("../../services/presence-throttle.service");
const { emitToCollege, emitToUser, emitToTestRoom } = require("../../realtime/socket");
const { ApiError, asyncHandler } = require("../../utils/http");
const { getSubmissionScorePercent, getTestTotalMarks } = require("../../utils/score");
const { getCachedTestQuestions, setCachedTestQuestions } = require("../../services/test-cache.service");
const { attachResolvedTestConfiguration, normalizeQuestionCategory } = require("../../services/test-config.service");
const {
  isModuleAttempt,
  getModuleByKey,
  filterQuestionsForModule,
  buildInitialModuleState,
  advanceModule,
  autoAdvanceExpiredModules,
  buildModuleView,
} = require("../../services/module-attempt.service");
const { recordExamViolation } = require("../../services/exam-violation.service");
const {
  buildStudentAssignmentScope,
  isStudentAssignedToTest,
} = require("../../services/student-test-assignment.service");

const HEARTBEAT_STALE_SECONDS = 20;
const HEARTBEAT_FORCE_AUTOSUBMIT_SECONDS = 15 * 60;
const STUDENT_BLOCKED_TEST_STATUSES = new Set(["DRAFT", "ARCHIVED", "COMPLETED"]);
const DEFAULT_TEST_INSTRUCTIONS = [
  "Read every question carefully before answering.",
  "Do not refresh, close, or switch tabs unless instructed by an invigilator.",
  "Keep a stable internet connection. Saved answers will sync automatically when possible.",
  "Submit before the timer ends. The system may auto-submit when time expires.",
].join("\n");
const SENSITIVE_QUESTION_FIELDS = new Set([
  "answer",
  "answer_key",
  "answerKey",
  "answers",
  "correct",
  "correct_answer",
  "correctAnswer",
  "correct_boolean",
  "correctBoolean",
  "correct_option",
  "correctOption",
  "correct_options",
  "correctOptions",
  "correct_text",
  "correctText",
  "explanation",
  "explanations",
  "explanationVideoUrl",
  "explanation_video_url",
  "is_correct",
  "isCorrect",
  "solution",
  "solutions",
]);

const stripSensitiveQuestionFields = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripSensitiveQuestionFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_QUESTION_FIELDS.has(key))
      .map(([key, nestedValue]) => [key, stripSensitiveQuestionFields(nestedValue)])
  );
};

const sanitizeQuestionForStudent = (question = {}) => stripSensitiveQuestionFields(question);

const sanitizeQuestionsForStudent = (questions = []) =>
  Array.isArray(questions) ? questions.map(sanitizeQuestionForStudent) : [];

const deterministicRank = (seed, index) => {
  const hash = crypto
    .createHash("sha256")
    .update(`${seed}:${index}`)
    .digest("hex");
  return Number.parseInt(hash.slice(0, 12), 16);
};

const stableShuffle = (items = [], seed) =>
  Array.isArray(items)
    ? items
        .map((item, index) => ({ item, index, rank: deterministicRank(seed, index) }))
        .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
        .map(({ item }) => item)
    : [];

const applyStudentQuestionPresentation = (test = {}, questions = [], submissionId = null) => {
  const safeQuestions = sanitizeQuestionsForStudent(questions);
  if (!submissionId) {
    return safeQuestions;
  }

  const testId = test?.id || test?.testId || "test";
  const questionSeed = `${testId}:${submissionId}:questions`;
  const shouldShuffleQuestions = Boolean(test?.shuffleQuestions);
  const shouldShuffleAnswers = Boolean(test?.shuffleAnswers);
  const orderedQuestions = shouldShuffleQuestions
    ? stableShuffle(safeQuestions, questionSeed)
    : safeQuestions;

  if (!shouldShuffleAnswers) {
    return orderedQuestions;
  }

  return orderedQuestions.map((question, index) => {
    if (!Array.isArray(question?.options) || question.options.length < 2) {
      return question;
    }

    const questionId = question.id || question.sourceQuestionId || index;
    return {
      ...question,
      options: stableShuffle(question.options, `${testId}:${submissionId}:${questionId}:options`),
    };
  });
};

const getStudentQuestionPayload = async (testId, questions = []) => {
  let cachedQuestions = await getCachedTestQuestions(testId);
  if (!cachedQuestions) {
    cachedQuestions = sanitizeQuestionsForStudent(questions);
    await setCachedTestQuestions(testId, cachedQuestions);
  }
  return sanitizeQuestionsForStudent(cachedQuestions);
};

// For MODULE_TEST, restrict a question list to the attempt's current module so a
// student never receives questions from a previous or future module.
const scopeQuestionsToActiveModule = (test, questions, submission, session) => {
  if (!isModuleAttempt(test)) {
    return questions;
  }
  const currentKey = submission?.currentModuleKey || session?.currentModuleKey || null;
  const currentModule = getModuleByKey(test, currentKey);
  return filterQuestionsForModule(questions, currentModule);
};

// Extra response fields describing the module timeline + active-module deadline.
const moduleResponseExtras = (test, submission, session) => {
  if (!isModuleAttempt(test)) {
    return {};
  }
  return {
    assessment_format: "MODULE_TEST",
    ...buildModuleView({ test, submission, session }),
  };
};

const getClientSessionId = (req) => {
  const fromHeader = req.headers["x-test-client-id"];
  const fromBody = req.body?.clientSessionId;
  const sessionId = String(fromHeader || fromBody || "").trim();
  return sessionId || null;
};

const getSubmissionExpiryMs = (submission, session = null) => {
  const sessionExpiryMs = session?.expiresAt ? new Date(session.expiresAt).getTime() : NaN;
  if (Number.isFinite(sessionExpiryMs)) {
    return sessionExpiryMs;
  }

  const durationMins = submission?.test?.durationMins;
  const startedAt = submission?.startedAt ? new Date(submission.startedAt).getTime() : 0;
  if (!durationMins || !startedAt) {
    return NaN;
  }

  return startedAt + durationMins * 60 * 1000;
};

const isSubmissionExpired = (submission, session = null) => {
  const expiresAtMs = getSubmissionExpiryMs(submission, session);
  return Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs;
};

const hasTestEnded = (test = {}) => {
  const endsAt = test?.endsAt || test?.endDate || test?.end_date || test?.ends_at;
  if (!endsAt) return false;
  const endsAtMs = new Date(endsAt).getTime();
  return Number.isFinite(endsAtMs) && endsAtMs <= Date.now();
};

const assertStudentCanStartPublishedTest = (test = {}) => {
  const status = String(test?.status || "").trim().toUpperCase();

  if (!test?.isPublished || STUDENT_BLOCKED_TEST_STATUSES.has(status)) {
    throw new ApiError(403, "Test is not available for students", null, "TEST_NOT_AVAILABLE");
  }
};

const assertStudentTestAccess = async ({ db, test, student }) => {
  assertStudentCanStartPublishedTest(test);

  const assignedViaMapping = await db.testBatch.findFirst({
    where: {
      testId: test.id,
      batchId: { in: student.batchIds || [] },
    },
  });

  if (!isStudentAssignedToTest({
    test,
    student,
    hasBatchAssignment: Boolean(assignedViaMapping),
  })) {
    throw new ApiError(403, "Student is not assigned to this test", null, "TEST_NOT_ASSIGNED");
  }

  return { assignedViaMapping };
};

const assertTestWindowOpen = (test = {}) => {
  const now = new Date();
  const bypassWindow =
    process.env.NODE_ENV !== "production" &&
    String(process.env.K6_BYPASS_TEST_WINDOW || "").toLowerCase().match(/^(true|1|yes|on)$/);

  if (!bypassWindow && (test.startsAt > now || test.endsAt < now)) {
    throw new ApiError(403, "Test is not active", null, "TEST_NOT_ACTIVE");
  }

  return now;
};

const buildInstructionsVersion = (test = {}) =>
  crypto
    .createHash("sha256")
    .update(String(test.instructions || DEFAULT_TEST_INSTRUCTIONS))
    .digest("hex")
    .slice(0, 16);

const hasPersistedInstructionAgreement = async ({ db, userId, testId, test }) => {
  const agreement = await db.testInstructionAgreement.findUnique({
    where: { userId_testId: { userId, testId } },
  });

  return Boolean(agreement && agreement.instructionsVersion === buildInstructionsVersion(test));
};

const summarizeStudentTest = ({ test, latestSubmission = null, activeSession = null, questionCount = 0 }) => {
  const attemptsAllowed = Number(test?.attemptsAllowed || 1);
  const attemptsUsed = Number(latestSubmission?.attemptNumber || 0);
  const startsAt = test?.startsAt ? new Date(test.startsAt).getTime() : Number.NaN;
  const endsAt = test?.endsAt ? new Date(test.endsAt).getTime() : Number.NaN;
  const now = Date.now();
  const status = String(test?.status || "").toUpperCase();
  const isWindowOpen = Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && now <= endsAt;
  const hasActiveAttempt = Boolean(activeSession && !activeSession.endedAt && latestSubmission?.status === "IN_PROGRESS");
  const attemptsRemaining = Math.max(attemptsAllowed - attemptsUsed, 0);

  return {
    id: test.id,
    title: test.title,
    subject: test.subject,
    description: test.description || "",
    instructions: test.instructions || DEFAULT_TEST_INSTRUCTIONS,
    durationMins: Number(test.durationMins || 0),
    totalMarks: Number(test.totalMarks || 0),
    attemptsAllowed,
    attemptsUsed,
    attemptsRemaining,
    status,
    isPublished: Boolean(test.isPublished),
    startsAt: test.startsAt,
    endsAt: test.endsAt,
    questionCount,
    hasActiveAttempt,
    activeSubmissionId: hasActiveAttempt ? latestSubmission.id : null,
    latestSubmissionStatus: latestSubmission?.status || null,
    canStart: Boolean(test.isPublished && isWindowOpen && (hasActiveAttempt || attemptsRemaining > 0)),
    blockedReason: !test.isPublished || STUDENT_BLOCKED_TEST_STATUSES.has(status)
      ? "TEST_NOT_AVAILABLE"
      : !isWindowOpen
        ? now < startsAt ? "TEST_NOT_STARTED" : "TEST_ENDED"
        : !hasActiveAttempt && attemptsRemaining <= 0
          ? "MAX_ATTEMPTS_REACHED"
          : null,
  };
};

const heartbeatAgeSeconds = (lastHeartbeatAt) => {
  if (!lastHeartbeatAt) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - new Date(lastHeartbeatAt).getTime();
  return Math.max(0, Math.floor(ms / 1000));
};

const resolveQuestionForSubmission = async ({ db, questionId, testId }) => {
  let question = await db.question.findUnique({
    where: { id: questionId },
  });

  if (!question || question.testId !== testId) {
    question = await db.question.findFirst({
      where: {
        sourceQuestionId: questionId,
        testId,
      },
    });
  }

  if (!question || question.testId !== testId) {
    throw new ApiError(403, "Question not found in this test", null, "QUESTION_NOT_IN_TEST");
  }

  return question;
};

const formatAnswerValue = (value) => {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not answered";
  if (value == null) return "Not answered";
  if (typeof value === "boolean") return value ? "True" : "False";
  const text = String(value).trim();
  return text || "Not answered";
};

const resolveStudentAnswerValue = (answer, type) => {
  if (!answer) return null;
  if (type === "MCQ_MULTI" || type === "MULTI_SELECT") return getAnswerSelectedOptions(answer);
  if (type === "TRUE_FALSE" || type === "BOOLEAN") return getAnswerBoolean(answer);
  return getAnswerSelectedOption(answer) ?? getAnswerText(answer) ?? getAnswerBoolean(answer);
};

const assertSessionOwnership = async ({ db, req, userId, testId, submissionId }) => {
  const session = await db.testSession.findUnique({
    where: { userId_testId: { userId, testId } },
  });

  if (!session || session.endedAt) {
    throw new ApiError(409, "No active test session", null, "NO_ACTIVE_SESSION");
  }

  if (submissionId && String(session.submissionId) !== String(submissionId)) {
    throw new ApiError(409, "Submission does not match active session", null, "SESSION_SUBMISSION_MISMATCH");
  }

  const clientSessionId = getClientSessionId(req);
  if (session.clientSessionId && clientSessionId && String(session.clientSessionId) !== String(clientSessionId)) {
    // Allow device/tab takeover for the same authenticated student.
    await db.testSession.updateMany({
      where: {
        userId,
        testId,
        endedAt: null,
      },
      data: {
        clientSessionId,
        connectionStatus: "ONLINE",
        lastHeartbeatAt: new Date(),
      },
    });

    session.clientSessionId = clientSessionId;
  }

  return { session, clientSessionId };
};

const upsertSessionHeartbeat = async ({ db, userId, testId, submissionId, clientSessionId }) => {
  const heartbeatAt = new Date();
  await db.testSession.updateMany({
    where: {
      userId,
      testId,
      endedAt: null,
    },
    data: {
      submissionId,
      lastHeartbeatAt: heartbeatAt,
      connectionStatus: "ONLINE",
      ...(clientSessionId ? { clientSessionId } : {}),
    },
  });

  await db.submission.updateMany({
    where: { id: submissionId },
    data: {
      lastHeartbeat: heartbeatAt,
      connectionStatus: "ONLINE",
    },
  });
};

const listOngoingTests = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const now = new Date();
  const tests = await db.test.findMany({
    where: {
      ...buildStudentAssignmentScope(req.user),
      startsAt: { lte: now },
      endsAt: { gte: now },
      isPublished: true,
    },
    include: {
      questions: {
        select: { id: true },
      },
      submissions: {
        where: {
          userId: req.user.id,
        },
        orderBy: { updatedAt: "desc" },
        include: {
          answers: true,
          violations: true,
        },
      },
    },
    orderBy: { startsAt: "asc" },
  });

  const payload = tests.map((test) => {
    const resolvedTest = attachResolvedTestConfiguration(test);
    const latestSubmission = test.submissions[0] || null;
    const attemptsUsed = test.submissions.length;
    const attemptsAllowed = Number(test.attemptsAllowed || 1);
    const attemptsRemaining = Math.max(attemptsAllowed - attemptsUsed, 0);
    const hasSubmitted = Boolean(latestSubmission && latestSubmission.status !== "IN_PROGRESS");
    const canTryAgain = hasSubmitted && attemptsRemaining > 0;
    const isCompleted = hasSubmitted && attemptsRemaining <= 0;

    const inProgressSubmission = latestSubmission?.status === "IN_PROGRESS" ? latestSubmission : null;
    const totalQuestions = test.questions?.length || 0;
    const answered = (inProgressSubmission?.answers || []).filter(isAnswerProvided).length;

    const progress = inProgressSubmission
      ? totalQuestions > 0
        ? Math.floor((answered / totalQuestions) * 100)
        : 0
      : hasSubmitted
        ? 100
        : 0;

    return {
      ...resolvedTest,
      progress,
      violationCount: inProgressSubmission?.violations?.length || 0,
      submissionId: inProgressSubmission?.id || null,
      latestSubmissionStatus: latestSubmission?.status || null,
      latestSubmissionId: latestSubmission?.id || null,
      attemptsUsed,
      attemptsAllowed,
      attemptsRemaining,
      canTryAgain,
      isCompleted,
    };
  });

  res.status(200).json(payload);
});

const listUpcomingTests = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const now = new Date();
  const tests = await db.test.findMany({
    where: {
      ...buildStudentAssignmentScope(req.user),
      isPublished: true,
      startsAt: { gt: now },
    },
    orderBy: { startsAt: "asc" },
  });

  res.status(200).json(tests.map((test) => attachResolvedTestConfiguration(test)));
});

const getTestAccessDetails = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const userId = req.user.id;

  const test = await db.test.findUnique({
    where: { id: testId },
    include: {
      questions: {
        select: { id: true },
      },
    },
  });

  if (!test) {
    throw new ApiError(404, "Test not found", null, "TEST_NOT_FOUND");
  }

  await assertStudentTestAccess({ db, test, student: req.user });

  const [latestSubmission, activeSession] = await Promise.all([
    db.submission.findFirst({
      where: { userId, testId },
      orderBy: { attemptNumber: "desc" },
    }),
    db.testSession.findUnique({
      where: { userId_testId: { userId, testId } },
    }),
  ]);

  res.status(200).json({
    serverTime: Date.now(),
    test: summarizeStudentTest({
      test,
      latestSubmission,
      activeSession,
      questionCount: Array.isArray(test.questions) ? test.questions.length : 0,
    }),
  });
});

const agreeToTestInstructions = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;

  const test = await db.test.findUnique({
    where: { id: testId },
    include: {
      questions: {
        select: { id: true },
      },
    },
  });

  if (!test) {
    throw new ApiError(404, "Test not found", null, "TEST_NOT_FOUND");
  }

  await assertStudentTestAccess({ db, test, student: req.user });
  assertTestWindowOpen(test);

  const agreedAt = new Date();
  await db.testInstructionAgreement.upsert({
    where: { userId_testId: { userId: req.user.id, testId } },
    update: {
      collegeId: req.user.collegeId,
      agreedAt,
      instructionsVersion: buildInstructionsVersion(test),
    },
    create: {
      userId: req.user.id,
      testId,
      collegeId: req.user.collegeId,
      agreedAt,
      instructionsVersion: buildInstructionsVersion(test),
    },
  });

  await createAuditLog({
    action: "STUDENT_TEST_INSTRUCTIONS_AGREED",
    targetType: "TEST",
    targetId: testId,
    collegeId: req.user.collegeId,
    testId,
    afterState: {
      studentId: req.user.id,
      agreedAt,
    },
  });

  res.status(200).json({
    ok: true,
    agreed: true,
    serverTime: Date.now(),
    test: summarizeStudentTest({
      test,
      questionCount: Array.isArray(test.questions) ? test.questions.length : 0,
    }),
  });
});

const startTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const userId = req.user.id;
  const clientSessionId = getClientSessionId(req);

  return withRedisLock({
    lockKey: `lock:test-start:user:${userId}:test:${testId}`,
    ttlMs: 10_000,
    waitTimeoutMs: 2_000,
    onLockTimeout: async () => {
      const test = await db.test.findUnique({
        where: { id: testId },
        include: { questions: { orderBy: { order: "asc" } } },
      });

      if (!test) {
        throw new ApiError(404, "Test not found");
      }

      await assertStudentTestAccess({ db, test, student: req.user });

      const existingSession = await db.testSession.findUnique({
        where: { userId_testId: { userId, testId } },
      });

      if (existingSession && !existingSession.endedAt) {
        const submission = await db.submission.findUnique({
          where: { id: existingSession.submissionId },
          include: { answers: true, violations: true },
        });

        if (submission && submission.status === "IN_PROGRESS") {
          const cachedQuestions = await getStudentQuestionPayload(testId, test.questions);
          const scopedQuestions = scopeQuestionsToActiveModule(test, cachedQuestions, submission, existingSession);
          const presentedQuestions = applyStudentQuestionPresentation(test, scopedQuestions, submission.id);

          const hydratedTest = attachResolvedTestConfiguration({
            ...test,
            questions: presentedQuestions,
          });
          const extras = moduleResponseExtras(test, submission, existingSession);

          return res.status(200).json({
            resumed: true,
            serverTime: Date.now(),
            server_end_time: new Date(existingSession.expiresAt).getTime(),
            test_type: hydratedTest.test_type,
            proctoring_config: hydratedTest.proctoring_config,
            question_order: Array.isArray(presentedQuestions)
              ? presentedQuestions.map((question) => question.id).filter(Boolean)
              : [],
            questions: presentedQuestions,
            session: {
              connectionStatus:
                heartbeatAgeSeconds(existingSession.lastHeartbeatAt) > HEARTBEAT_STALE_SECONDS ? "DISCONNECTED" : "ONLINE",
            },
            submission,
            test: hydratedTest,
            ...extras,
          });
        }
      }

      throw new ApiError(429, "Another start request is in progress. Please retry.", null, "SESSION_START_LOCKED");
    },
    task: async () => {

  const test = await db.test.findUnique({
    where: { id: testId },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  await assertStudentTestAccess({ db, test, student: req.user });

  // Build sanitized question list for student view (no correct answers).
  // Cache it so 500+ concurrent startTest requests don't all hit MongoDB.
  const cachedQuestions = await getStudentQuestionPayload(testId, test.questions);

  // Resuming an in-progress attempt is governed by the attempt's own expiry
  // (see isSubmissionExpired / forceAutoSubmit below), not the test window.
  // The window is only enforced when starting a *new* attempt, so a student
  // whose personal duration extends past endsAt can still resume.
  const now = new Date();

  let existingSession = await db.testSession.findUnique({
    where: { userId_testId: { userId, testId } },
  });

  if (existingSession && !existingSession.endedAt) {
    let submission = await db.submission.findUnique({
      where: { id: existingSession.submissionId },
      include: { answers: true, violations: true },
    });

    // MODULE_TEST: on resume, auto-advance any module whose server deadline has
    // passed before deciding how to respond (reconnect-after-expiry handling).
    if (submission && submission.status === "IN_PROGRESS" && isModuleAttempt(test)) {
      const adv = await autoAdvanceExpiredModules({
        db,
        test,
        submission,
        session: existingSession,
        now,
        reloadSubmission: () =>
          db.submission.findUnique({ where: { id: submission.id }, include: { answers: true, violations: true } }),
        reloadSession: () => db.testSession.findUnique({ where: { userId_testId: { userId, testId } } }),
      });
      submission = adv.submission || submission;
      existingSession = adv.session || existingSession;
    }

    if (!submission) {
      // Stale session without a valid submission - clean it up and allow fresh start.
      await db.testSession.updateMany({
        where: { userId, testId, endedAt: null },
        data: { endedAt: now, connectionStatus: "OFFLINE" },
      });
      await clearExamState({ userId, testId });
      // Fall through to create a new session below.
    } else {
      const sessionExpired = new Date(existingSession.expiresAt) <= now;
      const forceAutoSubmit = heartbeatAgeSeconds(existingSession.lastHeartbeatAt) > HEARTBEAT_FORCE_AUTOSUBMIT_SECONDS;

      if (submission.status !== "IN_PROGRESS") {
        await db.testSession.updateMany({
          where: { userId, testId, endedAt: null },
          data: { endedAt: now, connectionStatus: "OFFLINE" },
        });
        await clearExamState({ userId, testId });
        // Fall through to create a new session below.
      } else if (sessionExpired || forceAutoSubmit) {
        // Auto-submit stale or expired attempts so they cannot be reopened.
        await completeSubmission({ submissionId: submission.id, autoSubmitted: true });
        await db.testSession.updateMany({
          where: { userId, testId, endedAt: null },
          data: { endedAt: now, connectionStatus: "OFFLINE" },
        });
        await clearExamState({ userId, testId });
        // Fall through to create a new session below.
      } else {
        // Valid active session - resume it.
        await upsertSessionHeartbeat({
          db,
          userId,
          testId,
          submissionId: submission.id,
          clientSessionId,
        });

        await setExamState({
          userId,
          testId,
          state: {
            submissionId: submission.id,
            status: submission.status,
            lastHeartbeatAt: new Date(),
            connectionStatus: "ONLINE",
          },
        });

        const scopedQuestions = scopeQuestionsToActiveModule(test, cachedQuestions, submission, existingSession);
        const presentedQuestions = applyStudentQuestionPresentation(test, scopedQuestions, submission.id);
        const hydratedTest = attachResolvedTestConfiguration({
          ...test,
          questions: presentedQuestions,
        });
        const extras = moduleResponseExtras(test, submission, existingSession);

        return res.status(200).json({
          resumed: true,
          serverTime: Date.now(),
          server_end_time: new Date(existingSession.expiresAt).getTime(),
          test_type: hydratedTest.test_type,
          proctoring_config: hydratedTest.proctoring_config,
          question_order: Array.isArray(presentedQuestions) ? presentedQuestions.map((question) => question.id).filter(Boolean) : [],
          questions: presentedQuestions,
          session: {
            connectionStatus:
              heartbeatAgeSeconds(existingSession.lastHeartbeatAt) > HEARTBEAT_STALE_SECONDS ? "DISCONNECTED" : "ONLINE",
          },
          submission,
          test: hydratedTest,
          ...extras,
        });
      }
    }
  }

  // Starting a fresh attempt requires the test window to be open. (Resuming an
  // existing attempt returned earlier, so this only gates new attempts.)
  assertTestWindowOpen(test);

  const hasAgreement = await hasPersistedInstructionAgreement({ db, userId, testId, test });
  if (!hasAgreement) {
    throw new ApiError(
      428,
      "Read and agree to the test instructions before starting the exam.",
      { testId },
      "TEST_INSTRUCTIONS_AGREEMENT_REQUIRED"
    );
  }

  let latestSubmission = await db.submission.findFirst({
    where: { userId, testId },
    orderBy: { attemptNumber: "desc" },
    include: { answers: true, violations: true },
  });

  if (latestSubmission?.status === "IN_PROGRESS" && isSubmissionExpired({ ...latestSubmission, test })) {
    await completeSubmission({ submissionId: latestSubmission.id, autoSubmitted: true });
    await clearExamState({ userId, testId });
    latestSubmission = await db.submission.findFirst({
      where: { userId, testId },
      orderBy: { attemptNumber: "desc" },
      include: { answers: true, violations: true },
    });
  }

  const attemptsAllowed = Number(test.attemptsAllowed) || 1;
  const currentAttemptCount = latestSubmission?.attemptNumber || 0;

  if (currentAttemptCount >= attemptsAllowed && latestSubmission?.status !== "IN_PROGRESS") {
    throw new ApiError(403, "Maximum attempts reached for this test");
  }

  const isResumingInProgressSubmission = latestSubmission?.status === "IN_PROGRESS";
  const submission =
    isResumingInProgressSubmission
      ? latestSubmission
      : await db.submission
          .create({
            data: {
              userId,
              testId,
              collegeId: req.user.collegeId,
              attemptNumber: currentAttemptCount + 1,
              status: "IN_PROGRESS",
              startedAt: now,
              agreedToInstructions: true,
              agreedAt: now,
            },
          })
          .catch(async () => {
            // If two start requests race, use the latest in-progress submission.
            const inProgress = await db.submission.findFirst({
              where: {
                userId,
                testId,
                status: "IN_PROGRESS",
              },
              orderBy: { updatedAt: "desc" },
            });

            if (!inProgress) {
              throw new ApiError(409, "Unable to start test session", null, "SESSION_START_CONFLICT");
            }

            return inProgress;
          });

  await db.testSession.upsert({
    where: {
      userId_testId: { userId, testId },
    },
    update: {
      submissionId: submission.id,
      startedAt: submission.startedAt || now,
      expiresAt: new Date(new Date(submission.startedAt || now).getTime() + test.durationMins * 60 * 1000),
      endedAt: null,
      lastHeartbeatAt: now,
      connectionStatus: "ONLINE",
      ...(clientSessionId ? { clientSessionId } : {}),
    },
    create: {
      userId,
      testId,
      submissionId: submission.id,
      startedAt: submission.startedAt || now,
      expiresAt: new Date(new Date(submission.startedAt || now).getTime() + test.durationMins * 60 * 1000),
      lastHeartbeatAt: now,
      connectionStatus: "ONLINE",
      ...(clientSessionId ? { clientSessionId } : {}),
    },
  });

  await db.submission.updateMany({
    where: { id: submission.id },
    data: {
      lastHeartbeat: now,
      connectionStatus: "ONLINE",
    },
  });

  // MODULE_TEST: initialize the module state machine for a fresh attempt. The
  // whole-test hard cap (testSession.expiresAt) already equals start + sum of
  // module durations because durationMins is stored as that sum.
  if (isModuleAttempt(test) && !isResumingInProgressSubmission) {
    const moduleInit = buildInitialModuleState(test, submission.startedAt || now);
    await db.submission.updateMany({
      where: { id: submission.id },
      data: {
        moduleState: moduleInit.moduleState,
        currentModuleKey: moduleInit.currentModuleKey,
        moduleExpiresAt: moduleInit.moduleExpiresAt,
      },
    });
    await db.testSession.updateMany({
      where: { userId, testId, endedAt: null },
      data: {
        currentModuleKey: moduleInit.currentModuleKey,
        moduleExpiresAt: moduleInit.moduleExpiresAt,
        moduleOrder: 1,
      },
    });
    submission.moduleState = moduleInit.moduleState;
    submission.currentModuleKey = moduleInit.currentModuleKey;
    submission.moduleExpiresAt = moduleInit.moduleExpiresAt;
  }

  await setExamState({
    userId,
    testId,
    state: {
      submissionId: submission.id,
      status: submission.status,
      lastHeartbeatAt: now,
      connectionStatus: "ONLINE",
      progress: 0,
      violationCount: 0,
    },
  });

  await createAuditLog({
    action: "STUDENT_TEST_SESSION_STARTED",
    targetType: "SUBMISSION",
    targetId: submission.id,
    collegeId: req.user.collegeId,
    testId,
    afterState: {
      status: submission.status,
      attemptNumber: submission.attemptNumber,
      startedAt: submission.startedAt,
    },
  });

  emitToUser(req.user.id, "test:session:started", {
    testId,
    submissionId: submission.id,
    attemptNumber: submission.attemptNumber,
    resumed: false,
  });
  emitToCollege(req.user.collegeId, "student_status_update", {
    testId,
    submissionId: submission.id,
    studentId: req.user.id,
    status: "IN_PROGRESS",
    progress: 0,
    connectionStatus: "ONLINE",
    violations: 0,
  }, { departmentId: req.user.departmentId || null });
  emitToTestRoom(testId, "student_status_update", {
    testId,
    submissionId: submission.id,
    studentId: req.user.id,
    status: "IN_PROGRESS",
    progress: 0,
    connectionStatus: "ONLINE",
    violations: 0,
  });

      const sessionForView = {
        currentModuleKey: submission.currentModuleKey,
        moduleExpiresAt: submission.moduleExpiresAt,
      };
      const scopedQuestions = scopeQuestionsToActiveModule(test, cachedQuestions, submission, sessionForView);
      const presentedQuestions = applyStudentQuestionPresentation(test, scopedQuestions, submission.id);
      const hydratedTest = attachResolvedTestConfiguration({
        ...test,
        questions: presentedQuestions,
      });
      const extras = moduleResponseExtras(test, submission, sessionForView);

      return res.status(200).json({
        resumed: isResumingInProgressSubmission,
        serverTime: Date.now(),
        server_end_time: new Date(new Date(submission.startedAt || now).getTime() + test.durationMins * 60 * 1000).getTime(),
        test_type: hydratedTest.test_type,
        proctoring_config: hydratedTest.proctoring_config,
        question_order: Array.isArray(presentedQuestions) ? presentedQuestions.map((question) => question.id).filter(Boolean) : [],
        questions: presentedQuestions,
        submission,
        test: hydratedTest,
        ...extras,
      });
    },
  });
});

const getSession = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const userId = req.user.id;

  const { session, clientSessionId } = await assertSessionOwnership({
    db,
    req,
    userId,
    testId,
  });

  const reloadGetSessionSubmission = () =>
    db.submission.findFirst({
      where: { userId, testId, status: "IN_PROGRESS" },
      orderBy: { attemptNumber: "desc" },
      include: {
        answers: true,
        violations: true,
        test: { include: { questions: { orderBy: { order: "asc" } } } },
      },
    });

  let submission = await reloadGetSessionSubmission();

  if (!submission) {
    throw new ApiError(404, "No existing session found");
  }

  if (isSubmissionExpired(submission, session)) {
    const completed = await completeSubmission({ submissionId: submission.id, autoSubmitted: true });
    throw new ApiError(409, "Test time expired. Submission auto-submitted.", { submission: completed }, "TEST_TIME_EXPIRED");
  }

  const idleSeconds = heartbeatAgeSeconds(session.lastHeartbeatAt);
  if (idleSeconds > HEARTBEAT_FORCE_AUTOSUBMIT_SECONDS) {
    const completed = await completeSubmission({ submissionId: submission.id, autoSubmitted: true });
    throw new ApiError(
      409,
      "Session expired due to inactivity. Submission auto-submitted.",
      { submission: completed },
      "SESSION_INACTIVITY_AUTOSUBMITTED"
    );
  }

  // MODULE_TEST: settle any expired module before returning the current view.
  let moduleSession = session;
  if (isModuleAttempt(submission.test)) {
    const adv = await autoAdvanceExpiredModules({
      db,
      test: submission.test,
      submission,
      session,
      now: new Date(),
      reloadSubmission: reloadGetSessionSubmission,
      reloadSession: () => db.testSession.findUnique({ where: { userId_testId: { userId, testId } } }),
    });
    submission = adv.submission || submission;
    moduleSession = adv.session || session;

    if (!submission || submission.status !== "IN_PROGRESS") {
      const completed = submission || (await db.submission.findFirst({ where: { userId, testId }, orderBy: { attemptNumber: "desc" } }));
      throw new ApiError(409, "Test time expired. Submission auto-submitted.", { submission: completed }, "TEST_TIME_EXPIRED");
    }
  }

  const buffered = await bufferHeartbeat({
    userId,
    testId,
    submissionId: submission.id,
  });

  if (!buffered) {
    await upsertSessionHeartbeat({
      db,
      userId,
      testId,
      submissionId: submission.id,
      clientSessionId,
    });
  }

  await setExamState({
    userId,
    testId,
    state: {
      submissionId: submission.id,
      status: submission.status,
      lastHeartbeatAt: new Date(),
      connectionStatus: idleSeconds > HEARTBEAT_STALE_SECONDS ? "DISCONNECTED" : "ONLINE",
    },
  });

  const scopedQuestions = scopeQuestionsToActiveModule(
    submission.test,
    sanitizeQuestionsForStudent(submission.test?.questions),
    submission,
    moduleSession
  );
  const hydratedTest = attachResolvedTestConfiguration({
    ...submission.test,
    questions: applyStudentQuestionPresentation(submission.test, scopedQuestions, submission.id),
  });
  const extras = moduleResponseExtras(submission.test, submission, moduleSession);

  res.status(200).json({
    ...submission,
    test: hydratedTest,
    serverTime: Date.now(),
    server_end_time: new Date(session.expiresAt).getTime(),
    test_type: hydratedTest?.test_type || null,
    proctoring_config: hydratedTest?.proctoring_config || null,
    session: {
      connectionStatus: idleSeconds > HEARTBEAT_STALE_SECONDS ? "DISCONNECTED" : "ONLINE",
      lastHeartbeatAt: session.lastHeartbeatAt,
    },
    ...extras,
  });
});

const getAttemptSession = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { attemptId } = req.params;
  const reloadAttempt = () =>
    db.submission.findUnique({
      where: { id: attemptId },
      include: {
        answers: true,
        violations: true,
        test: { include: { questions: { orderBy: { order: "asc" } } } },
      },
    });
  let submission = await reloadAttempt();

  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Attempt not found", null, "ATTEMPT_NOT_FOUND");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Attempt already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  let session = await db.testSession.findUnique({
    where: { userId_testId: { userId: req.user.id, testId: submission.testId } },
  });

  if (!session || session.endedAt) {
    throw new ApiError(409, "No active session for attempt", null, "NO_ACTIVE_SESSION");
  }

  if (isSubmissionExpired(submission, session)) {
    const completed = await completeSubmission({ submissionId: submission.id, autoSubmitted: true });
    throw new ApiError(409, "Test time expired. Submission auto-submitted.", { submission: completed }, "TEST_TIME_EXPIRED");
  }

  // MODULE_TEST: settle expired modules before returning the current view.
  if (isModuleAttempt(submission.test)) {
    const adv = await autoAdvanceExpiredModules({
      db,
      test: submission.test,
      submission,
      session,
      now: new Date(),
      reloadSubmission: reloadAttempt,
      reloadSession: () => db.testSession.findUnique({ where: { userId_testId: { userId: req.user.id, testId: submission.testId } } }),
    });
    submission = adv.submission || submission;
    session = adv.session || session;

    if (!submission || submission.status !== "IN_PROGRESS") {
      const completed = submission || (await db.submission.findUnique({ where: { id: attemptId } }));
      throw new ApiError(409, "Test time expired. Submission auto-submitted.", { submission: completed }, "TEST_TIME_EXPIRED");
    }
  }

  const scopedQuestions = scopeQuestionsToActiveModule(
    submission.test,
    sanitizeQuestionsForStudent(submission.test?.questions),
    submission,
    session
  );
  const hydratedTest = attachResolvedTestConfiguration({
    ...submission.test,
    questions: applyStudentQuestionPresentation(submission.test, scopedQuestions, submission.id),
  });
  const extras = moduleResponseExtras(submission.test, submission, session);

  res.status(200).json({
    ...submission,
    test: hydratedTest,
    serverTime: Date.now(),
    server_end_time: new Date(session.expiresAt).getTime(),
    attempt_id: submission.id,
    test_id: submission.testId,
    test_type: hydratedTest?.test_type || null,
    proctoring_config: hydratedTest?.proctoring_config || null,
    question_order: Array.isArray(hydratedTest?.questions) ? hydratedTest.questions.map((question) => question.id).filter(Boolean) : [],
    questions: Array.isArray(hydratedTest?.questions) ? hydratedTest.questions : [],
    session: {
      connectionStatus: heartbeatAgeSeconds(session.lastHeartbeatAt) > HEARTBEAT_STALE_SECONDS ? "DISCONNECTED" : "ONLINE",
      lastHeartbeatAt: session.lastHeartbeatAt,
    },
    ...extras,
  });
});

const heartbeatTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const { submissionId } = req.body;
  const userId = req.user.id;

  const { session, clientSessionId } = await assertSessionOwnership({
    db,
    req,
    userId,
    testId,
    submissionId,
  });

  const submission = await db.submission.findUnique({
    where: { id: session.submissionId },
    include: { test: { select: { durationMins: true } } },
  });

  if (!submission || submission.userId !== userId) {
    throw new ApiError(404, "Submission not found", null, "SUBMISSION_NOT_FOUND");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Submission already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  if (isSubmissionExpired(submission, session)) {
    const completed = await completeSubmission({ submissionId: submission.id, autoSubmitted: true });
    return res.status(200).json({
      ok: false,
      autoSubmitted: true,
      reason: "TEST_TIME_EXPIRED",
      submission: completed,
    });
  }

  const heartbeatBuffered = await bufferHeartbeat({
    userId,
    testId,
    submissionId: submission.id,
  });

  if (!heartbeatBuffered) {
    await upsertSessionHeartbeat({
      db,
      userId,
      testId,
      submissionId: submission.id,
      clientSessionId,
    });
  }

  await setExamState({
    userId,
    testId,
    state: {
      submissionId: submission.id,
      status: submission.status,
      lastHeartbeatAt: new Date(),
      connectionStatus: "ONLINE",
    },
  });

  // Push a throttled presence event to the monitoring room (at most one per
  // student per interval) so admins see connection status in near real time
  // instead of waiting for their keep-alive poll. Intentionally carries no
  // progress/time fields: the monitor's merge treats it as presence only.
  if (shouldEmitPresence(submission.id)) {
    emitToTestRoom(testId, "student_status_update", {
      testId,
      submissionId: submission.id,
      studentId: userId,
      connectionStatus: "ONLINE",
      lastHeartbeatAt: new Date().toISOString(),
    });
  }

  res.status(200).json({
    ok: true,
    submissionId: submission.id,
    serverTime: Date.now(),
    server_end_time: new Date(session.expiresAt).getTime(),
  });
});


const saveAnswer = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const {
    submissionId,
    questionId,
    selectedOption,
    selectedOptions,
    answerText,
    answerBoolean,
    markedForReview,
  } = req.body;

  const { session, clientSessionId } = await assertSessionOwnership({
    db,
    req,
    userId: req.user.id,
    testId: req.params.testId,
    submissionId,
  });

  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: { test: { select: { violationLimit: true, durationMins: true, assessmentFormat: true, modules: true } } },
  });
  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Submission not found");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Submission already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  if (isSubmissionExpired(submission, session)) {
    const completed = await completeSubmission({ submissionId, autoSubmitted: true });
    throw new ApiError(409, "Test time expired. Submission auto-submitted.", { submission: completed }, "TEST_TIME_EXPIRED");
  }

  await upsertSessionHeartbeat({
    db,
    userId: req.user.id,
    testId: submission.testId,
    submissionId,
    clientSessionId,
  });

  const resolvedQuestion = await resolveQuestionForSubmission({
    db,
    questionId,
    testId: submission.testId,
  });

  // MODULE_TEST: only answers for the active module are accepted. This prevents
  // saving into a previous/completed or future module, and rejects saves after
  // the active module's server deadline.
  if (isModuleAttempt(submission.test)) {
    const currentModule = getModuleByKey(submission.test, submission.currentModuleKey);
    const questionCategory = normalizeQuestionCategory(resolvedQuestion.category)
      || (resolvedQuestion.category != null ? String(resolvedQuestion.category) : null);
    if (!currentModule || questionCategory !== currentModule.category) {
      throw new ApiError(403, "Question does not belong to the active module", null, "QUESTION_NOT_IN_ACTIVE_MODULE");
    }
    const moduleExpiresAt = session?.moduleExpiresAt || submission.moduleExpiresAt;
    if (moduleExpiresAt && Date.now() > new Date(moduleExpiresAt).getTime()) {
      throw new ApiError(409, "Module time expired.", { currentModuleKey: submission.currentModuleKey }, "MODULE_TIME_EXPIRED");
    }
  }

  const normalizedAnswer = {
    submissionId,
    questionId: resolvedQuestion.id,
    selectedOption: selectedOption ?? null,
    selectedOptions: Array.isArray(selectedOptions) ? selectedOptions : [],
    answerText: answerText ?? null,
    answerBoolean: typeof answerBoolean === "boolean" ? answerBoolean : null,
    markedForReview: Boolean(markedForReview),
  };

  // Re-assert the precondition atomically as late as possible before mutating.
  // The status was checked above, but resolving the question and validating the
  // module are several awaits wide, so a concurrent submit or auto-submit can
  // close the attempt in that window. An answer written into an already-graded
  // attempt is never scored, which silently costs the student marks for an
  // answer they saved in time, so the write is conditional on IN_PROGRESS.
  // This also doubles as the lastAutoSavedAt touch.
  const stillOpen = await db.submission.updateMany({
    where: { id: submissionId, userId: req.user.id, status: "IN_PROGRESS" },
    data: { lastAutoSavedAt: new Date() },
  });
  if (!stillOpen || stillOpen.count === 0) {
    throw new ApiError(409, "Submission already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  let answer = null;
  if (!isAnswerProvided(normalizedAnswer) && !normalizedAnswer.markedForReview) {
    const existing = await db.answer.findFirst({
      where: {
        submissionId,
        questionId: resolvedQuestion.id,
      },
    });

    if (existing) {
      await db.answer.delete({ where: { id: existing.id } });
    }
  } else {
    answer = await db.answer.upsert({
      where: {
        submissionId_questionId: {
          submissionId,
          questionId: resolvedQuestion.id,
        },
      },
      update: {
        selectedOption: normalizedAnswer.selectedOption,
        selectedOptions: normalizedAnswer.selectedOptions,
        answerText: normalizedAnswer.answerText,
        answerBoolean: normalizedAnswer.answerBoolean,
        markedForReview: normalizedAnswer.markedForReview,
      },
      create: normalizedAnswer,
    });
  }


  const [answersForProgress, questionCount, violationCount] = await Promise.all([
    db.answer.findMany({
      where: { submissionId },
      select: {
        selectedOption: true,
        selectedOptions: true,
        answerText: true,
        answerBoolean: true,
        selectedBoolean: true,
        selectedText: true,
      },
    }),
    db.question.count({ where: { testId: submission.testId } }),
    db.violation.count({ where: { submissionId } }),
  ]);
  const answerCount = answersForProgress.filter(isAnswerProvided).length;
  const progress = questionCount > 0 ? Math.round((answerCount / questionCount) * 100) : 0;

  await setExamState({
    userId: req.user.id,
    testId: submission.testId,
    state: {
      submissionId,
      status: submission.status,
      lastHeartbeatAt: new Date(),
      lastAutoSavedAt: new Date(),
      connectionStatus: "ONLINE",
      progress,
      violationCount,
    },
  });

  emitToCollege(req.user.collegeId, "student_status_update", {
    testId: submission.testId,
    submissionId,
    studentId: req.user.id,
    status: submission.status,
    progress,
    violations: violationCount,
    connectionStatus: "ONLINE",
  }, { departmentId: req.user.departmentId || null });
  emitToTestRoom(submission.testId, "student_status_update", {
    testId: submission.testId,
    submissionId,
    studentId: req.user.id,
    status: submission.status,
    progress,
    violations: violationCount,
    connectionStatus: "ONLINE",
  });

  res.status(200).json({ message: answer ? "Answer saved" : "Answer cleared", answer });
});

const reportViolation = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { submissionId, type, metadata } = req.body;

  const { session, clientSessionId } = await assertSessionOwnership({
    db,
    req,
    userId: req.user.id,
    testId: req.params.testId,
    submissionId,
  });

  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: { test: { select: { violationLimit: true, durationMins: true } } },
  });
  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Submission not found", null, "SUBMISSION_NOT_FOUND");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Submission already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  if (isSubmissionExpired(submission, session)) {
    const completed = await completeSubmission({ submissionId, autoSubmitted: true });
    return res.status(200).json({
      message: "Test time expired. Submission auto-submitted.",
      autoSubmitted: true,
      reason: "TEST_TIME_EXPIRED",
      submission: completed,
    });
  }

  await upsertSessionHeartbeat({
    db,
    userId: req.user.id,
    testId: submission.testId,
    submissionId,
    clientSessionId,
  });

  const violationResult = await withRedisLock({
    lockKey: `lock:test-violation:submission:${submissionId}`,
    ttlMs: 3_000,
    waitTimeoutMs: 1_000,
    onLockTimeout: async () => {
      throw new ApiError(429, "Violation is already being processed. Please retry.", null, "VIOLATION_LOCKED");
    },
    task: async () => {
      const result = await recordExamViolation({
        db,
        submission,
        user: req.user,
        type,
        metadata,
      });

      await db.submission.update({
        where: { id: submissionId },
        data: {
          violationCount: result.violationCount,
        },
      });

      return result;
    },
  });
  const { duplicate, violationCount } = violationResult;

  const [answersForState, questionCountForState] = await Promise.all([
    db.answer.findMany({
      where: { submissionId },
      select: {
        selectedOption: true,
        selectedOptions: true,
        answerText: true,
        answerBoolean: true,
        selectedBoolean: true,
        selectedText: true,
      },
    }),
    db.question.count({ where: { testId: submission.testId } }),
  ]);
  const answerCountForState = answersForState.filter(isAnswerProvided).length;
  const progressForState = questionCountForState > 0
    ? Math.round((answerCountForState / questionCountForState) * 100)
    : 0;

  await setExamState({
    userId: req.user.id,
    testId: submission.testId,
    state: {
      submissionId,
      status: submission.status,
      lastHeartbeatAt: new Date(),
      connectionStatus: "ONLINE",
      progress: progressForState,
      violationCount,
    },
  });

  await createAuditLog({
    action: "STUDENT_TEST_VIOLATION_REPORTED",
    targetType: "SUBMISSION",
    targetId: submissionId,
    collegeId: req.user.collegeId,
    testId: submission.testId,
    afterState: {
      type,
      violationCount,
      duplicate,
      metadata: metadata || null,
    },
  });

  emitToUser(req.user.id, "test:violation", {
    submissionId,
    testId: submission.testId,
    type,
    violationCount,
    duplicate,
    threshold: submission.test?.violationLimit || 3,
  });
  emitToCollege(req.user.collegeId, "test:violation:college", {
    submissionId,
    testId: submission.testId,
    userId: req.user.id,
    type,
    violationCount,
    duplicate,
  }, { departmentId: req.user.departmentId || null });
  emitToCollege(req.user.collegeId, "violation_event", {
    submissionId,
    testId: submission.testId,
    studentId: req.user.id,
    type,
    violationCount,
    duplicate,
    at: new Date().toISOString(),
  }, { departmentId: req.user.departmentId || null });
  emitToTestRoom(submission.testId, "violation_event", {
    submissionId,
    testId: submission.testId,
    studentId: req.user.id,
    type,
    violationCount,
    duplicate,
    at: new Date().toISOString(),
  });
  emitToTestRoom(submission.testId, "student_status_update", {
    submissionId,
    testId: submission.testId,
    studentId: req.user.id,
    violations: violationCount,
    connectionStatus: "ONLINE",
  });

  if (violationCount >= (submission.test?.violationLimit || 3)) {
    const completed = await completeSubmission({ submissionId, autoSubmitted: true });
    return res.status(200).json({
      message: "Maximum violations reached. Test auto-submitted.",
      autoSubmitted: true,
      submission: completed,
    });
  }

  res.status(200).json({
    message: "Violation recorded",
    autoSubmitted: false,
    duplicate,
    violationCount,
  });
});

// Shared MODULE_TEST transition: finalize the current module and either activate
// the next one or complete the whole attempt. Assumes the caller holds a lock.
const runModuleTransition = async ({ req, res, db, submissionId, fromModuleKey }) => {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: { test: { include: { questions: { orderBy: { order: "asc" } } } } },
  });
  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Submission not found");
  }

  if (submission.status !== "IN_PROGRESS") {
    const summary = await calculateSubmissionScore(submissionId);
    await clearExamState({ userId: req.user.id, testId: submission.testId });
    return res.status(200).json({
      message: "Assessment already submitted",
      submission,
      summary,
      alreadySubmitted: true,
      completed: true,
    });
  }

  const session = await db.testSession.findUnique({
    where: { userId_testId: { userId: req.user.id, testId: submission.testId } },
  });

  const result = await advanceModule({
    db,
    test: submission.test,
    submission,
    session,
    fromModuleKey: fromModuleKey || submission.currentModuleKey,
    now: new Date(),
    autoSubmitted: false,
  });

  if (result.status === "COMPLETED") {
    const completedSub = result.submission || (await db.submission.findUnique({ where: { id: submissionId } }));
    const summary = result.summary || (await calculateSubmissionScore(submissionId));
    await clearExamState({ userId: req.user.id, testId: submission.testId });

    await createAuditLog({
      action: "STUDENT_TEST_SUBMITTED",
      targetType: "SUBMISSION",
      targetId: submissionId,
      collegeId: req.user.collegeId,
      testId: submission.testId,
      afterState: { status: completedSub?.status, score: summary?.score, autoSubmitted: false, viaModuleAdvance: true },
    });
    emitToUser(req.user.id, "test:submitted", {
      submissionId,
      testId: submission.testId,
      status: completedSub?.status,
      score: summary?.score,
      accuracy: summary?.accuracy,
    });
    emitToTestRoom(submission.testId, "student_status_update", {
      testId: submission.testId,
      submissionId,
      studentId: req.user.id,
      status: completedSub?.status,
      progress: 100,
      connectionStatus: "OFFLINE",
    });

    return res.status(200).json({
      message: "Assessment submitted",
      submission: completedSub,
      summary,
      completed: true,
    });
  }

  // ADVANCED or IDEMPOTENT: return the (now) current module's questions + view.
  const reloaded = await db.submission.findUnique({
    where: { id: submissionId },
    include: { answers: true, violations: true },
  });
  const reloadedSession = await db.testSession.findUnique({
    where: { userId_testId: { userId: req.user.id, testId: submission.testId } },
  });
  const scoped = scopeQuestionsToActiveModule(
    submission.test,
    sanitizeQuestionsForStudent(submission.test.questions),
    reloaded,
    reloadedSession
  );
  const presented = applyStudentQuestionPresentation(submission.test, scoped, reloaded.id);
  const extras = moduleResponseExtras(submission.test, reloaded, reloadedSession);

  return res.status(200).json({
    message: result.status === "IDEMPOTENT" ? "Module already submitted" : "Module submitted",
    advanced: result.status === "ADVANCED",
    idempotent: result.status === "IDEMPOTENT",
    completed: false,
    submission: reloaded,
    serverTime: Date.now(),
    server_end_time: reloadedSession?.expiresAt ? new Date(reloadedSession.expiresAt).getTime() : null,
    question_order: presented.map((question) => question.id).filter(Boolean),
    questions: presented,
    ...extras,
  });
};

const advanceModuleAttempt = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { submissionId, fromModuleKey } = req.body;

  return withRedisLock({
    lockKey: `lock:test-module:submission:${submissionId || "unknown"}`,
    ttlMs: 8_000,
    waitTimeoutMs: 2_000,
    onLockTimeout: async () =>
      res.status(202).json({ message: "Module transition is already being processed", inProgress: true }),
    task: async () => {
      await assertSessionOwnership({
        db,
        req,
        userId: req.user.id,
        testId: req.params.testId,
        submissionId,
      });
      return runModuleTransition({ req, res, db, submissionId, fromModuleKey });
    },
  });
});

const submitTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { submissionId } = req.body;

  return withRedisLock({
    lockKey: `lock:test-submit:submission:${submissionId || "unknown"}`,
    ttlMs: 8_000,
    waitTimeoutMs: 2_000,
    onLockTimeout: async () => {
      const submission = await db.submission.findUnique({
        where: { id: submissionId },
      });

      if (submission && submission.userId === req.user.id && submission.status !== "IN_PROGRESS") {
        const summary = await calculateSubmissionScore(submissionId);
        await clearExamState({ userId: req.user.id, testId: submission.testId });
        return res.status(200).json({
          message: "Assessment already submitted",
          submission,
          summary,
          alreadySubmitted: true,
        });
      }

      return res.status(202).json({
        message: "Submission is already being processed",
        submission: submission || { id: submissionId },
        inProgress: true,
      });
    },
    task: async () => {

  const { session, clientSessionId } = await assertSessionOwnership({
    db,
    req,
    userId: req.user.id,
    testId: req.params.testId,
    submissionId,
  });

  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: { test: { select: { durationMins: true, assessmentFormat: true, modules: true } } },
  });
  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Submission not found");
  }

  await upsertSessionHeartbeat({
    db,
    userId: req.user.id,
    testId: submission.testId,
    submissionId,
    clientSessionId,
  });

      // NOTE: MODULE_TEST module-to-module transitions use POST /module/advance.
      // A plain /submit always completes the WHOLE attempt (used for violation
      // auto-submit, inactivity, or an explicit "finish now"); completeSubmission
      // finalizes every module via finalizeModuleState.
      if (isSubmissionExpired(submission, session)) {
        const { submission: completed, summary: summaryExpired } =
          (await completeSubmission({ submissionId, autoSubmitted: true, withSummary: true })) || {};
        await clearExamState({ userId: req.user.id, testId: submission.testId });
        return res.status(200).json({
          message: "Assessment submitted automatically because time expired",
          submission: completed,
          summary: summaryExpired,
          autoSubmitted: true,
          reason: "TEST_TIME_EXPIRED",
        });
      }

      if (submission.status !== "IN_PROGRESS") {
        const summary = await calculateSubmissionScore(submissionId);
        await clearExamState({ userId: req.user.id, testId: submission.testId });
        return res.status(200).json({
          message: "Assessment already submitted",
          submission,
          summary,
          alreadySubmitted: true,
        });
      }

      // withSummary reuses the score computed inside completeSubmission instead
      // of reloading test+questions+answers a second time — this runs at the
      // exam-end spike, when every submission hits it at once.
      const { submission: completed, summary } =
        (await completeSubmission({ submissionId, autoSubmitted: false, withSummary: true })) || {};
      await clearExamState({ userId: req.user.id, testId: completed.testId });

      await createAuditLog({
    action: "STUDENT_TEST_SUBMITTED",
    targetType: "SUBMISSION",
    targetId: submissionId,
    collegeId: req.user.collegeId,
    testId: completed.testId,
    afterState: {
      status: completed.status,
      score: summary.score,
      accuracy: summary.accuracy,
      autoSubmitted: false,
    },
  });

      emitToUser(req.user.id, "test:submitted", {
    submissionId,
    testId: completed.testId,
    status: completed.status,
    score: summary.score,
    accuracy: summary.accuracy,
  });
      emitToCollege(req.user.collegeId, "test:submitted:college", {
    submissionId,
    testId: completed.testId,
    userId: req.user.id,
    status: completed.status,
  }, { departmentId: req.user.departmentId || null });
      emitToCollege(req.user.collegeId, "test_status_change", {
    testId: completed.testId,
    submissionId,
    studentId: req.user.id,
    status: completed.status,
    action: "ATTEMPT_SUBMITTED",
  }, { departmentId: req.user.departmentId || null });
      emitToTestRoom(completed.testId, "test_status_change", {
    testId: completed.testId,
    submissionId,
    studentId: req.user.id,
    status: completed.status,
    action: "ATTEMPT_SUBMITTED",
  });
      emitToTestRoom(completed.testId, "student_status_update", {
    testId: completed.testId,
    submissionId,
    studentId: req.user.id,
    status: completed.status,
    progress: 100,
    connectionStatus: "OFFLINE",
  });

      return res.status(200).json({
        message: "Assessment submitted",
        submission: completed,
        summary,
      });
    },
  });
});

const getAttemptResult = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const attemptId = req.params.attemptId;

  let submission = await db.submission.findUnique({
    where: { id: attemptId },
    include: {
      test: {
        include: {
          questions: {
            orderBy: { order: "asc" },
          },
        },
      },
      answers: {
        include: {
          question: true,
        },
      },
    },
  });

  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Attempt not found", null, "ATTEMPT_NOT_FOUND");
  }

  if (submission.status === "IN_PROGRESS") {
    if (isTestCompleted(submission.test) || hasTestEnded(submission.test)) {
      await completeSubmission({ submissionId: submission.id, autoSubmitted: true });
      submission = await db.submission.findUnique({
        where: { id: attemptId },
        include: {
          test: {
            include: {
              questions: {
                orderBy: { order: "asc" },
              },
            },
          },
          answers: {
            include: {
              question: true,
            },
          },
        },
      });
    }
  }

  if (submission.status === "IN_PROGRESS") {
    throw new ApiError(
      409,
      "Attempt is still in progress",
      { attempt_id: submission.id, test_id: submission.testId },
      "ATTEMPT_IN_PROGRESS"
    );
  }

  const summary = await calculateSubmissionScore(submission.id);
  const hydratedTest = attachResolvedTestConfiguration(submission.test);
  const totalMarks = getTestTotalMarks(submission.test);
  const scorePercent = getSubmissionScorePercent({
    ...submission,
    score: Number(summary?.score ?? submission.score ?? 0),
  });

  const revealQuestionDetails = canRevealCorrectAnswers(submission.test);
  const testCompleted = isTestCompleted(submission.test);
  const reviewMode = revealQuestionDetails ? "show_all" : resolveReviewMode(submission.test);
  const question_breakdown = (submission.test?.questions || []).map((question) => {
    const answer = findAnswerForQuestion(submission.answers, question);
    const type = String(question.type || "").toUpperCase();
    const studentAnswer = formatAnswerValue(resolveStudentAnswerValue(answer, type));
    const rawCorrectAnswer = formatAnswerValue(
      type === "MCQ_MULTI" || type === "MULTI_SELECT"
        ? question.correctOptions
        : question.correctOption ?? question.correctText ?? question.correctBoolean
    );
    const correctAnswer = maskCorrectAnswer(rawCorrectAnswer, submission.test);
    const isCorrect = isQuestionCorrect(question, answer);

    return {
      question_id: question.id,
      prompt: question.prompt,
      student_answer: studentAnswer,
      correct_answer: correctAnswer,
      marks: revealQuestionDetails ? (isCorrect ? Number(question.marks || 0) : 0) : null,
      total_marks: Number(question.marks || 0),
      is_correct: revealQuestionDetails ? Boolean(isCorrect) : null,
      topic: question.topic || submission.test?.subject || "General",
      explanation_video_url: revealQuestionDetails ? question.explanationVideoUrl || null : null,
    };
  });

  // MODULE_TEST: per-section performance (score from `summary`, timing/status
  // from submission.moduleState) plus overall aggregates.
  const isModuleResult = Array.isArray(summary?.sections) && summary.sections.length > 0;
  const moduleStateByKey = new Map((submission.moduleState || []).map((ms) => [ms.key, ms]));
  const sections = isModuleResult
    ? summary.sections.map((sec) => {
        const ms = moduleStateByKey.get(sec.key) || {};
        return {
          key: sec.key,
          name: sec.name,
          order: sec.order,
          score: sec.score,
          max_score: sec.maxScore,
          percentage: sec.percentage,
          configured_duration_mins: ms.configuredDurationMins ?? sec.configuredDurationMins ?? null,
          actual_time_seconds: Number(ms.timeTakenSeconds || 0),
          started_at: ms.startedAt || null,
          ended_at: ms.endedAt || null,
          status: ms.status || null,
          question_count: sec.questionCount,
          answered_count: sec.answeredCount,
        };
      })
    : null;

  res.status(200).json({
    attempt_id: submission.id,
    submission_id: submission.id,
    test_id: submission.testId,
    score: Number(summary?.score ?? submission.score ?? 0),
    total_marks: totalMarks,
    percentage: scorePercent,
    score_percent: scorePercent,
    accuracy: scorePercent,
    time_taken: Number(submission.timeSpentSeconds || 0),
    assessment_format: hydratedTest?.assessment_format || "OPEN_TEST",
    sections,
    overall_max_score: isModuleResult ? summary.overallMaxScore : totalMarks,
    overall_percentage: isModuleResult ? summary.overallPercentage : scorePercent,
    total_configured_duration_mins: Number(submission.totalConfiguredDurationMins || hydratedTest?.durationMins || 0),
    total_actual_time_seconds: Number(submission.totalActualTimeSeconds || submission.timeSpentSeconds || 0),
    test_start_time: submission.startedAt || null,
    test_completion_time: submission.submittedAt || null,
    review_mode: reviewMode,
    test_status: hydratedTest?.status || null,
    testStatus: hydratedTest?.status || null,
    is_test_completed: testCompleted,
    isTestCompleted: testCompleted,
    can_review_answers: revealQuestionDetails,
    canReviewAnswers: revealQuestionDetails,
    submit_reason: submission.status === "AUTO_SUBMITTED" ? "AUTO_SUBMITTED" : "STUDENT_SUBMITTED",
    test: {
      id: hydratedTest?.id,
      title: hydratedTest?.title,
      subject: hydratedTest?.subject,
      status: hydratedTest?.status,
      test_status: hydratedTest?.status,
      is_completed: testCompleted,
      end_date: hydratedTest?.endsAt,
      test_type: hydratedTest?.test_type || null,
      assessment_format: hydratedTest?.assessment_format || "OPEN_TEST",
      modules: Array.isArray(hydratedTest?.modules) ? hydratedTest.modules : [],
      proctoring_preset: hydratedTest?.proctoring_preset || null,
    },
    question_breakdown,
  });
});

module.exports = {
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
  getAttemptSession,
  getAttemptResult,
};
