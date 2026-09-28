const mocks = {
  verifyAccessToken: jest.fn(),
  isAccessTokenRevoked: jest.fn(async () => false),
  getCachedUser: jest.fn(async () => null),
  setCachedUser: jest.fn(async () => {}),
  canStudentAuthenticate: jest.fn(async () => true),
  db: {
    student: { findUnique: jest.fn(async () => null) },
    admin: { findUnique: jest.fn(async () => null) },
    superAdmin: { findUnique: jest.fn(async () => null) },
  },
};

const installMocks = () => {
  mocks.verifyAccessToken.mockReset();
  mocks.isAccessTokenRevoked.mockImplementation(async () => false);
  mocks.getCachedUser.mockImplementation(async () => null);
  mocks.setCachedUser.mockReset();
  mocks.canStudentAuthenticate.mockReturnValue(true);
  mocks.db.student.findUnique.mockReset();
  mocks.db.admin.findUnique.mockReset();
  mocks.db.superAdmin.findUnique.mockReset();

  jest.doMock("../../config/db", () => mocks.db);
  jest.doMock("../../utils/token", () => ({ verifyAccessToken: mocks.verifyAccessToken }));
  jest.doMock("../../services/access-token-revocation.service", () => ({
    isAccessTokenRevoked: mocks.isAccessTokenRevoked,
  }));
  jest.doMock("../../services/auth-cache.service", () => ({
    getCachedUser: mocks.getCachedUser,
    setCachedUser: mocks.setCachedUser,
  }));
  jest.doMock("../../services/student-lifecycle.service", () => ({
    canStudentAuthenticate: mocks.canStudentAuthenticate,
  }));

  return require("../../middleware/auth");
};

const invoke = async (middleware, req) => {
  const next = jest.fn();
  middleware(req, {}, next);
  for (let attempt = 0; attempt < 20 && !next.mock.calls.length; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(next).toHaveBeenCalled();
  return next;
};

const clocklessTokenPayload = () => ({
  sub: "u1",
  role: "STUDENT",
  collegeId: "c1",
  departmentId: "d1",
  tokenVersion: 0,
  iat: 1,
  exp: 2,
});

describe("auth middleware", () => {
  beforeEach(() => {
    jest.resetModules();
    installMocks();
  });

  const tokenReturns = (payload) => mocks.verifyAccessToken.mockReturnValue(payload);
  const tokenThrows = (error) => mocks.verifyAccessToken.mockImplementation(() => {
    throw error;
  });

  describe("parseTokenPayload", () => {
    it("rejects requests without a bearer token", async () => {
      const { authenticateStudent } = require("../../middleware/auth");
      tokenReturns(clocklessTokenPayload());
      const next = await invoke(authenticateStudent, { headers: {} });
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, message: "Authentication required" }));
    });

    it("maps expired tokens to TOKEN_EXPIRED", async () => {
      const { TokenExpiredError } = require("jsonwebtoken");
      const { authenticateStudent } = require("../../middleware/auth");
      tokenThrows(new TokenExpiredError("jwt expired", new Date()));
      const next = await invoke(authenticateStudent, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, code: "TOKEN_EXPIRED" });
    });

    it("maps malformed tokens to INVALID_TOKEN", async () => {
      const { JsonWebTokenError } = require("jsonwebtoken");
      const { authenticateStudent } = require("../../middleware/auth");
      tokenThrows(new JsonWebTokenError("jwt malformed"));
      const next = await invoke(authenticateStudent, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, code: "INVALID_TOKEN" });
    });

    it("rethrows unexpected token errors unchanged", async () => {
      const { authenticateStudent } = require("../../middleware/auth");
      tokenThrows(new Error("boom"));
      const next = await invoke(authenticateStudent, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ message: "boom" });
    });
  });

  describe("authenticateStudent", () => {
    const student = {
      id: "u1",
      collegeId: "c1",
      departmentId: "d1",
      role: "STUDENT",
      tokenVersion: 0,
      batchIds: ["b2"],
      batchId: "b1",
      isActive: true,
      lifecycleStatus: "ACTIVE",
    };

    it("rejects non-student roles", async () => {
      const { authenticateStudent } = require("../../middleware/auth");
      tokenReturns({ ...clocklessTokenPayload(), role: "ADMIN" });
      const next = await invoke(authenticateStudent, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, message: "Student role required" });
    });

    it("rejects revoked access tokens", async () => {
      const { authenticateStudent } = require("../../middleware/auth");
      tokenReturns(clocklessTokenPayload());
      mocks.isAccessTokenRevoked.mockImplementation(async () => true);
      const next = await invoke(authenticateStudent, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, code: "TOKEN_REVOKED" });
    });

    it("rejects unknown students", async () => {
      const { authenticateStudent } = require("../../middleware/auth");
      tokenReturns(clocklessTokenPayload());
      const next = await invoke(authenticateStudent, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, message: "Invalid access token" });
    });

    it("rejects token version mismatches as revoked", async () => {
      const { authenticateStudent } = require("../../middleware/auth");
      tokenReturns({ ...clocklessTokenPayload(), tokenVersion: 3 });
      mocks.db.student.findUnique.mockResolvedValue(student);
      const next = await invoke(authenticateStudent, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, code: "TOKEN_REVOKED" });
    });

    it("rejects department claim mismatches", async () => {
      const { authenticateStudent } = require("../../middleware/auth");
      tokenReturns({ ...clocklessTokenPayload(), departmentId: "d-other" });
      mocks.db.student.findUnique.mockResolvedValue(student);
      const next = await invoke(authenticateStudent, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, message: "Invalid access token" });
    });

    it("rejects inactive students", async () => {
      const { authenticateStudent } = require("../../middleware/auth");
      tokenReturns(clocklessTokenPayload());
      mocks.canStudentAuthenticate.mockReturnValue(false);
      mocks.db.student.findUnique.mockResolvedValue(student);
      const next = await invoke(authenticateStudent, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, code: "ACCOUNT_INACTIVE" });
    });

    it("authenticates a valid student and merges batch ids", async () => {
      const { authenticateStudent } = require("../../middleware/auth");
      const req = { headers: { authorization: "Bearer token" } };
      tokenReturns(clocklessTokenPayload());
      mocks.db.student.findUnique.mockResolvedValue(student);
      const next = await invoke(authenticateStudent, req);
      expect(next).toHaveBeenCalledWith();
      expect(req.user).toMatchObject({ id: "u1" });
      expect(req.user.batchIds).toEqual(["b2", "b1"]);
      expect(req.collegeId).toBe("c1");
      expect(mocks.setCachedUser).toHaveBeenCalledWith("student", "u1", expect.any(Object));
    });
  });

  describe("authenticatePlatformAdmin", () => {
    it("rejects non-admin like roles", async () => {
      const { authenticatePlatformAdmin } = require("../../middleware/auth");
      tokenReturns({ ...clocklessTokenPayload(), role: "STUDENT" });
      const next = await invoke(authenticatePlatformAdmin, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, message: "Admin role required" });
    });

    it("rejects inactive or mismatched admins", async () => {
      const { authenticatePlatformAdmin } = require("../../middleware/auth");
      tokenReturns({ ...clocklessTokenPayload(), role: "ADMIN" });
      mocks.db.admin.findUnique.mockResolvedValue({ id: "a1", collegeId: "c1", role: "ADMIN", isActive: false, tokenVersion: 0 });
      const next = await invoke(authenticatePlatformAdmin, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, message: "Invalid access token" });
    });

    it("requires a college scope", async () => {
      const { authenticatePlatformAdmin } = require("../../middleware/auth");
      tokenReturns({ ...clocklessTokenPayload(), role: "ADMIN", departmentId: "d1" });
      mocks.db.admin.findUnique.mockResolvedValue({ id: "a1", role: "ADMIN", isActive: true, tokenVersion: 0 });
      const next = await invoke(authenticatePlatformAdmin, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, code: "COLLEGE_SCOPE_REQUIRED" });
    });

    it("requires a department scope for department admins", async () => {
      const { authenticatePlatformAdmin } = require("../../middleware/auth");
      tokenReturns({ ...clocklessTokenPayload(), role: "ADMIN" });
      mocks.db.admin.findUnique.mockResolvedValue({ id: "a1", collegeId: "c1", role: "ADMIN", isActive: true, tokenVersion: 0 });
      const next = await invoke(authenticatePlatformAdmin, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, code: "DEPARTMENT_SCOPE_REQUIRED" });
    });

    it("authenticates a college admin and resolves permissions", async () => {
      const { authenticatePlatformAdmin } = require("../../middleware/auth");
      const req = { headers: { authorization: "Bearer token" } };
      tokenReturns({ ...clocklessTokenPayload(), role: "COLLEGE_ADMIN", departmentId: null });
      mocks.db.admin.findUnique.mockResolvedValue({ id: "a1", collegeId: "c1", role: "COLLEGE_ADMIN", isActive: true, tokenVersion: 0 });
      const next = await invoke(authenticatePlatformAdmin, req);
      expect(next).toHaveBeenCalledWith();
      expect(req.admin).toMatchObject({ id: "a1", role: "COLLEGE_ADMIN" });
      expect(req.admin.permissions).toBeTruthy();
      expect(req.collegeId).toBe("c1");
    });

    it("cross-college token claims are rejected", async () => {
      const { authenticatePlatformAdmin } = require("../../middleware/auth");
      tokenReturns({ ...clocklessTokenPayload(), role: "ADMIN", collegeId: "c-other" });
      mocks.db.admin.findUnique.mockResolvedValue({ id: "a1", collegeId: "c1", role: "ADMIN", isActive: true, tokenVersion: 0, departmentId: "d1" });
      const next = await invoke(authenticatePlatformAdmin, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, message: "Invalid access token" });
    });
  });

  describe("authenticateAdmin / authenticateCollegeAdmin", () => {
    const admin = (role) => ({ id: "a1", collegeId: "c1", role, isActive: true, tokenVersion: 0, departmentId: "d1" });

    it("authenticateAdmin rejects a college admin", async () => {
      const { authenticateAdmin } = require("../../middleware/auth");
      tokenReturns({ ...clocklessTokenPayload(), role: "COLLEGE_ADMIN", departmentId: null });
      mocks.db.admin.findUnique.mockResolvedValue(admin("COLLEGE_ADMIN"));
      const next = await invoke(authenticateAdmin, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, message: "Admin role required" });
    });

    it("authenticateAdmin accepts a department admin", async () => {
      const { authenticateAdmin } = require("../../middleware/auth");
      const req = { headers: { authorization: "Bearer token" } };
      tokenReturns({ ...clocklessTokenPayload(), role: "ADMIN" });
      mocks.db.admin.findUnique.mockResolvedValue(admin("ADMIN"));
      const next = await invoke(authenticateAdmin, req);
      expect(next).toHaveBeenCalledWith();
      expect(req.admin.role).toBe("ADMIN");
    });

    it("authenticateCollegeAdmin rejects a department admin", async () => {
      const { authenticateCollegeAdmin } = require("../../middleware/auth");
      tokenReturns({ ...clocklessTokenPayload(), role: "ADMIN" });
      mocks.db.admin.findUnique.mockResolvedValue(admin("ADMIN"));
      const next = await invoke(authenticateCollegeAdmin, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, message: "College admin role required" });
    });

    it("authenticateCollegeAdmin accepts a college admin", async () => {
      const { authenticateCollegeAdmin } = require("../../middleware/auth");
      const req = { headers: { authorization: "Bearer token" } };
      tokenReturns({ ...clocklessTokenPayload(), role: "COLLEGE_ADMIN", departmentId: null });
      mocks.db.admin.findUnique.mockResolvedValue(admin("COLLEGE_ADMIN"));
      const next = await invoke(authenticateCollegeAdmin, req);
      expect(next).toHaveBeenCalledWith();
      expect(req.admin.role).toBe("COLLEGE_ADMIN");
    });
  });

  describe("authenticateSuperAdmin", () => {
    it("rejects non-super-admin roles", async () => {
      const { authenticateSuperAdmin } = require("../../middleware/auth");
      tokenReturns(clocklessTokenPayload());
      const next = await invoke(authenticateSuperAdmin, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, message: "Super admin role required" });
    });

    it("rejects an inactive super admin", async () => {
      const { authenticateSuperAdmin } = require("../../middleware/auth");
      mocks.verifyAccessToken.mockReturnValue({ ...clocklessTokenPayload(), role: "SUPER_ADMIN" });
      mocks.db.superAdmin.findUnique.mockResolvedValue({ id: "sa1", role: "SUPER_ADMIN", isActive: false, tokenVersion: 0 });
      const next = await invoke(authenticateSuperAdmin, { headers: { authorization: "Bearer token" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, message: "Invalid access token" });
    });

    it("authenticates a valid super admin", async () => {
      const { authenticateSuperAdmin } = require("../../middleware/auth");
      const req = { headers: { authorization: "Bearer token" } };
      tokenReturns({ ...clocklessTokenPayload(), role: "SUPER_ADMIN" });
      mocks.db.superAdmin.findUnique.mockResolvedValue({ id: "sa1", role: "SUPER_ADMIN", isActive: true, tokenVersion: 0 });
      const next = await invoke(authenticateSuperAdmin, req);
      expect(next).toHaveBeenCalledWith();
      expect(req.superAdmin.id).toBe("sa1");
    });
  });

  describe("requireSameCollege", () => {
    it("allows matching college ids", async () => {
      const { requireSameCollege } = require("../../middleware/auth");
      const next = await invoke(requireSameCollege(), { collegeId: "c1", body: { collegeId: "c1" } });
      expect(next).toHaveBeenCalledWith();
    });

    it("rejects cross-college body ids", async () => {
      const { requireSameCollege } = require("../../middleware/auth");
      const next = await invoke(requireSameCollege(), { collegeId: "c1", body: { collegeId: "c2" } });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, message: "Cross-college access denied" });
    });
  });
});