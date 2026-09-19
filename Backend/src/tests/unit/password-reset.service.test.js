const crypto = require("crypto");

const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");

describe("password reset service", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  const loadService = (overrides = {}) => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      MONGODB_URI: "mongodb://localhost:27017/lms_test",
      JWT_ACCESS_SECRET: "a".repeat(48),
      JWT_REFRESH_SECRET: "b".repeat(48),
      PASSWORD_RESET_DELIVERY_MODE: "response",
      PASSWORD_RESET_RETURN_TOKEN: "true",
      PASSWORD_RESET_FRONTEND_URL: "http://localhost:5173/reset-password",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "noreply@analyticsedify.com",
      RESEND_FROM_NAME: "Analytics Edify",
      ...overrides,
    };
    jest.doMock("../../config/redis", () => ({
      isRedisAvailable: () => false,
    }));
    return require("../../services/password-reset.service");
  };

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  const createFakeDb = () => {
    const admin = {
      id: "admin-1",
      email: "admin@example.edu",
      role: "ADMIN",
      isActive: true,
      passwordHash: "old-hash",
    };
    const resetTokens = [];
    const refreshTokens = [{ id: "refresh-1", adminId: "admin-1", tokenHash: "abc", revokedAt: null }];

    return {
      resetTokens,
      admin: {
        findFirst: jest.fn(async () => admin),
        findUnique: jest.fn(async () => admin),
        update: jest.fn(async ({ data }) => Object.assign(admin, data)),
      },
      passwordResetToken: {
        updateMany: jest.fn(async ({ where, data }) => {
          let count = 0;
          for (const token of resetTokens) {
            if (token.scope === where.scope && token.principalId === where.principalId && token.usedAt === where.usedAt) {
              Object.assign(token, data);
              count += 1;
            }
          }
          return { count };
        }),
        create: jest.fn(async ({ data }) => {
          const record = { id: `reset-${resetTokens.length + 1}`, ...data };
          resetTokens.push(record);
          return record;
        }),
        findFirst: jest.fn(async ({ where }) =>
          resetTokens.find((token) => token.scope === where.scope && token.tokenHash === where.tokenHash) || null
        ),
        update: jest.fn(async ({ where, data }) => {
          const record = resetTokens.find((token) => token.id === where.id);
          Object.assign(record, data);
          return record;
        }),
      },
      adminRefreshToken: {
        findMany: jest.fn(async () => refreshTokens),
        updateMany: jest.fn(async ({ data }) => {
          refreshTokens.forEach((token) => Object.assign(token, data));
          return { count: refreshTokens.length };
        }),
      },
    };
  };

  it("creates a hashed one-time token without exposing account existence semantics", async () => {
    const db = createFakeDb();
    const { GENERIC_RESET_MESSAGE, requestPasswordReset } = loadService();

    const result = await requestPasswordReset({
      scope: "admin",
      identifier: "admin@example.edu",
      db,
      req: { headers: {}, ip: "127.0.0.1" },
    });

    expect(result.message).toBe(GENERIC_RESET_MESSAGE);
    expect(result.resetToken).toBeTruthy();
    expect(db.resetTokens).toHaveLength(1);
    expect(db.resetTokens[0].tokenHash).toBe(hashToken(result.resetToken));
    expect(db.resetTokens[0].tokenHash).not.toBe(result.resetToken);
  });

  it("resets password and revokes active refresh sessions", async () => {
    const db = createFakeDb();
    const { resetPasswordWithToken, requestPasswordReset } = loadService();

    const requested = await requestPasswordReset({
      scope: "admin",
      identifier: "admin@example.edu",
      db,
      req: { headers: {}, ip: "127.0.0.1" },
    });

    await resetPasswordWithToken({
      scope: "admin",
      token: requested.resetToken,
      password: "new-secure-password",
      db,
    });

    await expect(resetPasswordWithToken({
      scope: "admin",
      token: requested.resetToken,
      password: "second-password",
      db,
    })).rejects.toMatchObject({
      code: "INVALID_PASSWORD_RESET_TOKEN",
    });

    expect(db.admin.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "admin-1" },
      data: expect.objectContaining({ passwordHash: expect.any(String) }),
    }));
    expect(db.adminRefreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { adminId: "admin-1", revokedAt: null },
      data: expect.objectContaining({ revokedReason: "password_reset" }),
    }));
    expect(db.resetTokens[0].usedAt).toBeInstanceOf(Date);
  });

  it("sends password reset email with Resend without returning the token", async () => {
    const db = createFakeDb();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "email-1" }),
    }));
    const { GENERIC_RESET_MESSAGE, requestPasswordReset } = loadService({
      PASSWORD_RESET_DELIVERY_MODE: "resend",
      PASSWORD_RESET_RETURN_TOKEN: "false",
      PASSWORD_RESET_FRONTEND_BASE_URL: "https://analyticsedify.com",
      RESEND_API_KEY: "re_test_key",
    });

    const result = await requestPasswordReset({
      scope: "admin",
      portal: "college-admin",
      identifier: "admin@example.edu",
      db,
      req: { headers: {}, ip: "127.0.0.1" },
    });

    expect(result).toEqual({ message: GENERIC_RESET_MESSAGE });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer re_test_key",
          "content-type": "application/json",
          "Idempotency-Key": expect.stringMatching(/^password-reset-/),
        }),
      })
    );

    const [, fetchOptions] = global.fetch.mock.calls[0];
    const payload = JSON.parse(fetchOptions.body);
    expect(payload.from).toBe("Analytics Edify <noreply@analyticsedify.com>");
    expect(payload.to).toEqual(["admin@example.edu"]);
    expect(payload.subject).toBe("Reset your Analytics Edify LMS password");
    expect(payload.html).toContain("https://analyticsedify.com/college-admin/reset-password?scope=admin&amp;token=");
    expect(payload.html).toContain("prionex.dev");
    expect(payload.html).toContain("Built and supported by");
    expect(payload.text).toContain("https://analyticsedify.com/college-admin/reset-password?scope=admin&token=");
    expect(payload.text).toContain("Built and supported by Prionex");
    expect(payload.tags).toEqual(expect.arrayContaining([
      { name: "event", value: "password_reset" },
      { name: "portal", value: "college-admin" },
    ]));
  });
});
