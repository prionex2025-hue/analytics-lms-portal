const HOUR = 60 * 60 * 1000;
const past = (h = 1) => new Date(Date.now() - h * HOUR);
const future = (h = 1) => new Date(Date.now() + h * HOUR);

const loadController = ({ tests, students, submissions }) => {
  jest.resetModules();

  const db = {
    test: { findMany: jest.fn().mockResolvedValue(tests) },
    student: { findMany: jest.fn().mockResolvedValue(students) },
    submission: { findMany: jest.fn().mockResolvedValue(submissions) },
  };

  jest.doMock("../../models", () => ({
    init: jest.fn().mockResolvedValue({ dbClient: db }),
  }));

  // Mock heavy report side-modules the controller imports at load time but that
  // this read-only handler does not use (puppeteer/bullmq pull ESM/native deps).
  jest.doMock("../../services/report-pdf.service", () => ({ renderHtmlToPdfBuffer: jest.fn() }));
  jest.doMock("../../services/admin-report-queue.service", () => ({ enqueueReportJob: jest.fn() }));
  jest.doMock("../../services/report-formatter.service", () => ({ generateAdminReportHTML: jest.fn() }));
  jest.doMock("../../services/report-payload-store.service", () => ({ readReportPayload: jest.fn() }));

  jest.doMock("../../utils/admin-test-access", () => ({
    buildAdminTestVisibilityWhere: jest.fn(() => ({})),
    resolveAdminTestScope: jest.fn().mockResolvedValue({
      collegeId: "college-1",
      departmentId: null,
      batchId: null,
      batchIds: [],
    }),
  }));

  const controller = require("../../controllers/Admin/reports.controller");
  return { ...controller, db };
};

const invoke = (handler, reqOverrides = {}) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload });
        return this;
      },
    };

    handler(
      {
        query: {},
        collegeId: "college-1",
        admin: { id: "admin-1", role: "ADMIN", departmentId: null, permissions: ["view_reports"] },
        ...reqOverrides,
      },
      res,
      reject
    );
  });

const baseTests = [
  { id: "t1", title: "Alpha", status: "LIVE", startsAt: past(2), endsAt: future(2), totalMarks: 100, department: { name: "CSE" }, batch: { name: "B1" }, questions: [] },
  { id: "t2", title: "Beta", status: "PUBLISHED", startsAt: past(4), endsAt: past(1), totalMarks: 50, department: { name: "ECE" }, batch: { name: "B2" }, questions: [] },
];
const baseStudents = [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }];
const baseSubmissions = [
  { testId: "t1", userId: "s1", score: 80, accuracy: 80, _count: { violations: 0 } },
  { testId: "t1", userId: "s2", score: 30, accuracy: 30, _count: { violations: 0 } },
  { testId: "t2", userId: "s3", score: 45, accuracy: 90, _count: { violations: 2 } },
];

describe("getReportTestsDashboard", () => {
  it("aggregates per-test stats (avg, pass rate, participation, violations)", async () => {
    const { getReportTestsDashboard } = loadController({
      tests: baseTests,
      students: baseStudents,
      submissions: baseSubmissions,
    });

    const { statusCode, payload } = await invoke(getReportTestsDashboard);
    expect(statusCode).toBe(200);
    expect(payload.pagination.total).toBe(2);

    const t1 = payload.data.find((row) => row.testId === "t1");
    const t2 = payload.data.find((row) => row.testId === "t2");

    // t1: scores 80% + 30% -> avg 55, one of two passes (>=40) -> 50%, 2 of 4 students -> 50%
    expect(t1.avgScore).toBe(55);
    expect(t1.passRate).toBe(50);
    expect(t1.participation).toBe(50);
    expect(t1.submissionCount).toBe(2);
    expect(t1.attemptedStudents).toBe(2);
    expect(t1.violations).toBe(0);

    // t2: 45/50 -> 90%, passes, 1 of 4 students -> 25%, 2 violations, window closed -> COMPLETED
    expect(t2.avgScore).toBe(90);
    expect(t2.passRate).toBe(100);
    expect(t2.participation).toBe(25);
    expect(t2.violations).toBe(2);
    expect(t2.status).toBe("COMPLETED");
  });

  it("paginates results", async () => {
    const { getReportTestsDashboard } = loadController({
      tests: baseTests,
      students: baseStudents,
      submissions: baseSubmissions,
    });

    const { payload } = await invoke(getReportTestsDashboard, { query: { limit: "1", page: "1" } });
    expect(payload.data).toHaveLength(1);
    expect(payload.pagination.total).toBe(2);
    expect(payload.pagination.totalPages).toBe(2);
    expect(payload.pagination.limit).toBe(1);
  });

  it("returns an empty page when no tests are in scope", async () => {
    const { getReportTestsDashboard } = loadController({
      tests: [],
      students: baseStudents,
      submissions: [],
    });

    const { payload } = await invoke(getReportTestsDashboard);
    expect(payload.data).toEqual([]);
    expect(payload.pagination.total).toBe(0);
  });
});
