describe("auth middleware token revocation", () => {
  const loadAuth = ({ revoked = false, principalTokenVersion = 2, payloadTokenVersion = 1 } = {}) => {
    jest.resetModules();

    const db = {
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: "student-1",
          role: "STUDENT",
          collegeId: "college-1",
          departmentId: "department-1",
          tokenVersion: principalTokenVersion,
          isActive: true,
          batchIds: [],
        }),
      },
    };

    jest.doMock("../../config/db", () => db);
    jest.doMock("../../utils/token", () => ({
      verifyAccessToken: jest.fn(() => ({
        sub: "student-1",
        role: "STUDENT",
        collegeId: "college-1",
        departmentId: "department-1",
        tokenVersion: payloadTokenVersion,
        jti: "access-token-id",
      })),
    }));
    jest.doMock("../../services/auth-cache.service", () => ({
      getCachedUser: jest.fn(async () => null),
      setCachedUser: jest.fn(async () => {}),
    }));
    jest.doMock("../../services/access-token-revocation.service", () => ({
      isAccessTokenRevoked: jest.fn(async () => revoked),
    }));

    return { ...require("../../middleware/auth"), db };
  };

  const invoke = (middleware) =>
    new Promise((resolve) => {
      const req = {
        headers: { authorization: "Bearer access-token" },
      };

      middleware(req, {}, (error) => resolve({ req, error }));
    });

  it("rejects access tokens with stale principal tokenVersion", async () => {
    const { authenticateStudent } = loadAuth();
    const { error } = await invoke(authenticateStudent);

    expect(error?.statusCode).toBe(401);
    expect(error?.code).toBe("TOKEN_REVOKED");
  });

  it("rejects blocklisted access token ids", async () => {
    const { authenticateStudent } = loadAuth({
      revoked: true,
      principalTokenVersion: 2,
      payloadTokenVersion: 2,
    });
    const { error } = await invoke(authenticateStudent);

    expect(error?.statusCode).toBe(401);
    expect(error?.code).toBe("TOKEN_REVOKED");
  });
});
