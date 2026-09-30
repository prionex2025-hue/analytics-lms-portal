describe("createRateLimiter", () => {
  const loadModule = () => {
    jest.resetModules();

    const recordRateLimitEvent = jest.fn().mockResolvedValue(undefined);

    jest.doMock("../../config/redis", () => ({
      redisClient: {
        incr: jest.fn(),
        pexpire: jest.fn(),
        pttl: jest.fn(),
        set: jest.fn(),
      },
      isRedisAvailable: () => false,
    }));

    jest.doMock("../../services/rate-limit-metrics.service", () => ({
      recordRateLimitEvent,
    }));

    const rateLimitModule = require("../../middleware/rate-limit");

    return {
      ...rateLimitModule,
      recordRateLimitEvent,
    };
  };

  const invokeLimiter = async (limiter, reqOverrides = {}) => {
    const headers = {};
    let statusCode = null;
    let payload = null;
    let nextCalled = false;
    let nextError = null;

    const req = {
      headers: {},
      params: {},
      body: {},
      path: "/api/tests/test-1/answer",
      originalUrl: "/api/tests/test-1/answer",
      ip: "127.0.0.1",
      user: {
        id: "student-1",
        role: "STUDENT",
        collegeId: "college-1",
      },
      ...reqOverrides,
    };

    const res = {
      setHeader(name, value) {
        headers[name] = value;
      },
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
    };

    await limiter(req, res, (error) => {
      nextCalled = true;
      nextError = error || null;
    });

    return {
      headers,
      statusCode,
      payload,
      nextCalled,
      nextError,
    };
  };

  it("keeps separate scopes independent for the same student attempt", async () => {
    const { createRateLimiter, recordRateLimitEvent } = loadModule();

    const sharedKey = () => "user:STUDENT:student-1:test:test-1:attempt:attempt-1";
    const answerLimiter = createRateLimiter({
      scope: "student-exam-answer",
      routeLabel: "/api/tests/:testId/answer",
      max: 1,
      windowMs: 60_000,
      keySelector: sharedKey,
    });
    const heartbeatLimiter = createRateLimiter({
      scope: "student-exam-heartbeat",
      routeLabel: "/api/tests/:testId/heartbeat",
      max: 1,
      windowMs: 60_000,
      keySelector: sharedKey,
    });

    const firstAnswer = await invokeLimiter(answerLimiter);
    expect(firstAnswer.nextCalled).toBe(true);
    expect(firstAnswer.statusCode).toBeNull();

    const blockedAnswer = await invokeLimiter(answerLimiter);
    expect(blockedAnswer.nextCalled).toBe(false);
    expect(blockedAnswer.statusCode).toBe(429);
    expect(blockedAnswer.payload).toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      details: {
        scope: "student-exam-answer",
      },
    });
    expect(recordRateLimitEvent).toHaveBeenCalledWith(expect.objectContaining({
      scope: "student-exam-answer",
      collegeId: "college-1",
    }));

    const heartbeat = await invokeLimiter(heartbeatLimiter, {
      path: "/api/tests/test-1/heartbeat",
      originalUrl: "/api/tests/test-1/heartbeat",
    });
    expect(heartbeat.nextCalled).toBe(true);
    expect(heartbeat.statusCode).toBeNull();
    expect(recordRateLimitEvent).toHaveBeenCalledTimes(1);
  });

  it("does not count CORS preflight requests", async () => {
    const { createRateLimiter } = loadModule();
    const limiter = createRateLimiter({
      scope: "api-general",
      max: 1,
      windowMs: 60_000,
    });

    const preflight = await invokeLimiter(limiter, { method: "OPTIONS" });
    expect(preflight.nextCalled).toBe(true);
    expect(preflight.statusCode).toBeNull();
    expect(preflight.headers).toEqual({});

    const firstGet = await invokeLimiter(limiter, { method: "GET" });
    expect(firstGet.nextCalled).toBe(true);
    expect(firstGet.statusCode).toBeNull();
  });

  it("uses one atomic Redis script per hit and honours the TTL it returns", async () => {
    jest.resetModules();

    const redisClient = {
      eval: jest.fn().mockResolvedValue([2, 42_000]),
    };

    jest.doMock("../../config/redis", () => ({
      redisClient,
      isRedisAvailable: () => true,
    }));

    jest.doMock("../../services/rate-limit-metrics.service", () => ({
      recordRateLimitEvent: jest.fn().mockResolvedValue(undefined),
    }));

    const { createRateLimiter } = require("../../middleware/rate-limit");
    const limiter = createRateLimiter({
      scope: "api-general",
      max: 1,
      windowMs: 60_000,
    });

    const result = await invokeLimiter(limiter, { method: "GET" });

    expect(redisClient.eval).toHaveBeenCalledTimes(1);
    const [script, numKeys, key, windowArg] = redisClient.eval.mock.calls[0];
    expect(script).toContain("INCR");
    expect(script).toContain("PEXPIRE");
    expect(numKeys).toBe(1);
    expect(key).toMatch(/^rate:api-general:[0-9a-f]{32}$/);
    expect(windowArg).toBe("60000");
    expect(result.statusCode).toBe(429);
    expect(result.headers["Retry-After"]).toBe("42");
  });

  it("degrades to per-instance memory counters when a Redis command fails", async () => {
    jest.resetModules();

    const redisClient = {
      eval: jest.fn().mockRejectedValue(new Error("Command timed out")),
    };

    jest.doMock("../../config/redis", () => ({
      redisClient,
      isRedisAvailable: () => true,
    }));
    jest.doMock("../../services/rate-limit-metrics.service", () => ({
      recordRateLimitEvent: jest.fn().mockResolvedValue(undefined),
    }));

    const { createRateLimiter } = require("../../middleware/rate-limit");
    const limiter = createRateLimiter({ scope: "auth-test", max: 2, windowMs: 60_000, failOpen: false });

    expect((await invokeLimiter(limiter)).nextError).toBeNull();
    expect((await invokeLimiter(limiter)).nextError).toBeNull();
    const third = await invokeLimiter(limiter);
    // Still enforced (not failed open), and no 503 (not failed closed).
    expect(third.statusCode).toBe(429);
    expect(third.nextCalled).toBe(false);
  });

  const makeCountIfHarness = (limiter) => async (finalStatus, { deferClose = false } = {}) => {
    let closeHandler = null;
    const res = {
      statusCode: 200,
      writableFinished: false,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json() { return this; },
      once(event, fn) { if (event === "close") closeHandler = fn; },
    };
    let passed = false;
    await limiter({ method: "POST", headers: {}, ip: "10.0.0.1" }, res, () => { passed = true; });
    const close = async () => {
      if (!closeHandler) return;
      res.statusCode = finalStatus;
      res.writableFinished = true;
      closeHandler();
      await new Promise((resolve) => setImmediate(resolve));
    };
    if (!deferClose) await close();
    return { passed, statusCode: res.statusCode, close };
  };

  it("countIf only consumes quota for matching responses", async () => {
    const { createRateLimiter } = loadModule();
    const invokeWithStatus = makeCountIfHarness(createRateLimiter({
      scope: "login-failed-test",
      max: 2,
      windowMs: 60_000,
      keySelector: () => "ip:10.0.0.1",
      countIf: (_req, res) => res.statusCode === 401,
    }));

    // Successful logins never consume the failed-login budget.
    for (let i = 0; i < 5; i += 1) {
      expect((await invokeWithStatus(200)).passed).toBe(true);
    }
    expect((await invokeWithStatus(401)).passed).toBe(true);
    expect((await invokeWithStatus(401)).passed).toBe(true);
    const blocked = await invokeWithStatus(401);
    expect(blocked.passed).toBe(false);
    expect(blocked.statusCode).toBe(429);
  });

  it("countIf cannot be bypassed by a burst of parallel requests", async () => {
    const { createRateLimiter } = loadModule();
    const invoke = makeCountIfHarness(createRateLimiter({
      scope: "login-burst-test",
      max: 3,
      windowMs: 60_000,
      keySelector: () => "ip:10.0.0.9",
      countIf: (_req, res) => res.statusCode === 401,
    }));

    // 10 attempts arrive before any response has been sent.
    const inFlight = await Promise.all(Array.from({ length: 10 }, () => invoke(401, { deferClose: true })));
    expect(inFlight.filter((r) => r.passed)).toHaveLength(3);
    await Promise.all(inFlight.map((r) => r.close()));
    // Rejected requests released their reservation; the 3 failures remain.
    expect((await invoke(401)).passed).toBe(false);
  });

  it("bounds the in-memory fallback store", async () => {
    const { createRateLimiter, getMemoryCounterSize, MEMORY_COUNTER_MAX_KEYS } = loadModule();
    let n = 0;
    const limiter = createRateLimiter({ scope: "bounded", max: 5, windowMs: 60_000, keySelector: () => `ip:${n}` });
    for (n = 0; n < MEMORY_COUNTER_MAX_KEYS + 2_000; n += 1) {
      await invokeLimiter(limiter);
    }
    // An attacker rotating identities must not grow the fallback store without bound.
    expect(getMemoryCounterSize()).toBeLessThanOrEqual(MEMORY_COUNTER_MAX_KEYS);
  });
});
