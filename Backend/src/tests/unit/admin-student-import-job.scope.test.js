describe("admin student import job scoping", () => {
  let db;

  beforeEach(() => {
    jest.resetModules();
    db = {
      reportJob: {
        findFirst: jest.fn(),
      },
    };
    jest.doMock("../../models", () => ({
      init: jest.fn(async () => ({ dbClient: db })),
    }));
    jest.doMock("../../config/redis", () => ({
      redisClient: null,
      getRedisQueueConnection: jest.fn(() => null),
    }));
    jest.doMock("../../services/audit.service", () => ({
      createAuditLog: jest.fn(),
    }));
    jest.doMock("../../services/auth-revocation.service", () => ({
      invalidatePrincipalAuthCache: jest.fn(),
    }));
  });

  it("lets a college admin read any college import job", async () => {
    db.reportJob.findFirst.mockResolvedValue({
      id: "job-1",
      collegeId: "college-1",
      adminId: "admin-2",
      status: "COMPLETED",
      filters: { result: { created: 3, failed: 0, duplicates: 0, errors: [] } },
    });

    const { getStudentImportJob } = require("../../services/admin-student.service");
    const result = await getStudentImportJob("college-1", "job-1");

    expect(result.status).toBe("completed");
    expect(result.result.created).toBe(3);
  });

  it("lets a department admin read their own import job", async () => {
    db.reportJob.findFirst.mockResolvedValue({
      id: "job-1",
      collegeId: "college-1",
      adminId: "admin-1",
      status: "COMPLETED",
      filters: { result: { created: 5, failed: 0, duplicates: 0, errors: [] } },
    });

    const { getStudentImportJob } = require("../../services/admin-student.service");
    const result = await getStudentImportJob("college-1", "job-1", {
      adminId: "admin-1",
      departmentId: "dept-1",
    });

    expect(result.jobId).toBe("job-1");
  });

  it("denies a department admin reading another admin's import job", async () => {
    db.reportJob.findFirst.mockResolvedValue({
      id: "job-1",
      collegeId: "college-1",
      adminId: "admin-2",
      status: "COMPLETED",
      filters: { result: { created: 9, failed: 0, duplicates: 0, errors: [] } },
    });

    const { getStudentImportJob } = require("../../services/admin-student.service");
    await expect(
      getStudentImportJob("college-1", "job-1", { adminId: "admin-1", departmentId: "dept-1" })
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});