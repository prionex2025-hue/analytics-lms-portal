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
  MONGODB_URI: "mongodb://localhost:27017/lms_portal",
  JWT_ACCESS_SECRET: "a".repeat(48),
  JWT_REFRESH_SECRET: "b".repeat(48),
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

     
    const mod = require("../../middleware/rate-limit");
    return {
      mod,
      restore: () => {
        for (const [key, value] of Object.entries(snapshot)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        jest.resetModules();
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
    let nextCalled = false;
    const res = {
      headersSent: false,
      setHeader() { return this; },
      status(code) { statusCode = code; return this; },
      json() { return this; },
    };
    await limiter(req, res, () => { nextCalled = true; });
    return { statusCode, nextCalled };
  };

  it("ignores RATE_LIMIT_DISABLED in production so brute-force limits stay on", async () => {
    const { mod, restore } = loadRateLimit("production");
    try {
      const limiter = mod.createRateLimiter({ scope: "guard-prod", windowMs: 60_000, max: 1 });
      // First call consumes the single allowance, the second must be blocked.
      await runLimiter(limiter, "203.0.113.9");
      const second = await runLimiter(limiter, "203.0.113.9");
      expect(second.statusCode).toBe(429);
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
