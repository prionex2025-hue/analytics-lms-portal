jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../utils/token", () => ({
  createAccessToken: jest.fn(() => "new-access-token"),
  createRefreshToken: jest.fn(() => "rotated-refresh-token"),
  verifyRefreshToken: jest.fn(),
}));

jest.mock("../../services/refresh-token-cache.service", () => ({
  cacheRefreshToken: jest.fn(async () => {}),
  getCachedRefreshToken: jest.fn(async () => null),
  hashRefreshToken: jest.fn((token) => `hash:${token}`),
  invalidateRefreshToken: jest.fn(async () => {}),
  invalidateRefreshTokenRecord: jest.fn(async () => {}),
}));

const models = require("../../models");
const { verifyRefreshToken } = require("../../utils/token");
const { adminRefresh } = require("../../controllers/Admin/auth.controller");

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
    };

    handler(req, res, (error) => {
      if (error) {
        reject(error);
      }
    });
  });

describe("admin auth refresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("issues access token for COLLEGE_ADMIN refresh tokens", async () => {
    const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000);
    const createRefreshRecord = jest.fn().mockResolvedValue({
      id: "session-2",
      tokenHash: "rotated-token-hash",
      adminId: "admin-1",
      revokedAt: null,
      expiresAt: nowPlusOneHour,
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    models.init.mockResolvedValue({
      dbClient: {
        adminRefreshToken: {
          findFirst: jest.fn().mockResolvedValue({
            id: "session-1",
            tokenHash: "old-token-hash",
            adminId: "admin-1",
            keepLoggedIn: true,
            revokedAt: null,
            expiresAt: nowPlusOneHour,
          }),
          updateMany,
          create: createRefreshRecord,
          update: jest.fn().mockResolvedValue({ id: "session-1" }),
        },
        admin: {
          findUnique: jest.fn().mockResolvedValue({
            id: "admin-1",
            role: "COLLEGE_ADMIN",
            collegeId: "college-a",
            departmentId: null,
            isActive: true,
          }),
        },
      },
    });

    verifyRefreshToken.mockImplementation((token) => ({
      sub: "admin-1",
      role: "COLLEGE_ADMIN",
      exp: Math.floor(Date.now() / 1000) + (token === "rotated-refresh-token" ? 7200 : 3600),
    }));

    const { res, payload } = await invoke(adminRefresh, {
      baseUrl: "/api/college-admin/auth",
      cookies: {},
      body: { refreshToken: "refresh-token" },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload).toEqual({
      accessToken: "new-access-token",
      sessionId: "session-2",
    });
    expect(payload).not.toHaveProperty("refreshToken");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revokedReason: "rotated" }),
    }));
    expect(createRefreshRecord).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        keepLoggedIn: true,
        tokenHash: expect.any(String),
      }),
    });
    expect(createRefreshRecord.mock.calls[0][0].data).not.toHaveProperty("token");
    expect(res.cookie).toHaveBeenCalledWith(
      "lms_admin_refresh_token",
      "rotated-refresh-token",
      expect.objectContaining({
        maxAge: 1000 * 60 * 60 * 24 * 30,
        path: "/api/college-admin/auth",
        sameSite: "lax",
      })
    );
  });
});
