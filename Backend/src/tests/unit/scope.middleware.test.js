const { enforceCollegeScope, enforceDepartmentScope } = require("../../middleware/scope");

const invokeMiddleware = async (middleware, req) =>
  new Promise((resolve, reject) => {
    middleware(req, {}, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(req);
    });
  });

describe("scope middleware", () => {
  it("blocks cross-college access for college admins", async () => {
    const middleware = enforceCollegeScope();
    const req = {
      admin: {
        id: "admin-1",
        role: "COLLEGE_ADMIN",
        collegeId: "college-a",
      },
      body: {
        collegeId: "college-b",
      },
      params: {},
      query: {},
    };

    await expect(invokeMiddleware(middleware, req)).rejects.toMatchObject({
      statusCode: 403,
      code: "CROSS_COLLEGE_ACCESS_DENIED",
    });
  });

  it("allows college admin requests across departments in same college", async () => {
    const middleware = enforceDepartmentScope();
    const req = {
      admin: {
        id: "admin-1",
        role: "COLLEGE_ADMIN",
        collegeId: "college-a",
      },
      body: {
        departmentId: "dept-b",
      },
      params: {},
      query: {},
    };

    await expect(invokeMiddleware(middleware, req)).resolves.toBe(req);
  });

  it("blocks cross-department access for department admins", async () => {
    const middleware = enforceDepartmentScope();
    const req = {
      admin: {
        id: "admin-2",
        role: "ADMIN",
        collegeId: "college-a",
        departmentId: "dept-a",
      },
      body: {
        departmentId: "dept-b",
      },
      params: {},
      query: {},
    };

    await expect(invokeMiddleware(middleware, req)).rejects.toMatchObject({
      statusCode: 403,
      code: "CROSS_DEPARTMENT_ACCESS_DENIED",
    });
  });
});
