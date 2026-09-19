const mockMiddleware = (_req, _res, next) => next && next();

describe("learning resources route rate limit wiring", () => {
  it("uses isolated Redis-backed limiter scopes for search, upload, and downloads", () => {
    jest.resetModules();

    const createRateLimiter = jest.fn(() => mockMiddleware);

    jest.doMock("../../config/env", () => ({
      nodeEnv: "test",
      redis: { enabled: true },
      resourceUpload: {
        root: "uploads/resources",
        maxFileSizeBytes: 1024,
      },
      rateLimit: {
        resourceDownloadWindowMs: 60_000,
        resourceDownloadMax: 20,
        resourceSearchWindowMs: 60_000,
        resourceSearchMax: 60,
        resourceUploadWindowMs: 60_000,
        resourceUploadMax: 10,
      },
    }));
    jest.doMock("../../config/redis", () => ({
      isRedisAvailable: () => true,
    }));
    jest.doMock("../../middleware/rate-limit", () => ({ createRateLimiter }));
    jest.doMock("../../middleware/validate", () => () => mockMiddleware);
    jest.doMock("../../middleware/permissions", () => ({
      requireAnyPermission: () => mockMiddleware,
      requirePermission: () => mockMiddleware,
    }));
    jest.doMock("../../modules/resources/middlewares/upload.middleware", () => ({
      uploadResourceFile: mockMiddleware,
    }));
    jest.doMock("../../modules/resources/controllers/resource.controller", () => ({
      getSubjects: mockMiddleware,
      createSubject: mockMiddleware,
      removeSubject: mockMiddleware,
      uploadResource: mockMiddleware,
      getResources: mockMiddleware,
      getResource: mockMiddleware,
      downloadResource: mockMiddleware,
      editResource: mockMiddleware,
      removeResource: mockMiddleware,
      getPopular: mockMiddleware,
      getAnalytics: mockMiddleware,
    }));

    const { createResourcesRouter } = require("../../modules/resources/routes/resources.routes");
    createResourcesRouter({ managementEnabled: true, analyticsEnabled: true });

    expect(createRateLimiter.mock.calls.map(([options]) => options.scope)).toEqual([
      "resources-download",
      "resources-search",
      "resources-upload",
    ]);
  });
});
