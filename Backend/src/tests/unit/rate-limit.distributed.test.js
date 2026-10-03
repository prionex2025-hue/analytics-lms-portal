describe("production Redis-backed rate limits across replicas", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let available;
  let failCommand;
  let state;
  let redisClient;

  const loadReplica = () => {
    let middleware;
    jest.isolateModules(() => {
      middleware = require("../../middleware/rate-limit");
    });
    return middleware;
  };

  const invoke = async (limiter, overrides = {}) => {
    let error = null;
    let nextCalled = false;
    let statusCode = null;
    const req = {
      method: "GET",
      headers: {},
      params: {},
      body: {},
      ip: "198.51.100.12",
      originalUrl: "/api/resource",
      ...overrides,
    };
    const res = {
      writableFinished: false,
      setHeader() {},
      status(code) { statusCode = code; return this; },
      json() { return this; },
      once() {},
    };

    await limiter(req, res, (nextError) => {
      nextCalled = true;
      error = nextError || null;
    });
    return { error, nextCalled, statusCode };
  };

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    available = true;
    failCommand = false;
    state = new Map();
    redisClient = {
      eval: jest.fn(async (_script, _keys, key, windowMs) => {
        if (failCommand) throw new Error("command timeout");
        const now = Date.now();
        const current = state.get(key);
        if (!current || current.resetAt <= now) {
          const next = { count: 1, resetAt: now + Number(windowMs) };
          state.set(key, next);
          return [1, Number(windowMs)];
        }
        current.count += 1;
        return [current.count, Math.max(1, current.resetAt - now)];
      }),
    };
    jest.resetModules();
    jest.doMock("../../config/redis", () => ({
      redisClient,
      isRedisAvailable: () => available,
    }));
    jest.doMock("../../utils/token", () => ({ verifyAccessToken: jest.fn() }));
    jest.doMock("../../services/rate-limit-metrics.service", () => ({
      recordRateLimitEvent: jest.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
    jest.dontMock("../../config/redis");
    jest.dontMock("../../services/rate-limit-metrics.service");
    jest.dontMock("../../utils/token");
  });

  it("shares per-IP limits between replicas and allows requests under quota", async () => {
    const replicaA = loadReplica();
    const replicaB = loadReplica();
    const options = { scope: "auth-login", max: 1, windowMs: 60_000, keySelector: replicaA.authKeyByIp };
    const limiterA = replicaA.createRateLimiter(options);
    const limiterB = replicaB.createRateLimiter({ ...options, keySelector: replicaB.authKeyByIp });

    expect(await invoke(limiterA)).toMatchObject({ nextCalled: true, error: null });
    expect(await invoke(limiterB)).toMatchObject({ nextCalled: false, statusCode: 429 });
  });

  it("shares per-user limits between replicas", async () => {
    const replicaA = loadReplica();
    const replicaB = loadReplica();
    const limiterA = replicaA.createRateLimiter({ scope: "admin-sensitive-write", max: 1, windowMs: 60_000 });
    const limiterB = replicaB.createRateLimiter({ scope: "admin-sensitive-write", max: 1, windowMs: 60_000 });
    const request = { user: { id: "admin-1", role: "ADMIN" } };

    expect(await invoke(limiterA, request)).toMatchObject({ nextCalled: true, error: null });
    expect(await invoke(limiterB, request)).toMatchObject({ nextCalled: false, statusCode: 429 });
  });

  it("rejects protected requests on every replica during Redis outage and recovers without stale local blocks", async () => {
    const replicaA = loadReplica();
    const replicaB = loadReplica();
    const limiterA = replicaA.createRateLimiter({ scope: "student-exam-submit", max: 2, windowMs: 60_000 });
    const limiterB = replicaB.createRateLimiter({ scope: "student-exam-submit", max: 2, windowMs: 60_000 });
    available = false;

    expect(await invoke(limiterA)).toMatchObject({ nextCalled: true, error: expect.objectContaining({ statusCode: 503, code: "RATE_LIMIT_STORE_UNAVAILABLE" }) });
    expect(await invoke(limiterB)).toMatchObject({ nextCalled: true, error: expect.objectContaining({ statusCode: 503, code: "RATE_LIMIT_STORE_UNAVAILABLE" }) });

    available = true;
    expect(await invoke(limiterB)).toMatchObject({ nextCalled: true, error: null });
    expect(await invoke(limiterA)).toMatchObject({ nextCalled: true, error: null });
  });

  it("rejects a Redis command error instead of allowing the request through", async () => {
    const replica = loadReplica();
    const limiter = replica.createRateLimiter({ scope: "password-reset", max: 5, windowMs: 60_000 });
    failCommand = true;

    expect(await invoke(limiter)).toMatchObject({
      nextCalled: true,
      error: expect.objectContaining({ statusCode: 503, code: "RATE_LIMIT_STORE_UNAVAILABLE" }),
    });
  });
});
