const mockMiddleware = (_req, _res, next) => next && next();

const runRouteStack = (route, req) =>
  new Promise((resolve, reject) => {
    let index = 0;
    const res = {
      statusCode: 200,
      status: jest.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn((payload) => resolve({ res, payload })),
    };

    const next = (error) => {
      if (error) {
        reject(error);
        return;
      }

      const layer = route.route.stack[index];
      index += 1;

      if (!layer) {
        resolve({ res, payload: null });
        return;
      }

      Promise.resolve(layer.handle(req, res, next)).catch(reject);
    };

    next();
  });

describe("student attempt compatibility routes", () => {
  it("supports legacy bulk answer saves at PATCH /attempts/:attemptId/answers", async () => {
    jest.resetModules();

    const findUnique = jest.fn(async () => ({
      id: "attempt-1",
      testId: "test-1",
      userId: "student-1",
      collegeId: "college-1",
    }));
    const findTest = jest.fn(async () => ({
      id: "test-1",
      assessmentFormat: null,
      modules: null,
    }));
    const bulkSaveAnswers = jest.fn(async () => ({ created: 1, updated: 0, total: 1 }));

    jest.doMock("../../config/env", () => ({
      rateLimit: {
        examAnswerWindowMs: 60_000,
        examAnswerMax: 100,
        examHeartbeatWindowMs: 60_000,
        examHeartbeatMax: 30,
        examViolationWindowMs: 60_000,
        examViolationMax: 12,
        examSubmitWindowMs: 15_000,
        examSubmitMax: 3,
        examListWindowMs: 30_000,
        examListMax: 20,
        examSessionWindowMs: 30_000,
        examSessionMax: 30,
      },
    }));
    jest.doMock("../../config/db", () => ({
      submission: { findUnique },
      test: { findUnique: findTest },
      testSession: {
        findUnique: jest.fn(async () => null),
      },
    }));
    jest.doMock("../../middleware/auth", () => ({
      authenticate: mockMiddleware,
    }));
    jest.doMock("../../middleware/validate", () => () => mockMiddleware);
    jest.doMock("../../middleware/rate-limit", () => ({
      createRateLimiter: jest.fn(() => mockMiddleware),
      examWriteKey: jest.fn(() => "student:test:attempt"),
    }));
    jest.doMock("../../controllers/Students/tests.controller", () => ({
      listOngoingTests: mockMiddleware,
      getAttemptSession: mockMiddleware,
      getSession: mockMiddleware,
      heartbeatTest: mockMiddleware,
      saveAnswer: mockMiddleware,
      submitTest: mockMiddleware,
      advanceModuleAttempt: mockMiddleware,
      reportViolation: mockMiddleware,
      getAttemptResult: mockMiddleware,
    }));
    jest.doMock("../../services/answer.service", () => ({
      bulkSaveAnswers,
    }));

    const router = require("../../routes/Students/tests-compat.routes");
    const route = router.stack.find((layer) =>
      layer.route?.path === "/attempts/:attemptId/answers" && layer.route?.methods?.patch
    );

    expect(route).toBeDefined();

    const answers = [{ question_id: "question-1", selected_option: "A" }];
    const { res, payload } = await runRouteStack(route, {
      params: { attemptId: "attempt-1" },
      body: { answers },
      user: { id: "student-1", collegeId: "college-1" },
    });

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "attempt-1" } });
    expect(bulkSaveAnswers).toHaveBeenCalledWith(answers, "attempt-1", "college-1");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload).toEqual(expect.objectContaining({
      saved: true,
      result: { created: 1, updated: 0, total: 1 },
    }));
  });

  it("rejects bulk answer saves for questions outside the active module (MODULE_TEST)", async () => {
    jest.resetModules();

    const future = new Date(Date.now() + 60_000).toISOString();
    const modules = [
      { key: "QUANT", name: "Quantitative Aptitude", order: 1, durationMins: 30, category: "Quantitative Aptitude" },
      { key: "REASONING", name: "Logical Reasoning", order: 2, durationMins: 30, category: "Logical Reasoning" },
      { key: "VERBAL", name: "Verbal", order: 3, durationMins: 30, category: "Verbal" },
    ];
    const bulkSaveAnswers = jest.fn(async () => ({ created: 0, updated: 0, total: 0 }));

    jest.doMock("../../config/env", () => ({
      rateLimit: {
        examAnswerWindowMs: 60_000,
        examAnswerMax: 100,
        examHeartbeatWindowMs: 60_000,
        examHeartbeatMax: 30,
        examViolationWindowMs: 60_000,
        examViolationMax: 12,
        examSubmitWindowMs: 15_000,
        examSubmitMax: 3,
        examListWindowMs: 30_000,
        examListMax: 20,
        examSessionWindowMs: 30_000,
        examSessionMax: 30,
      },
    }));
    jest.doMock("../../config/db", () => ({
      submission: {
        findUnique: jest.fn(async () => ({
          id: "attempt-1",
          testId: "test-1",
          userId: "student-1",
          collegeId: "college-1",
          status: "IN_PROGRESS",
          currentModuleKey: "QUANT",
          moduleExpiresAt: future,
        })),
      },
      test: {
        findUnique: jest.fn(async () => ({
          id: "test-1",
          assessmentFormat: "MODULE_TEST",
          modules,
        })),
      },
      question: {
        findMany: jest.fn(async () => [
          { id: "question-quant", sourceQuestionId: null, category: "Quantitative Aptitude" },
          { id: "question-verbal", sourceQuestionId: null, category: "Verbal" },
        ]),
      },
      testSession: {
        findUnique: jest.fn(async () => ({
          moduleExpiresAt: future,
          currentModuleKey: "QUANT",
        })),
      },
    }));
    jest.doMock("../../middleware/auth", () => ({
      authenticate: mockMiddleware,
    }));
    jest.doMock("../../middleware/validate", () => () => mockMiddleware);
    jest.doMock("../../middleware/rate-limit", () => ({
      createRateLimiter: jest.fn(() => mockMiddleware),
      examWriteKey: jest.fn(() => "student:test:attempt"),
    }));
    jest.doMock("../../controllers/Students/tests.controller", () => ({
      listOngoingTests: mockMiddleware,
      getAttemptSession: mockMiddleware,
      getSession: mockMiddleware,
      heartbeatTest: mockMiddleware,
      saveAnswer: mockMiddleware,
      submitTest: mockMiddleware,
      advanceModuleAttempt: mockMiddleware,
      reportViolation: mockMiddleware,
      getAttemptResult: mockMiddleware,
    }));
    jest.doMock("../../services/answer.service", () => ({
      bulkSaveAnswers,
    }));

    const router = require("../../routes/Students/tests-compat.routes");
    const route = router.stack.find((layer) =>
      layer.route?.path === "/attempts/:attemptId/answers" && layer.route?.methods?.patch
    );

    const answers = [
      { question_id: "question-quant", selected_option: "A" },
      { question_id: "question-verbal", selected_option: "B" },
    ];

    await expect(runRouteStack(route, {
      params: { attemptId: "attempt-1" },
      body: { answers },
      user: { id: "student-1", collegeId: "college-1" },
    })).rejects.toMatchObject({
      code: "QUESTION_NOT_IN_ACTIVE_MODULE",
    });

    expect(bulkSaveAnswers).not.toHaveBeenCalled();
  });

  it("rejects bulk answer saves after the whole-test deadline (TEST_TIME_EXPIRED)", async () => {
    jest.resetModules();

    const past = new Date(Date.now() - 60_000).toISOString();
    const bulkSaveAnswers = jest.fn(async () => ({ created: 1, updated: 0, total: 1 }));

    jest.doMock("../../config/env", () => ({
      rateLimit: {
        examAnswerWindowMs: 60_000,
        examAnswerMax: 100,
        examHeartbeatWindowMs: 60_000,
        examHeartbeatMax: 30,
        examViolationWindowMs: 60_000,
        examViolationMax: 12,
        examSubmitWindowMs: 15_000,
        examSubmitMax: 3,
        examListWindowMs: 30_000,
        examListMax: 20,
        examSessionWindowMs: 30_000,
        examSessionMax: 30,
      },
    }));
    jest.doMock("../../config/db", () => ({
      submission: {
        findUnique: jest.fn(async () => ({
          id: "attempt-1",
          testId: "test-1",
          userId: "student-1",
          collegeId: "college-1",
          status: "IN_PROGRESS",
        })),
      },
      test: {
        findUnique: jest.fn(async () => ({
          id: "test-1",
          assessmentFormat: null,
          modules: null,
          durationMins: 30,
        })),
      },
      testSession: {
        findUnique: jest.fn(async () => ({
          expiresAt: past,
        })),
      },
    }));
    jest.doMock("../../middleware/auth", () => ({
      authenticate: mockMiddleware,
    }));
    jest.doMock("../../middleware/validate", () => () => mockMiddleware);
    jest.doMock("../../middleware/rate-limit", () => ({
      createRateLimiter: jest.fn(() => mockMiddleware),
      examWriteKey: jest.fn(() => "student:test:attempt"),
    }));
    jest.doMock("../../controllers/Students/tests.controller", () => ({
      listOngoingTests: mockMiddleware,
      getAttemptSession: mockMiddleware,
      getSession: mockMiddleware,
      heartbeatTest: mockMiddleware,
      saveAnswer: mockMiddleware,
      submitTest: mockMiddleware,
      advanceModuleAttempt: mockMiddleware,
      reportViolation: mockMiddleware,
      getAttemptResult: mockMiddleware,
    }));
    jest.doMock("../../services/answer.service", () => ({
      bulkSaveAnswers,
    }));

    const router = require("../../routes/Students/tests-compat.routes");
    const route = router.stack.find((layer) =>
      layer.route?.path === "/attempts/:attemptId/answers" && layer.route?.methods?.patch
    );

    const answers = [{ question_id: "question-1", selected_option: "A" }];

    await expect(runRouteStack(route, {
      params: { attemptId: "attempt-1" },
      body: { answers },
      user: { id: "student-1", collegeId: "college-1" },
    })).rejects.toMatchObject({
      code: "TEST_TIME_EXPIRED",
    });

    expect(bulkSaveAnswers).not.toHaveBeenCalled();
  });
});
