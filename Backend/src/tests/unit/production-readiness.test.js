describe("trusted network allowlist", () => {
  const { createIpAllowlist } = require("../../utils/ip-allowlist");

  it("matches single addresses, CIDR ranges and IPv4-mapped IPv6", () => {
    const list = createIpAllowlist(["203.0.113.10", "198.51.100.0/24", "2001:db8::/32"]);
    expect(list.has("203.0.113.10")).toBe(true);
    expect(list.has("::ffff:203.0.113.10")).toBe(true);
    expect(list.has("198.51.100.77")).toBe(true);
    expect(list.has("2001:db8::1")).toBe(true);
    expect(list.has("203.0.113.11")).toBe(false);
    expect(list.has("198.51.101.1")).toBe(false);
  });

  it("ignores invalid entries instead of widening the list", () => {
    const list = createIpAllowlist(["not-an-ip", "10.0.0.0/99", "*"]);
    expect(list.size).toBe(0);
    expect(list.has("10.0.0.1")).toBe(false);
  });
});

describe("structured logger redaction", () => {
  const { redact } = require("../../utils/logger");

  it("redacts credential-like keys at any depth", () => {
    const out = redact({
      password: "p",
      nested: { refreshToken: "r", Authorization: "Bearer x", apiKey: "k", cookie: "c", ok: 1 },
      list: [{ newPassword: "n" }],
    });
    expect(out.password).toBe("[redacted]");
    expect(out.nested).toEqual({ refreshToken: "[redacted]", Authorization: "[redacted]", apiKey: "[redacted]", cookie: "[redacted]", ok: 1 });
    expect(out.list[0].newPassword).toBe("[redacted]");
  });
});

describe("access-token revocation without Redis (production)", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.resetModules();
    jest.dontMock("../../utils/token");
  });

  const load = (redisClient) => {
    jest.resetModules();
    process.env.NODE_ENV = "production";
    jest.doMock("../../config/redis", () => ({ redisClient, isRedisAvailable: () => false }));
    jest.doMock("../../utils/token", () => ({ verifyAccessToken: jest.fn() }));
    jest.doMock("../../realtime/socket", () => ({ disconnectUserSockets: jest.fn() }));
    jest.doMock("../../utils/token", () => ({ verifyAccessToken: jest.fn() }));
    return require("../../services/access-token-revocation.service");
  };

  it("fails closed for token checks and logout when Redis is down", async () => {
    const { isAccessTokenRevoked, revokeAccessTokenPayload } = load({});
    const payload = { jti: "jti-1", exp: Math.floor(Date.now() / 1000) + 600 };

    await expect(isAccessTokenRevoked(payload)).rejects.toMatchObject({
      statusCode: 503,
      code: "TOKEN_REVOCATION_UNAVAILABLE",
    });
    await expect(revokeAccessTokenPayload(payload)).rejects.toMatchObject({
      statusCode: 503,
      code: "TOKEN_REVOCATION_UNAVAILABLE",
    });
  });
});

describe("error handler: database unavailable", () => {
  const { errorHandler } = require("../../middleware/error-handler");

  const run = (error) => {
    const res = {
      headersSent: false,
      headers: {},
      statusCode: null,
      body: null,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    errorHandler(error, { method: "GET", originalUrl: "/api/x?token=secret", headers: {} }, res, () => {});
    return res;
  };

  it.each(["MongooseServerSelectionError", "MongoServerSelectionError", "MongoNotConnectedError", "MongoNetworkError"])(
    "maps %s to 503 with Retry-After and a generic message",
    (name) => {
      const error = new Error("connect ECONNREFUSED 10.0.0.5:27017");
      error.name = name;
      const res = run(error);
      expect(res.statusCode).toBe(503);
      expect(res.headers["Retry-After"]).toBe("5");
      expect(res.body.code).toBe("SERVICE_UNAVAILABLE");
      expect(res.body.message).not.toContain("10.0.0.5");
    }
  );
});

describe("auth rate-limit policy", () => {
  it("exempts trusted networks from per-IP student login limits but never from super admin limits", () => {
    jest.resetModules();
    const configs = [];
    jest.doMock("../../config/env", () => ({
      rateLimit: {
        authTrustedNetworks: ["198.51.100.0/24"],
        authLoginWindowMs: 1, authLoginMax: 1, authLoginFailedMax: 1,
        superAdminAuthLoginWindowMs: 1, superAdminAuthLoginMax: 1, superAdminAuthLoginAttemptMax: 1,
        authRefreshWindowMs: 1, authRefreshMax: 1, authRefreshIpMax: 1,
        authForgotPasswordWindowMs: 1, authForgotPasswordMax: 1,
        authResetPasswordWindowMs: 1, authResetPasswordMax: 1,
        superAdminPasswordResetWindowMs: 1, superAdminPasswordResetMax: 1,
      },
    }));
    jest.doMock("../../middleware/rate-limit", () => ({
      authKeyByIp: jest.fn(),
      refreshKeyBySession: jest.fn(),
      createRateLimiter: jest.fn((options) => {
        configs.push(options);
        return () => {};
      }),
    }));
    const { buildAuthRateLimiters } = require("../../middleware/auth-rate-limits");
    buildAuthRateLimiters("student");

    const campusReq = { ip: "198.51.100.20", body: {} };
    const campusSuperAdminReq = { ip: "198.51.100.20", body: { role: "SUPER_ADMIN" } };
    const byScope = Object.fromEntries(configs.map((c) => [c.scope, c]));

    expect(byScope["student-login"].skip(campusReq)).toBe(true);
    expect(byScope["student-login-failed"].skip(campusReq)).toBe(true);
    expect(byScope["student-login"].skip({ ip: "203.0.113.1", body: {} })).toBe(false);
    expect(byScope["super-admin-login"].skip(campusSuperAdminReq)).toBe(false);
    expect(byScope["super-admin-login-failed"].skip(campusSuperAdminReq)).toBe(false);
    // Forgot/reset stay limited for everyone.
    expect(byScope["student-forgot-password"].skip).toBeUndefined();
  });
});
