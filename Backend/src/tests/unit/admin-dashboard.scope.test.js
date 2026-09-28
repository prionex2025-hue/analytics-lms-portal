const createDashboardDb = () => {
  const db = {
    student: { count: jest.fn(async () => 10) },
    test: {
      count: jest.fn(async () => 5),
      findMany: jest.fn(async () => []),
    },
    submission: { findMany: jest.fn(async () => []) },
    auditLog: { findMany: jest.fn(async () => []) },
  };
  return db;
};

const loadDashboardWith = ({ scopedDepartmentId, scopedTestIds }) => {
  jest.resetModules();
  const db = createDashboardDb();

  jest.doMock("../../models", () => ({
    init: jest.fn(async () => ({ dbClient: db })),
  }));
  jest.doMock("../../utils/admin-scope", () => ({
    getScopedDepartmentId: jest.fn(() => scopedDepartmentId),
  }));
  jest.doMock("../../services/admin-department-report.service", () => ({
    buildTestScope: jest.fn(async () => (scopedTestIds || []).map((id) => ({ id }))),
  }));
  jest.doMock("../../services/report-scope.service", () => ({
    REPORTABLE_SUBMISSION_STATUSES: ["SUBMITTED"],
  }));

  const { getAdminDashboard } = require("../../controllers/Admin/dashboard.controller");
  return { db, getAdminDashboard };
};

const invoke = async (getAdminDashboard, req) => {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  };
  const next = jest.fn();
  getAdminDashboard(req, res, next);
  for (let attempt = 0; attempt < 20 && !res.json.mock.calls.length && !next.mock.calls.length; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(next).not.toHaveBeenCalled();
  return res;
};

describe("admin dashboard department scoping", () => {
  it("scopes counts, submissions and tests to the department for a department admin", async () => {
    const { db, getAdminDashboard } = loadDashboardWith({
      scopedDepartmentId: "dept-1",
      scopedTestIds: ["test-1", "test-2"],
    });

    const res = await invoke(getAdminDashboard, {
      collegeId: "college-1",
      admin: { id: "admin-1", role: "ADMIN" },
    });

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      cards: {
        totalStudents: 10,
        totalTestsCreated: 5,
        activeTests: 5,
        upcomingTests: 5,
      },
    }));

    expect(db.student.count).toHaveBeenCalledWith({
      where: { collegeId: "college-1", isActive: true, departmentId: "dept-1" },
    });

    expect(db.submission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ user: { departmentId: "dept-1" } }),
    }));

    expect(db.test.count).toHaveBeenCalledWith({
      where: { collegeId: "college-1", id: { in: ["test-1", "test-2"] } },
    });
  });

  it("keeps college-wide aggregates for a college admin and skips test scoping", async () => {
    const { db, getAdminDashboard } = loadDashboardWith({
      scopedDepartmentId: null,
      scopedTestIds: null,
    });
    const adminDepartmentReport = require("../../services/admin-department-report.service");

    const res = await invoke(getAdminDashboard, {
      collegeId: "college-1",
      admin: { id: "admin-1", role: "COLLEGE_ADMIN" },
    });

    expect(res.json).toHaveBeenCalled();

    expect(db.student.count).toHaveBeenCalledWith({
      where: { collegeId: "college-1", isActive: true },
    });

    expect(db.test.count).toHaveBeenCalledWith({
      where: { collegeId: "college-1" },
    });

    expect(adminDepartmentReport.buildTestScope).not.toHaveBeenCalled();
  });
});