const mockAsyncHandler = (_req, _res, next) => next && next();

const mockEnv = {
  rateLimit: {
    examStartWindowMs: 60_000,
    examStartMax: 20,
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
};

const mockControllers = {
  listOngoingTests: mockAsyncHandler,
  listUpcomingTests: mockAsyncHandler,
  getTestAccessDetails: mockAsyncHandler,
  agreeToTestInstructions: mockAsyncHandler,
  startTest: mockAsyncHandler,
  getSession: mockAsyncHandler,
  saveAnswer: mockAsyncHandler,
  heartbeatTest: mockAsyncHandler,
  reportViolation: mockAsyncHandler,
  submitTest: mockAsyncHandler,
  advanceModuleAttempt: mockAsyncHandler,
  getAttemptSession: mockAsyncHandler,
  getAttemptResult: mockAsyncHandler,
};

const mockSchemas = {
  startTestSchema: {},
  agreeInstructionsSchema: {},
  saveAnswerSchema: {},
  submitSchema: {},
  violationSchema: {},
  heartbeatSchema: {},
  testIdOnlySchema: {},
  saveAnswerCompatSchema: {},
  submitCompatSchema: {},
  heartbeatCompatSchema: {},
  submitAttemptCompatSchema: {},
  violationCompatSchema: {},
  attemptAnswersCompatSchema: {},
  attemptIdOnlySchema: {},
};

const loadRouteWithLimiterSpy = (routeModulePath) => {
  jest.resetModules();

  const createRateLimiter = jest.fn(() => mockAsyncHandler);

  jest.doMock("../../config/env", () => mockEnv);
  jest.doMock("../../middleware/auth", () => ({
    authenticate: mockAsyncHandler,
  }));
  jest.doMock("../../middleware/validate", () => () => mockAsyncHandler);
  jest.doMock("../../middleware/rate-limit", () => ({
    createRateLimiter,
    examWriteKey: jest.fn(() => "student:test:attempt"),
  }));
  jest.doMock("../../controllers/Students/tests.controller", () => mockControllers);
  jest.doMock("../../schemas/Students/tests.schema", () => mockSchemas);
  jest.doMock("../../services/answer.service", () => ({
    bulkSaveAnswers: jest.fn(),
  }));
  jest.doMock("../../config/db", () => ({
    submission: {
      findUnique: jest.fn(),
    },
  }));
  jest.doMock("../../utils/http", () => ({
    ApiError: class ApiError extends Error {
      constructor(statusCode, message, details = null, code = "API_ERROR") {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.code = code;
      }
    },
  }));

  require(routeModulePath);

  return createRateLimiter.mock.calls.map(([options]) => options);
};

describe("student test route rate limit wiring", () => {
  it("uses isolated limiter scopes on the main student test routes", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Students/tests.routes");
    const scopes = limiterConfigs.map((config) => config.scope);

    expect(scopes).toEqual([
      "student-exam-start",
      "student-exam-list",
      "student-exam-session",
      "student-exam-answer",
      "student-exam-heartbeat",
      "student-exam-violation",
      "student-exam-submit",
    ]);
  });

  it("uses isolated limiter scopes on the compat attempt routes", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Students/tests-compat.routes");
    const scopes = limiterConfigs.map((config) => config.scope);

    expect(scopes).toEqual([
      "student-exam-answer",
      "student-exam-heartbeat",
      "student-exam-violation",
      "student-exam-submit",
      "student-exam-list",
      "student-exam-session",
    ]);
  });
});
