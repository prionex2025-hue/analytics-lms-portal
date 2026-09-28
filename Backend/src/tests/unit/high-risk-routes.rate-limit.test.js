const mockMiddleware = (_req, _res, next) => next && next();

const mockEnv = {
  rateLimit: {
    adminReportReadWindowMs: 30_000,
    adminReportReadMax: 20,
    reportGenerationWindowMs: 60_000,
    reportGenerationMax: 10,
    adminTestListWindowMs: 30_000,
    adminTestListMax: 30,
    adminTestCreateWindowMs: 60_000,
    adminTestCreateMax: 8,
    adminTestUpdateWindowMs: 60_000,
    adminTestUpdateMax: 20,
    adminTestPublishWindowMs: 60_000,
    adminTestPublishMax: 6,
    adminTestCloneWindowMs: 60_000,
    adminTestCloneMax: 5,
    adminTestMonitoringWriteWindowMs: 60_000,
    adminTestMonitoringWriteMax: 20,
    adminQuestionBankBulkImportWindowMs: 300_000,
    adminQuestionBankBulkImportMax: 5,
    adminEntityWriteWindowMs: 60_000,
    adminEntityWriteMax: 20,
    adminBatchGuardWindowMs: 60_000,
    adminBatchGuardMax: 12,
    superReportWindowMs: 60_000,
    superReportMax: 20,
    leaderboardWindowMs: 30_000,
    leaderboardMax: 20,
    authForgotPasswordWindowMs: 900_000,
    authForgotPasswordMax: 5,
    authResetPasswordWindowMs: 900_000,
    authResetPasswordMax: 10,
  },
};

const loadRouteWithLimiterSpy = (routeModulePath, extraMocks = {}) => {
  jest.resetModules();

  const createRateLimiter = jest.fn(() => mockMiddleware);

  jest.doMock("../../config/env", () => mockEnv);
  jest.doMock("../../middleware/rate-limit", () => ({
    authKeyByIp: jest.fn(() => "ip:test"),
    createRateLimiter,
  }));
  jest.doMock("../../middleware/validate", () => () => mockMiddleware);
  jest.doMock("../../middleware/response-cache", () => ({
    createResponseCache: jest.fn(() => mockMiddleware),
  }));
  jest.doMock("../../middleware/auth", () => ({
    authenticate: mockMiddleware,
    authenticateAdmin: mockMiddleware,
    authenticatePlatformAdmin: mockMiddleware,
    authenticateCollegeAdmin: mockMiddleware,
    authenticateSuperAdmin: mockMiddleware,
  }));
  jest.doMock("../../middleware/permissions", () => ({
    requireAnyPermission: () => mockMiddleware,
    requirePermission: () => mockMiddleware,
  }));
  jest.doMock("../../middleware/department-guard", () => ({
    requireSameDepartment: () => mockMiddleware,
    departmentMatch: () => mockMiddleware,
  }));
  jest.doMock("../../config/db", () => ({
    test: {
      findFirst: jest.fn(),
    },
  }));

  for (const [path, mockValue] of Object.entries(extraMocks)) {
    jest.doMock(path, () => mockValue);
  }

  require(routeModulePath);

  return createRateLimiter.mock.calls.map(([options]) => options);
};

describe("high-risk route rate limit wiring", () => {
  it("limits admin report analytics and generation routes", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Admin/reports.routes", {
      "../../controllers/Admin/reports.controller": {
        generateReport: mockMiddleware,
        getReportJobs: mockMiddleware,
        getPassoutCohorts: mockMiddleware,
        getReportJobStatus: mockMiddleware,
        getReportAnalytics: mockMiddleware,
        getReportSummaryDashboard: mockMiddleware,
        getReportChartsDashboard: mockMiddleware,
        getReportTableDashboard: mockMiddleware,
        getReportTestsDashboard: mockMiddleware,
        getReportItemAnalysis: mockMiddleware,
        getReportIntegrity: mockMiddleware,
        getReportTrends: mockMiddleware,
        getReportAtRisk: mockMiddleware,
        exportReportCsv: mockMiddleware,
        exportReportXlsx: mockMiddleware,
        getReportStudentDetailDashboard: mockMiddleware,
        downloadReport: mockMiddleware,
        regenerateReportLink: mockMiddleware,
        reviewAnomaly: mockMiddleware,
      },
      "../../schemas/Admin/admin-core.schema": {},
    });

    expect(limiterConfigs.map((config) => config.scope)).toEqual([
      "report-generation",
      "admin-report-read",
    ]);
  });

  it("limits auth login, refresh, forgot and reset password routes by IP", () => {
    const studentAuthLimiters = loadRouteWithLimiterSpy("../../routes/Students/auth.routes", {
      "../../controllers/Students/auth.controller": {
        forgotPassword: mockMiddleware,
        login: mockMiddleware,
        refresh: mockMiddleware,
        resetPassword: mockMiddleware,
        logout: mockMiddleware,
        me: mockMiddleware,
      },
      "../../schemas/Students/auth.schema": {},
    });
    expect(studentAuthLimiters.map((config) => config.scope)).toEqual([
      "student-forgot-password",
      "student-reset-password",
      "student-login",
      "student-refresh",
    ]);

    const adminAuthLimiters = loadRouteWithLimiterSpy("../../routes/Admin/auth.routes", {
      "../../controllers/Admin/auth.controller": {
        adminForgotPassword: mockMiddleware,
        adminLogin: mockMiddleware,
        adminRefresh: mockMiddleware,
        adminResetPassword: mockMiddleware,
        adminLogout: mockMiddleware,
        adminMe: mockMiddleware,
      },
      "../../schemas/Admin/admin-auth.schema": {},
    });
    expect(adminAuthLimiters.map((config) => config.scope)).toEqual([
      "admin-forgot-password",
      "admin-reset-password",
      "admin-login",
      "admin-refresh",
    ]);

    const superAdminAuthLimiters = loadRouteWithLimiterSpy("../../routes/SuperAdmin/auth.routes", {
      "../../controllers/SuperAdmin/auth.controller": {
        superAdminForgotPassword: mockMiddleware,
        superAdminLogin: mockMiddleware,
        superAdminRefresh: mockMiddleware,
        superAdminResetPassword: mockMiddleware,
        superAdminLogout: mockMiddleware,
        superAdminMe: mockMiddleware,
      },
      "../../schemas/SuperAdmin/super-admin-auth.schema": {},
    });
    expect(superAdminAuthLimiters.map((config) => config.scope)).toEqual([
      "super-admin-forgot-password",
      "super-admin-reset-password",
      "super-admin-login",
      "super-admin-refresh",
    ]);
  });

  it("limits admin test list, route-specific writes, and guarded batch operations", () => {
    const testLimiters = loadRouteWithLimiterSpy("../../routes/Admin/tests.routes", {
      "../../controllers/Admin/tests.controller": {
        createTest: mockMiddleware,
        getTests: mockMiddleware,
        getTestById: mockMiddleware,
        getTestShareLink: mockMiddleware,
        duplicateTest: mockMiddleware,
        cloneTest: mockMiddleware,
        updateTest: mockMiddleware,
        deleteTest: mockMiddleware,
        publishTest: mockMiddleware,
        archiveTest: mockMiddleware,
        transitionTestStatus: mockMiddleware,
        getLiveMonitoring: mockMiddleware,
        forceSubmitAttempt: mockMiddleware,
        extendAttemptTime: mockMiddleware,
      },
      "../../controllers/Admin/batches.controller": {
        assignTestToBatch: mockMiddleware,
        assignTestToDepartment: mockMiddleware,
      },
      "../../schemas/Admin/admin-tests.schema": {},
      "../../schemas/Admin/admin-core.schema": {},
    });
    expect(testLimiters.map((config) => config.scope)).toEqual([
      "admin-test-list",
      "admin-test-write",
      "admin-test-create",
      "admin-test-update",
      "admin-test-publish",
      "admin-test-clone",
      "admin-test-monitoring-write",
    ]);

    const batchLimiters = loadRouteWithLimiterSpy("../../routes/Admin/batches.routes", {
      "../../controllers/Admin/batches-with-validation.controller": {
        getBatches: mockMiddleware,
        getBatchDetail: mockMiddleware,
        createBatchHandler: mockMiddleware,
      },
      "../../controllers/Admin/batches.controller": {
        assignStudentsToBatch: mockMiddleware,
        bulkAddStudentsToBatch: mockMiddleware,
        removeStudentFromBatch: mockMiddleware,
        archiveBatch: mockMiddleware,
        deleteBatch: mockMiddleware,
      },
      "../../schemas/Admin/admin-core.schema": {},
    });
    expect(batchLimiters.map((config) => config.scope)).toEqual(["admin-batch-guard"]);
  });

  it("limits question-bank bulk import separately from other writes", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Admin/question-bank.routes", {
      "../../controllers/Admin/question-bank.controller": {
        addQuestionBankItem: mockMiddleware,
        getQuestionBank: mockMiddleware,
        exportQuestionBankJson: mockMiddleware,
        importQuestionBankJson: mockMiddleware,
        updateQuestionBankItem: mockMiddleware,
        deleteQuestionBankItem: mockMiddleware,
      },
      "../../schemas/Admin/admin-core.schema": {},
    });

    expect(limiterConfigs.map((config) => config.scope)).toEqual([
      "admin-question-bank-write",
      "admin-question-bank-bulk-import",
    ]);
  });

  it("limits super-admin test and question-bank write operations", () => {
    const testLimiters = loadRouteWithLimiterSpy("../../routes/SuperAdmin/tests.routes", {
      "../../controllers/SuperAdmin/tests.controller": {
        getTestsGlobal: mockMiddleware,
        getGlobalTestById: mockMiddleware,
        createGlobalTest: mockMiddleware,
        cloneTestToCollege: mockMiddleware,
        updateGlobalTest: mockMiddleware,
        transitionGlobalTestStatus: mockMiddleware,
        getLiveMonitoring: mockMiddleware,
        forceSubmitAttempt: mockMiddleware,
        extendAttemptTime: mockMiddleware,
        deactivateTest: mockMiddleware,
        getGlobalTestShareLink: mockMiddleware,
      },
      "../../schemas/SuperAdmin/super-admin-core.schema": {},
    });
    expect(testLimiters.map((config) => config.scope)).toEqual([
      "super-admin-test-create",
      "super-admin-test-update",
      "super-admin-test-clone",
    ]);

    const questionBankLimiters = loadRouteWithLimiterSpy("../../routes/SuperAdmin/question-bank.routes", {
      "../../controllers/SuperAdmin/question-bank.controller": {
        addQuestionBankItem: mockMiddleware,
        getQuestionBank: mockMiddleware,
        exportQuestionBankJson: mockMiddleware,
        importQuestionBankJson: mockMiddleware,
        updateQuestionBankItem: mockMiddleware,
        deleteQuestionBankItem: mockMiddleware,
      },
      "../../schemas/Admin/admin-core.schema": {},
    });
    expect(questionBankLimiters.map((config) => config.scope)).toEqual([
      "super-admin-question-bank-write",
      "super-admin-question-bank-bulk-import",
    ]);
  });

  it("limits super-admin reports and student leaderboard", () => {
    const superReportLimiters = loadRouteWithLimiterSpy("../../routes/SuperAdmin/reports.routes", {
      "../../controllers/SuperAdmin/reports.controller": {
        generateSuperReport: mockMiddleware,
        getSuperReportAnalytics: mockMiddleware,
        getSuperReportTestsDashboard: mockMiddleware,
        getSuperReportTableDashboard: mockMiddleware,
        getPassoutCohorts: mockMiddleware,
        getSuperReportJobs: mockMiddleware,
        downloadSuperReport: mockMiddleware,
        regenerateSuperReportLink: mockMiddleware,
        getEscalatedAnomalies: mockMiddleware,
        getSuperReportJobStatus: mockMiddleware,
        reviewSuperAnomaly: mockMiddleware,
      },
      "../../schemas/SuperAdmin/super-admin-core.schema": {},
    });
    expect(superReportLimiters.map((config) => config.scope)).toEqual(["super-report", "super-report-read"]);

    const leaderboardLimiters = loadRouteWithLimiterSpy("../../routes/Students/leaderboard.routes", {
      "../../controllers/Students/leaderboard.controller": {
        getLeaderboard: mockMiddleware,
      },
    });
    expect(leaderboardLimiters.map((config) => config.scope)).toEqual(["student-leaderboard"]);
  });
});
