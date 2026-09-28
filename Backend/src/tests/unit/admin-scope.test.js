const { ApiError } = require("../../utils/http");
const {
  getRequestAdminRole,
  isCollegeAdminRequest,
  isDepartmentAdminRequest,
  getScopedDepartmentId,
  assertDepartmentScope,
} = require("../../utils/admin-scope");
const { ROLES } = require("../../constants/roles");

describe("admin-scope guard", () => {
  describe("role resolution", () => {
    it("normalizes the admin role and defaults department admins to ADMIN", () => {
      expect(getRequestAdminRole({ admin: { role: "COLLEGE_ADMIN" } })).toBe(ROLES.COLLEGE_ADMIN);
      expect(getRequestAdminRole({ admin: { role: "ADMIN" } })).toBe(ROLES.ADMIN);
      expect(getRequestAdminRole({ admin: { role: "dept_admin" } })).toBe(ROLES.ADMIN);
      expect(getRequestAdminRole({ admin: {} })).toBe(ROLES.ADMIN);
      expect(getRequestAdminRole({})).toBe(ROLES.ADMIN);
    });

    it("classifies college and department admin requests", () => {
      expect(isCollegeAdminRequest({ admin: { role: "COLLEGE_ADMIN" } })).toBe(true);
      expect(isCollegeAdminRequest({ admin: { role: "ADMIN" } })).toBe(false);
      expect(isDepartmentAdminRequest({ admin: { role: "ADMIN" } })).toBe(true);
      expect(isDepartmentAdminRequest({ admin: { role: "COLLEGE_ADMIN" } })).toBe(false);
    });
  });

  describe("getScopedDepartmentId", () => {
    it("returns null for college admins", () => {
      expect(getScopedDepartmentId({ admin: { role: "COLLEGE_ADMIN", departmentId: "dept-1" } })).toBeNull();
    });

    it("returns the department id for a department admin", () => {
      expect(getScopedDepartmentId({ admin: { role: "ADMIN", departmentId: "dept-1" } })).toBe("dept-1");
    });

    it("fails closed when a department admin has no department and it is required", () => {
      expect(() =>
        getScopedDepartmentId({ admin: { role: "ADMIN" } })
      ).toThrowError(expect.objectContaining({ statusCode: 403, code: "ADMIN_DEPARTMENT_REQUIRED" }));
    });

    it("allows a missing department when not required for department admins", () => {
      expect(
        getScopedDepartmentId({ admin: { role: "ADMIN" } }, { requiredForDepartmentAdmin: false })
      ).toBeNull();
    });
  });

  describe("assertDepartmentScope", () => {
    it("allows empty candidates through", () => {
      expect(() => assertDepartmentScope({ admin: { role: "ADMIN", departmentId: "dept-1" } }, null)).not.toThrow();
      expect(() => assertDepartmentScope({ admin: { role: "ADMIN", departmentId: "dept-1" } }, "")).not.toThrow();
    });

    it("allows college admins across any department", () => {
      expect(() =>
        assertDepartmentScope({ admin: { role: "COLLEGE_ADMIN" } }, "dept-any")
      ).not.toThrow();
    });

    it("allows matching departments", () => {
      expect(() =>
        assertDepartmentScope({ admin: { role: "ADMIN", departmentId: "dept-1" } }, "dept-1")
      ).not.toThrow();
    });

    it("rejects mismatched departments with the default message", () => {
      expect(() =>
        assertDepartmentScope({ admin: { role: "ADMIN", departmentId: "dept-1" } }, "dept-2")
      ).toThrowError(new ApiError(403, "Cross-department access denied", null, "CROSS_DEPARTMENT_ACCESS_DENIED"));
    });

    it("rejects mismatched departments with a custom message", () => {
      let error;
      try {
        assertDepartmentScope(
          { admin: { role: "ADMIN", departmentId: "dept-1" } },
          "dept-2",
          "Student is outside the admin department scope"
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toBe("Student is outside the admin department scope");
      expect(error.code).toBe("CROSS_DEPARTMENT_ACCESS_DENIED");
    });
  });
});