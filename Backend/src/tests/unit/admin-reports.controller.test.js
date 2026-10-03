const models = require("../../models");

jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../services/report-pdf.service", () => ({
  renderHtmlToPdfBuffer: jest.fn(),
}));

const { getReportAnalytics } = require("../../controllers/Admin/reports.controller");

const invoke = async (handler, req) => {
  let resolveResponse;
  let rejectResponse;
  const responsePromise = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      resolveResponse({ statusCode: this.statusCode, payload });
      return this;
    },
  };

  handler(req, res, (error) => {
    if (error) {
      rejectResponse(error);
    }
  });

  return responsePromise;
};

describe("admin reports controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads department analytics without a year filter", async () => {
    const db = {
      test: {
        findMany: jest.fn(async () => [{ id: "test-1", title: "Aptitude", totalMarks: 10 }]),
      },
      student: {
        findMany: jest.fn(async () => []),
      },
      submission: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      department: {
        findMany: jest.fn(async () => []),
      },
      batch: {
        findMany: jest.fn(async () => []),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(getReportAnalytics, {
      query: {
        mode: "department",
        studentScope: "current",
      },
      collegeId: "college-1",
      admin: {
        id: "admin-1",
        role: "ADMIN",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload.mode).toBe("department");
    expect(db.student.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ year: expect.anything() }),
    }));
  });

  it("uses assigned students, not all department students, for selected test participation", async () => {
    const selectedTest = {
      id: "test-1",
      title: "Assigned Batch Test",
      totalMarks: 10,
      years: [2],
      assignmentMethod: "batch_wise",
      departmentId: "dept-1",
      batchId: "batch-1",
      assignedTo: [],
      batchAssignments: [{ batchId: "batch-1" }],
    };
    const students = [
      {
        id: "student-1",
        fullName: "Attended Student",
        studentId: "S1",
        year: 2,
        departmentId: "dept-1",
        batchId: "batch-1",
        batchIds: ["batch-1"],
        department: { name: "CSE" },
        batch: { name: "B1" },
      },
      {
        id: "student-2",
        fullName: "Assigned Absent Student",
        studentId: "S2",
        year: 2,
        departmentId: "dept-1",
        batchId: "batch-1",
        batchIds: ["batch-1"],
        department: { name: "CSE" },
        batch: { name: "B1" },
      },
      {
        id: "student-3",
        fullName: "Other Batch Student",
        studentId: "S3",
        year: 2,
        departmentId: "dept-1",
        batchId: "batch-2",
        batchIds: ["batch-2"],
        department: { name: "CSE" },
        batch: { name: "B2" },
      },
      {
        id: "student-4",
        fullName: "Wrong Year Assigned Batch Student",
        studentId: "S4",
        year: 3,
        departmentId: "dept-1",
        batchId: "batch-1",
        batchIds: ["batch-1"],
        department: { name: "CSE" },
        batch: { name: "B1" },
      },
    ];
    const db = {
      test: {
        findMany: jest.fn(async () => [selectedTest]),
      },
      student: {
        findMany: jest.fn(async () => students),
      },
      submission: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [
          {
            id: "submission-1",
            testId: "test-1",
            userId: "student-1",
            collegeId: "college-1",
            status: "SUBMITTED",
            score: 8,
            submittedAt: new Date("2026-01-01T00:00:00.000Z"),
            user: {
              id: "student-1",
              fullName: "Attended Student",
              studentId: "S1",
              year: 2,
              departmentId: "dept-1",
              batchId: "batch-1",
              batchIds: ["batch-1"],
            },
            test: { id: "test-1", title: "Assigned Batch Test", totalMarks: 10, subject: "Aptitude" },
            violations: [],
            answers: [],
          },
        ]),
      },
      department: {
        findMany: jest.fn(async () => [{ id: "dept-1", name: "CSE" }]),
      },
      batch: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: "batch-1" }])
          .mockResolvedValueOnce([{ id: "batch-1", name: "B1" }, { id: "batch-2", name: "B2" }]),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(getReportAnalytics, {
      query: {
        mode: "department",
        testId: "test-1",
        studentScope: "current",
      },
      collegeId: "college-1",
      admin: {
        id: "admin-1",
        role: "ADMIN",
        departmentId: "dept-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload.metrics.participationRate).toBe(50);
    expect(response.payload.notAttended.count).toBe(1);
    expect(response.payload.tableRows).toHaveLength(1);
    expect(response.payload.departmentComparative[0].participationRate).toBe(50);
    expect(response.payload.batchComparative.find((row) => row.batchId === "batch-1").participationRate).toBe(50);
    // Only student-1 and student-2 are assigned to this test, so batch-2 has no
    // in-scope students at all. Its participation denominator is empty, which is
    // "not measurable" rather than "0% participated" - the latter would accuse a
    // batch of disengagement that never happened. A batch with assigned students
    // who all skipped still reports a real 0%; see the comparatives test below.
    expect(response.payload.batchComparative.find((row) => row.batchId === "batch-2").participationRate).toBeNull();
    expect(db.submission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: { in: ["student-1", "student-2"] },
      }),
    }));
  });
});

describe("Admin report comparatives: no-attempt vs measured zero", () => {
  const buildRequest = () => {
    const selectedTest = { id: "test-1", title: "T", totalMarks: 10, subject: "Aptitude" };
    // Two students registered in dept-1/batch-1: one attempted and scored a real
    // 0, the other never attempted. Both share a department, which is exactly
    // where "no attempt" and "scored zero" must not be conflated.
    const students = [
      {
        id: "student-1",
        fullName: "Scored Zero",
        studentId: "S1",
        year: 2,
        departmentId: "dept-1",
        batchId: "batch-1",
        batchIds: ["batch-1"],
        department: { name: "CSE" },
        batch: { name: "B1" },
      },
      {
        id: "student-2",
        fullName: "Never Attempted",
        studentId: "S2",
        year: 2,
        departmentId: "dept-2",
        batchId: "batch-2",
        batchIds: ["batch-2"],
        department: { name: "ECE" },
        batch: { name: "B2" },
      },
    ];
    const db = {
      test: { findMany: jest.fn(async () => [selectedTest]) },
      student: { findMany: jest.fn(async () => students) },
      submission: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [
          {
            id: "submission-1",
            testId: "test-1",
            userId: "student-1",
            collegeId: "college-1",
            status: "SUBMITTED",
            score: 0,
            submittedAt: new Date("2026-01-01T00:00:00.000Z"),
            user: {
              id: "student-1",
              fullName: "Scored Zero",
              studentId: "S1",
              year: 2,
              departmentId: "dept-1",
              batchId: "batch-1",
              batchIds: ["batch-1"],
            },
            test: { id: "test-1", title: "T", totalMarks: 10, subject: "Aptitude" },
            violations: [],
            answers: [],
          },
        ]),
      },
      department: {
        findMany: jest.fn(async () => [
          { id: "dept-1", name: "CSE" },
          { id: "dept-2", name: "ECE" },
        ]),
      },
      batch: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: "batch-1" }, { id: "batch-2" }])
          .mockResolvedValueOnce([{ id: "batch-1", name: "B1" }, { id: "batch-2", name: "B2" }]),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });
    return {
      query: { mode: "department", testId: "test-1", studentScope: "current" },
      collegeId: "college-1",
      admin: { id: "admin-1", role: "ADMIN", departmentId: "dept-1" },
    };
  };

  it("keeps no-attempt score metrics null while a measured zero stays 0", async () => {
    const response = await invoke(getReportAnalytics, buildRequest());

    expect(response.statusCode).toBe(200);

    // ECE/B2: one registered student who never attempted -> nothing was
    // measured, so a 0% average would falsely report that they scored zero.
    const ece = response.payload.departmentComparative.find((row) => row.departmentName === "ECE");
    expect(ece).toMatchObject({ avgScore: null, passRate: null, participationRate: 0 });

    const b2 = response.payload.batchComparative.find((row) => row.batchId === "batch-2");
    expect(b2).toMatchObject({ avgScore: null, passRate: null, participationRate: 0 });

    // CSE/B1: the student did sit the test and scored a real 0. That is a
    // measured result and must never be reported as "no data".
    const cse = response.payload.departmentComparative.find((row) => row.departmentName === "CSE");
    expect(cse.avgScore).toBe(0);
    expect(cse.passRate).toBe(0);
    const b1 = response.payload.batchComparative.find((row) => row.batchId === "batch-1");
    expect(b1.avgScore).toBe(0);
    expect(b1.passRate).toBe(0);
  });
});
