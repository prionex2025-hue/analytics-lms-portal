const { run: runVerifySuperAdmin } = require("../../../scripts/verify-superadmin");

describe("super-admin CLI scripts", () => {
  it("verifies SuperAdmin counts through the verification script", async () => {
    const db = {
      superAdmin: {
        count: jest
          .fn()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(1),
      },
    };

    const result = await runVerifySuperAdmin({ db });

    expect(result).toEqual({
      totalSuperAdmins: 3,
      activeSuperAdmins: 2,
      inactiveSuperAdmins: 1,
      maxSuperAdmins: 5,
      valid: true,
      violations: [],
    });
  });
});
