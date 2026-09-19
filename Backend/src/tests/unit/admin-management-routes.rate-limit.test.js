const mockMiddleware = (_req, _res, next) => next && next();

const mockEnv = {
  rateLimit: {
    adminEntityReadWindowMs: 30_000,
    adminEntityReadMax: 40,
    adminEntityWriteWindowMs: 60_000,
    adminEntityWriteMax: 20,
    adminSettingsWindowMs: 60_000,
    adminSettingsMax: 12,
    adminAnalyticsReadWindowMs: 30_000,
    adminAnalyticsReadMax: 20,
  },
};

const loadRouteWithLimiterSpy = (routeModulePath, extraMocks = {}) => {
  jest.resetModules();

  const createRateLimiter = jest.fn(() => mockMiddleware);

  jest.doMock("../../config/env", () => mockEnv);
  jest.doMock("../../middleware/rate-limit", () => ({ createRateLimiter }));
  jest.doMock("../../middleware/validate", () => () => mockMiddleware);
  jest.doMock("../../middleware/auth", () => ({
    authenticatePlatformAdmin: mockMiddleware,
  }));
  jest.doMock("../../middleware/permissions", () => ({
    requireAnyPermission: () => mockMiddleware,
    requirePermission: () => mockMiddleware,
  }));
  jest.doMock("../../middleware/upload", () => ({
    imageUpload: { single: () => mockMiddleware },
  }));
  jest.doMock("../../middleware/normalize-event-form", () => ({
    normalizeEventForm: mockMiddleware,
  }));

  for (const [path, mockValue] of Object.entries(extraMocks)) {
    jest.doMock(path, () => mockValue);
  }

  require(routeModulePath);
  return createRateLimiter.mock.calls.map(([options]) => options);
};

describe("admin management route rate limit wiring", () => {
  it("limits student management reads and writes", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Admin/students.routes", {
      "../../schemas/Admin/admin-core.schema": {},
      "../../controllers/Admin/students-with-validation.controller": {
        getStudents: mockMiddleware,
      },
      "../../controllers/Admin/students.controller": {
        createStudent: mockMiddleware,
        bulkImportStudents: mockMiddleware,
        getStudentImportJob: mockMiddleware,
        getStudentProfile: mockMiddleware,
        getStudentPerformance: mockMiddleware,
        assignStudentToBatch: mockMiddleware,
        promoteStudentsYear: mockMiddleware,
      },
    });

    expect(limiterConfigs.map((config) => config.scope)).toEqual([
      "admin-student-read",
      "admin-student-write",
    ]);
  });

  it("limits event reads and writes", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Admin/events.routes", {
      "../../schemas/Admin/admin-core.schema": {},
      "../../controllers/Admin/events.controller": {
        createEvent: mockMiddleware,
        getEvents: mockMiddleware,
        updateEvent: mockMiddleware,
        deleteEvent: mockMiddleware,
        getEventRegistrants: mockMiddleware,
        exportEventRegistrants: mockMiddleware,
        cancelEvent: mockMiddleware,
      },
    });

    expect(limiterConfigs.map((config) => config.scope)).toEqual([
      "admin-event-read",
      "admin-event-write",
    ]);
  });

  it("limits department management reads and writes", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Admin/departments.routes", {
      "../../schemas/Admin/admin-management.schema": {},
      "../../controllers/Admin/departments-management.controller": {
        getScopedDepartments: mockMiddleware,
        createScopedDepartment: mockMiddleware,
        updateScopedDepartment: mockMiddleware,
        deleteScopedDepartment: mockMiddleware,
      },
    });

    expect(limiterConfigs.map((config) => config.scope)).toEqual([
      "admin-department-read",
      "admin-department-write",
    ]);
  });

  it("limits managed-admin reads and writes", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Admin/admins.routes", {
      "../../schemas/Admin/admin-management.schema": {},
      "../../controllers/Admin/admins.controller": {
        getManagedAdmins: mockMiddleware,
        createManagedAdmin: mockMiddleware,
        updateManagedAdmin: mockMiddleware,
        resetManagedAdminPassword: mockMiddleware,
        deactivateManagedAdmin: mockMiddleware,
      },
    });

    expect(limiterConfigs.map((config) => config.scope)).toEqual([
      "admin-managed-admin-read",
      "admin-managed-admin-write",
    ]);
  });

  it("limits settings operations", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Admin/settings.routes", {
      "../../schemas/Admin/admin-core.schema": {},
      "../../controllers/Admin/settings.controller": {
        getAdminSettings: mockMiddleware,
        updateAdminSettings: mockMiddleware,
        changeAdminPassword: mockMiddleware,
      },
    });

    expect(limiterConfigs.map((config) => config.scope)).toEqual(["admin-settings"]);
  });

  it("limits analytics reads", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Admin/analytics.routes", {
      "../../controllers/Admin/analytics.controller": {
        getCollegeAnalytics: mockMiddleware,
      },
    });

    expect(limiterConfigs.map((config) => config.scope)).toEqual(["admin-analytics-read"]);
  });
});
