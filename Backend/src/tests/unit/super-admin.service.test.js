jest.mock("../../services/refresh-token-session.service", () => ({
  revokeAllRefreshTokensForOwner: jest.fn(async () => ({ count: 1 })),
}));

jest.mock("../../services/auth-revocation.service", () => ({
  bumpPrincipalTokenVersion: jest.fn(async () => 1),
}));

const {
  MAX_SUPER_ADMINS,
  createSuperAdmin,
  resetSuperAdminPassword,
  setSuperAdminActive,
  validatePasswordPolicy,
  verifySuperAdminState,
} = require("../../services/super-admin.service");

const createDb = ({ count = 0, existing = null, target = null } = {}) => {
  const superAdmins = [];
  const createdAuditLogs = [];
  const targetSuperAdmin = target || {
    id: "super-1",
    fullName: "Owner",
    email: "owner@example.com",
    role: "SUPER_ADMIN",
    isActive: true,
    tokenVersion: 0,
  };

  return {
    superAdmins,
    createdAuditLogs,
    superAdmin: {
      count: jest.fn(async ({ where } = {}) => {
        if (where?.isActive === true) return 1;
        if (where?.isActive === false) return 0;
        return count;
      }),
      findFirst: jest.fn(async () => existing),
      findUnique: jest.fn(async () => targetSuperAdmin),
      create: jest.fn(async ({ data }) => {
        const record = { id: `super-${superAdmins.length + 1}`, createdAt: new Date(), ...data };
        superAdmins.push(record);
        return record;
      }),
      update: jest.fn(async ({ data }) => ({ ...targetSuperAdmin, ...data })),
    },
    auditLog: {
      create: jest.fn(async ({ data }) => {
        createdAuditLogs.push(data);
        return { id: `audit-${createdAuditLogs.length}`, ...data };
      }),
    },
    superAdminRefreshToken: {
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };
};

describe("super-admin service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a bootstrap SuperAdmin with a hashed password", async () => {
    const db = createDb({ count: 0 });

    const superAdmin = await createSuperAdmin({
      db,
      name: "Prionex Owner",
      email: "Owner@Prionex.com",
      password: "StrongPassword123!",
      bootstrapCreated: true,
    });

    expect(superAdmin.email).toBe("owner@prionex.com");
    expect(superAdmin.role).toBe("SUPER_ADMIN");
    expect(superAdmin.bootstrapCreated).toBe(true);
    expect(superAdmin.passwordHash).toEqual(expect.any(String));
    expect(superAdmin.passwordHash).not.toBe("StrongPassword123!");
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "BOOTSTRAP_CREATE_SUPER_ADMIN" }),
    }));
  });

  it("rejects duplicate SuperAdmin emails", async () => {
    const db = createDb({
      count: 1,
      existing: { id: "super-existing", email: "owner@prionex.com", role: "SUPER_ADMIN" },
    });

    await expect(createSuperAdmin({
      db,
      name: "Owner",
      email: "owner@prionex.com",
      password: "StrongPassword123!",
    })).rejects.toMatchObject({ code: "DUPLICATE_SUPER_ADMIN_EMAIL" });
  });

  it("validates the password policy before creation", async () => {
    const result = validatePasswordPolicy("weakpass");

    expect(result.valid).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(["one uppercase letter", "one number", "one special character"]));
  });

  it("rejects creation when the SuperAdmin limit is reached", async () => {
    const db = createDb({ count: MAX_SUPER_ADMINS });

    await expect(createSuperAdmin({
      db,
      name: "Owner",
      email: "owner@example.com",
      password: "StrongPassword123!",
    })).rejects.toMatchObject({ code: "SUPER_ADMIN_LIMIT_REACHED" });
    expect(db.superAdmin.create).not.toHaveBeenCalled();
  });

  it("resets a SuperAdmin password and revokes sessions", async () => {
    const db = createDb();

    await resetSuperAdminPassword({
      db,
      superAdminId: "super-1",
      password: "NewStrongPassword123!",
      actorSuperAdminId: "actor-1",
    });

    expect(db.superAdmin.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "super-1" },
      data: expect.objectContaining({ passwordHash: expect.any(String) }),
    }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "SUPER_ADMIN_RESET_SUPER_ADMIN_PASSWORD" }),
    }));
  });

  it("prevents deactivating the last active SuperAdmin", async () => {
    const db = createDb();

    await expect(setSuperAdminActive({
      db,
      superAdminId: "super-1",
      isActive: false,
      actorSuperAdminId: "actor-1",
    })).rejects.toMatchObject({ code: "LAST_ACTIVE_SUPER_ADMIN" });
  });

  it("verifies SuperAdmin account invariants", async () => {
    const db = {
      superAdmin: {
        count: jest
          .fn()
          .mockResolvedValueOnce(6)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(6),
      },
    };

    const result = await verifySuperAdminState({ db });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining(["SUPER_ADMIN_LIMIT_REACHED", "NO_ACTIVE_SUPER_ADMIN"]));
  });
});
