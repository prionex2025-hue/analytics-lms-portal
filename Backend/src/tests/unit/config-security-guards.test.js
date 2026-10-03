/**
 * Regression coverage for fail-fast configuration guards.
 *
 * Each guard closes a configuration mistake that would otherwise silently
 * weaken the platform in production:
 *  - PASSWORD_RESET_DELIVERY_MODE=response returns reset tokens in the API body,
 *    turning "forgot password" into account takeover.
 *  - RATE_LIMIT_DISABLED=true switches off login/password-reset brute-force
 *    protection.
 *
 * env.js throws at require time, so every case re-requires it with a clean
 * module registry.
 */
const loadEnv = (overrides = {}) => {
  const snapshot = {};
  for (const [key, value] of Object.entries(overrides)) {
    snapshot[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.resetModules();
  try {
     
    const env = require("../../config/env");
    return { env, error: null };
  } catch (error) {
    return { env: null, error };
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.resetModules();
  }
};

const baseEnv = {
  NODE_ENV: "production",
  MONGODB_URI: "mongodb://lms_app:9N!sR2kB7xP4vD8mQ3cL6wF1hJ5tA0eU@localhost:27017/lms_portal?authSource=admin&replicaSet=rs0",
  REDIS_URL: "redis://:4kZ9!pM2wD7rA5xC8vL3nF6hJ1sQ0bT@localhost:6379",
  REDIS_ENABLED: "true",
  FRONTEND_ORIGIN: "https://lms.example.com",
  AUTH_COOKIE_SECURE: "true",
  AUTH_COOKIE_SAMESITE: "strict",
  METRICS_TOKEN: "5rG!p9Dk2Wv8xJ3hQ6bL1sF4mT0aN7cE",
  JWT_ACCESS_SECRET: "aB3$kLm9!qR2xY7pN5vC8dF1hJ6sW4tG0uE3iO9z",
  JWT_REFRESH_SECRET: "C7!qP4vM9xR2sD6nK1bW8yF3hJ5tA0eU4iG7zL2",
};

describe("password reset delivery mode guard", () => {
  const originalMode = process.env.PASSWORD_RESET_DELIVERY_MODE;
  const originalResend = process.env.RESEND_API_KEY;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.PASSWORD_RESET_DELIVERY_MODE;
    else process.env.PASSWORD_RESET_DELIVERY_MODE = originalMode;
    if (originalResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResend;
  });

  it("refuses to boot in production when the reset token is echoed in the response", () => {
    const { error } = loadEnv({
      ...baseEnv,
      PASSWORD_RESET_DELIVERY_MODE: "response",
      RESEND_API_KEY: undefined,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/PASSWORD_RESET_DELIVERY_MODE=response/);
  });

  it("boots in production with a real email provider", () => {
    const { env, error } = loadEnv({
      ...baseEnv,
      PASSWORD_RESET_DELIVERY_MODE: "resend",
      RESEND_API_KEY: "re_test_key",
    });
    expect(error).toBeNull();
    expect(env.passwordReset.deliveryMode).toBe("resend");
  });

  it("rejects production password-reset delivery without its provider key", () => {
    const { error } = loadEnv({
      ...baseEnv,
      PASSWORD_RESET_DELIVERY_MODE: "resend",
      RESEND_API_KEY: "",
    });
    expect(error?.message).toMatch(/RESEND_API_KEY is required/);
  });

  it("rejects an unsupported webhook password-reset mode rather than silently disabling delivery", () => {
    const { error } = loadEnv({
      ...baseEnv,
      PASSWORD_RESET_DELIVERY_MODE: "webhook",
      RESEND_API_KEY: "",
    });
    expect(error?.message).toMatch(/webhook delivery is not implemented/);
  });

  it("allows loopback origins and reset-token responses only in the isolated local production smoke mode", () => {
    const { env, error } = loadEnv({
      ...baseEnv,
      ALLOW_LOCAL_PRODUCTION_SMOKE: "true",
      FRONTEND_ORIGIN: "http://127.0.0.1:18080",
      PASSWORD_RESET_DELIVERY_MODE: "response",
      PASSWORD_RESET_RETURN_TOKEN: "true",
      RESEND_API_KEY: undefined,
    });
    expect(error).toBeNull();
    expect(env.passwordReset.returnToken).toBe(true);
  });

  it("rejects production when shared Redis security state is disabled", () => {
    const { error } = loadEnv({ ...baseEnv, REDIS_ENABLED: "false", RESEND_API_KEY: "re_test_key" });
    expect(error?.message).toMatch(/REDIS_ENABLED must be true/);
  });

  it("rejects long but low-entropy or placeholder production JWT secrets", () => {
    const { error } = loadEnv({
      ...baseEnv,
      JWT_ACCESS_SECRET: "a".repeat(48),
      RESEND_API_KEY: "re_test_key",
    });
    expect(error?.message).toMatch(/strong, unique production secrets/);
  });

  it("rejects production MongoDB URIs without credentials or replica set", () => {
    const { error } = loadEnv({ ...baseEnv, MONGODB_URI: "mongodb://localhost:27017/lms_portal", RESEND_API_KEY: "re_test_key" });
    expect(error?.message).toMatch(/authenticated MongoDB/);
  });

  it("rejects insecure production frontend origins", () => {
    const { error } = loadEnv({ ...baseEnv, FRONTEND_ORIGIN: "http://lms.example.com", RESEND_API_KEY: "re_test_key" });
    expect(error?.message).toMatch(/HTTPS origins/);
  });

  it("keeps response mode available to developers without an email provider", () => {
    const { env, error } = loadEnv({
      ...baseEnv,
      NODE_ENV: "development",
      PASSWORD_RESET_DELIVERY_MODE: "response",
      RESEND_API_KEY: undefined,
    });
    expect(error).toBeNull();
    expect(env.passwordReset.deliveryMode).toBe("response");
  });
});

describe("rate limit kill switch guard", () => {
  const loadRateLimit = (nodeEnv) => {
    const snapshot = {
      NODE_ENV: process.env.NODE_ENV,
      RATE_LIMIT_DISABLED: process.env.RATE_LIMIT_DISABLED,
    };
    process.env.NODE_ENV = nodeEnv;
    process.env.RATE_LIMIT_DISABLED = "true";
    jest.resetModules();

    // Force the in-memory counter path so the test needs no Redis.
    jest.doMock("../../config/redis", () => ({
      redisClient: null,
      isRedisAvailable: () => false,
    }));
    jest.doMock("../../services/rate-limit-metrics.service", () => ({
      recordRateLimitEvent: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock("../../utils/token", () => ({ verifyAccessToken: jest.fn() }));

     
    const mod = require("../../middleware/rate-limit");
    return {
      mod,
      restore: () => {
        for (const [key, value] of Object.entries(snapshot)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        jest.resetModules();
        jest.dontMock("../../utils/token");
      },
    };
  };

  // Mirrors the harness in rate-limit.middleware.test.js: run the middleware and
  // report whether it called next() or answered with a 429.
  const runLimiter = async (limiter, ip) => {
    const req = {
      headers: {},
      params: {},
      body: {},
      method: "POST",
      path: "/api/tests/test-1/answer",
      originalUrl: "/api/tests/test-1/answer",
      ip,
      user: { id: "student-1", role: "STUDENT", collegeId: "college-1" },
    };
    let statusCode = null;
    let nextError = null;
    let nextCalled = false;
    const res = {
      headersSent: false,
      setHeader() { return this; },
      status(code) { statusCode = code; return this; },
      json() { return this; },
    };
    await limiter(req, res, (error) => { nextCalled = true; nextError = error || null; });
    return { statusCode, nextCalled, nextError };
  };

  it("ignores RATE_LIMIT_DISABLED and fails closed when Redis is unavailable in production", async () => {
    const { mod, restore } = loadRateLimit("production");
    try {
      const limiter = mod.createRateLimiter({ scope: "guard-prod", windowMs: 60_000, max: 1 });
      const result = await runLimiter(limiter, "203.0.113.9");
      expect(result.nextCalled).toBe(true);
      expect(result.nextError).toMatchObject({ statusCode: 503, code: "RATE_LIMIT_STORE_UNAVAILABLE" });
    } finally {
      restore();
    }
  });

  it("still honours the kill switch outside production for local debugging", async () => {
    const { mod, restore } = loadRateLimit("development");
    try {
      const limiter = mod.createRateLimiter({ scope: "guard-dev", windowMs: 60_000, max: 1 });
      for (let i = 0; i < 4; i += 1) {
         
        const result = await runLimiter(limiter, "203.0.113.10");
        expect(result.nextCalled).toBe(true);
        expect(result.statusCode).toBeNull();
      }
    } finally {
      restore();
    }
  });
});
