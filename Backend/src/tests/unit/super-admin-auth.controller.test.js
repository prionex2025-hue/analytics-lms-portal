jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../utils/token", () => ({
  createAccessToken: jest.fn(() => "new-super-access-token"),
  createRefreshToken: jest.fn(() => "rotated-super-refresh-token"),
  verifyRefreshToken: jest.fn(),
}));

jest.mock("../../services/refresh-token-cache.service", () => ({
  cacheRefreshToken: jest.fn(async () => {}),
  getCachedRefreshToken: jest.fn(async () => null),
  hashRefreshToken: jest.fn((token) => `hash:${token}`),
  invalidateRefreshToken: jest.fn(async () => {}),
  invalidateRefreshTokenRecord: jest.fn(async () => {}),
}));

jest.mock("../../services/access-token-revocation.service", () => ({
  revokeAccessTokenFromRequest: jest.fn(async () => {}),
}));

const bcrypt = require("bcrypt");
const models = require("../../models");
const { createRefreshToken, verifyRefreshToken } = require("../../utils/token");
const { superAdminLogin, superAdminRefresh, superAdminLogout } = require("../../controllers/SuperAdmin/auth.controller");

const invoke = async (handler, req = {}) =>
  new Promise((resolve, reject) => {
    const res = {
      status: jest.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn((payload) => {
        resolve({ res, payload });
      }),
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };

    handler(req, res, (error) => {
      if (error) {
        reject(error);
      }
    });
  });

describe("super-admin auth refresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createRefreshToken.mockReturnValue("rotated-super-refresh-token");
  });

  it("logs in SuperAdmins through database-backed credentials only", async () => {
    const passwordHash = await bcrypt.hash("StrongPassword123!", 10);
    const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000);
    const superAdminRecord = {
      id: "super-1",
      fullName: "Prionex Owner",
      email: "owner@prionex.com",
      role: "SUPER_ADMIN",
      isActive: true,
      passwordHash,
    };
    const db = {
      superAdmin: {
        findFirst: jest.fn().mockResolvedValue(superAdminRecord),
        update: jest.fn().mockResolvedValue({ ...superAdminRecord, lastLoginAt: new Date() }),
      },
      superAdminRefreshToken: {
        create: jest.fn().mockResolvedValue({
          id: "session-1",
          tokenHash: "hash:new-super-refresh-token",
          superAdminId: "super-1",
          revokedAt: null,
          expiresAt: nowPlusOneHour,
        }),
      },
    };
    db.superAdmin.upsert = jest.fn();
    models.init.mockResolvedValue({ dbClient: db });
    createRefreshToken.mockReturnValue("new-super-refresh-token");
    verifyRefreshToken.mockReturnValue({
      sub: "super-1",
      role: "SUPER_ADMIN",
      exp: Math.floor(nowPlusOneHour.getTime() / 1000),
    });

    const { res, payload } = await invoke(superAdminLogin, {
      body: {
        email: "owner@prionex.com",
        password: "StrongPassword123!",
      },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.accessToken).toBe("new-super-access-token");
    expect(payload).not.toHaveProperty("refreshToken");
    expect(payload.superAdmin).toEqual(expect.objectContaining({
      id: "super-1",
      email: "owner@prionex.com",
      role: "SUPER_ADMIN",
    }));
    expect(res.cookie).toHaveBeenCalledWith(
      "lms_super_admin_refresh_token",
      "new-super-refresh-token",
      expect.objectContaining({ path: "/api/super-admin/auth", sameSite: "lax" })
    );
    expect(res.cookie).toHaveBeenCalledWith(
      "lms_super_admin_refresh_token",
      "new-super-refresh-token",
      expect.objectContaining({ path: "/api/superadmin/auth" })
    );
    expect(res.cookie.mock.calls[0][2]).not.toHaveProperty("maxAge");
    expect(db.superAdminRefreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ keepLoggedIn: false }),
    });
    expect(db.superAdmin.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: "SUPER_ADMIN" }),
    }));
    expect(db.superAdmin.upsert).not.toHaveBeenCalled();
  });

  it("rotates refresh tokens and writes cookies for both super-admin route aliases", async () => {
    const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000);
    models.init.mockResolvedValue({
      dbClient: {
        superAdminRefreshToken: {
          findFirst: jest.fn().mockResolvedValue({
            id: "session-1",
            tokenHash: "hash:old-super-refresh-token",
            superAdminId: "super-1",
            keepLoggedIn: true,
            revokedAt: null,
            expiresAt: nowPlusOneHour,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockResolvedValue({
            id: "session-2",
            tokenHash: "hash:rotated-super-refresh-token",
            superAdminId: "super-1",
            revokedAt: null,
            expiresAt: nowPlusOneHour,
          }),
          update: jest.fn().mockResolvedValue({ id: "session-1" }),
        },
        superAdmin: {
          findUnique: jest.fn().mockResolvedValue({
            id: "super-1",
            role: "SUPER_ADMIN",
            isActive: true,
          }),
        },
      },
    });

    verifyRefreshToken.mockImplementation((token) => ({
      sub: "super-1",
      role: "SUPER_ADMIN",
      exp: Math.floor(Date.now() / 1000) + (token === "rotated-super-refresh-token" ? 7200 : 3600),
    }));

    const { res, payload } = await invoke(superAdminRefresh, {
      cookies: {},
      body: { refreshToken: "old-super-refresh-token" },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload).toEqual({
      accessToken: "new-super-access-token",
      sessionId: "session-2",
    });
    expect(payload).not.toHaveProperty("refreshToken");
    expect(res.cookie).toHaveBeenCalledWith(
      "lms_super_admin_refresh_token",
      "rotated-super-refresh-token",
      expect.objectContaining({
        maxAge: 1000 * 60 * 60 * 24 * 30,
        path: "/api/super-admin/auth",
        sameSite: "lax",
      })
    );
    expect(res.cookie).toHaveBeenCalledWith(
      "lms_super_admin_refresh_token",
      "rotated-super-refresh-token",
      expect.objectContaining({ path: "/api/superadmin/auth" })
    );
  });

  it("clears cookies for both super-admin route aliases on logout", async () => {
    models.init.mockResolvedValue({
      dbClient: {
        superAdminRefreshToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    });

    const { res } = await invoke(superAdminLogout, {
      cookies: {},
      body: { refreshToken: "old-super-refresh-token" },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.clearCookie).toHaveBeenCalledWith(
      "lms_super_admin_refresh_token",
      expect.objectContaining({ path: "/api/super-admin/auth" })
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      "lms_super_admin_refresh_token",
      expect.objectContaining({ path: "/api/superadmin/auth" })
    );
  });
});
