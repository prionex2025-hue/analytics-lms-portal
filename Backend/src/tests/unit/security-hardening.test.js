describe("client IP resolution", () => {
  it("ignores a client-supplied X-Forwarded-For and uses req.ip", () => {
    const { getClientIp } = require("../../utils/client-ip");
    const { authKeyByIp } = require("../../middleware/rate-limit");

    const req = {
      headers: { "x-forwarded-for": "203.0.113.99, 198.51.100.7" },
      ip: "198.51.100.7",
    };

    expect(getClientIp(req)).toBe("198.51.100.7");
    expect(authKeyByIp(req)).toBe("ip:198.51.100.7");
  });
});

describe("login lockout", () => {
  const loadService = () => {
    jest.resetModules();
    jest.doMock("../../config/redis", () => ({
      redisClient: {},
      isRedisAvailable: () => false,
    }));
    return require("../../services/login-attempt.service");
  };

  it("locks the attacking IP without locking the account owner out", async () => {
    const { assertLoginAllowed, recordLoginFailure } = loadService();
    const identifier = "21CS0457";

    for (let i = 0; i < 5; i += 1) {
      await recordLoginFailure({ scope: "student", identifier, ip: "203.0.113.1" });
    }

    await expect(assertLoginAllowed({ scope: "student", identifier, ip: "203.0.113.1" }))
      .rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
    await expect(assertLoginAllowed({ scope: "student", identifier, ip: "198.51.100.2" }))
      .resolves.toBeUndefined();
  });

  it("still locks an account under a guessing attack spread across many IPs", async () => {
    const { assertLoginAllowed, recordLoginFailure } = loadService();
    const identifier = "21CS0458";

    for (let i = 0; i < 25; i += 1) {
      await recordLoginFailure({ scope: "student", identifier, ip: `203.0.113.${i}` });
    }

    await expect(assertLoginAllowed({ scope: "student", identifier, ip: "198.51.100.2" }))
      .rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });
});

describe("student profile validation", () => {
  const {
    changePasswordSchema,
    updatePreferencesSchema,
    updateProfileSchema,
  } = require("../../schemas/Students/profile.schema");

  it("rejects a new password shorter than 8 characters", () => {
    expect(() => changePasswordSchema.parse({
      body: { current_password: "OldPass@1", new_password: "short" },
    })).toThrow();
    expect(changePasswordSchema.parse({
      body: { current_password: "OldPass@1", new_password: "long-enough-1" },
    }).body.new_password).toBe("long-enough-1");
  });

  it("rejects nested or oversized preference payloads", () => {
    expect(() => updatePreferencesSchema.parse({ body: { preferences: { theme: { nested: true } } } })).toThrow();
    const tooMany = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, true]));
    expect(() => updatePreferencesSchema.parse({ body: { preferences: tooMany } })).toThrow();
    expect(updatePreferencesSchema.parse({ body: { preferences: { theme: "dark" } } }).body.preferences)
      .toEqual({ theme: "dark" });
  });

  it("rejects non-string profile fields", () => {
    expect(() => updateProfileSchema.parse({ body: { fullName: { $gt: "" } } })).toThrow();
  });
});

describe("question bank department ownership", () => {
  const { assertCanModifySharedQuestionEntry, getOwningDepartmentId } = require("../../utils/question-bank-access");
  const db = {
    admin: {
      findUnique: jest.fn(async ({ where }) => ({
        "dept-a-admin-2": { departmentId: "dept-a" },
        "dept-b-admin": { departmentId: "dept-b" },
        "college-admin": { departmentId: null },
      }[where.id] || null)),
    },
  };
  const deptAdmin = { admin: { id: "dept-a-admin", role: "ADMIN", departmentId: "dept-a" } };
  const collegeAdmin = { admin: { id: "college-admin", role: "COLLEGE_ADMIN", departmentId: null } };

  it("lets a department admin change entries owned by their department", async () => {
    await expect(assertCanModifySharedQuestionEntry(db, deptAdmin, { createdByAdminId: "dept-a-admin" })).resolves.toBeUndefined();
    await expect(assertCanModifySharedQuestionEntry(db, deptAdmin, { createdByAdminId: "dept-a-admin-2" })).resolves.toBeUndefined();
    await expect(assertCanModifySharedQuestionEntry(db, deptAdmin, { departmentId: "dept-a" })).resolves.toBeUndefined();
  });

  it("blocks a department admin from other departments' and college-wide entries", async () => {
    await expect(assertCanModifySharedQuestionEntry(db, deptAdmin, { createdByAdminId: "dept-b-admin" }))
      .rejects.toMatchObject({ statusCode: 403, code: "CROSS_DEPARTMENT_ACCESS_DENIED" });
    await expect(assertCanModifySharedQuestionEntry(db, deptAdmin, { createdByAdminId: "college-admin" }))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(assertCanModifySharedQuestionEntry(db, deptAdmin, {}))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("lets college admins change any entry and stamps no department for them", async () => {
    await expect(assertCanModifySharedQuestionEntry(db, collegeAdmin, { createdByAdminId: "dept-b-admin" })).resolves.toBeUndefined();
    expect(getOwningDepartmentId(collegeAdmin)).toBeNull();
    expect(getOwningDepartmentId(deptAdmin)).toBe("dept-a");
  });
});
