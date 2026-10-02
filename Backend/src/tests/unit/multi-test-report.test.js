const models = require("../../models");
const { collectSubmissions } = require("../../services/submission-batch.service");
const { resolveAdminTestScope } = require("../../utils/admin-test-access");

jest.mock("../../models", () => ({ init: jest.fn() }));
jest.mock("../../services/report-pdf.service", () => ({ renderHtmlToPdfBuffer: jest.fn() }));
jest.mock("../../services/admin-report-queue.service", () => ({ enqueueReportJob: jest.fn() }));
jest.mock("../../services/super-admin-report-queue.service", () => ({ enqueueSuperReportJob: jest.fn() }));
jest.mock("../../services/audit.service", () => ({ createAuditLog: jest.fn(async () => ({})) }));
jest.mock("../../realtime/socket", () => ({ emitToRole: jest.fn(), emitToCollege: jest.fn() }));
jest.mock("../../services/submission-batch.service", () => ({
  collectSubmissions: jest.fn(async () => ({ rows: [], truncated: false })),
}));
jest.mock("../../utils/admin-test-access", () => {
  const actual = jest.requireActual("../../utils/admin-test-access");
  return { ...actual, resolveAdminTestScope: jest.fn() };
});
// Raw-driver lookups need a live mongoose connection; unit tests stub them.
jest.mock("../../services/report-lookup.service", () => ({
  attachStudentGroups: jest.fn(async (_db, students) => students),
  countViolationsBySubmission: jest.fn(async () => new Map()),
  loadNamesById: jest.fn(async () => new Map()),
  sumQuestionMarksByTest: jest.fn(async () => new Map()),
  uniqueIds: (values) => [...new Set((values || []).filter(Boolean).map(String))],
}));

const { buildInstitutionReportPayload } = require("../../services/admin-department-report.service");
const { generateAdminReportHTML } = require("../../services/report-formatter.service");
const { buildTestResultRows, parseExportTestIds } = require("../../services/report-export-datasets.service");
const { generateReportSchema } = require("../../schemas/Admin/admin-core.schema");
const { generateReport } = require("../../controllers/Admin/reports.controller");
const { generateSuperReport } = require("../../controllers/SuperAdmin/reports.controller");
const { exportSuperReportCsv } = require("../../controllers/SuperAdmin/advanced-reports.controller");

const COLLEGE_ID = "64b000000000000000000001";

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload, headers });
        return this;
      },
      send(body) {
        resolve({ statusCode: this.statusCode, body, headers });
        return this;
      },
    };
    handler(req, res, (error) => {
      if (error) reject(error);
    });
  });

// Two tests, each assigned to one department; student s4 is in neither.
const TESTS = [
  { id: "t2", title: "Aptitude B", subject: "Reasoning", totalMarks: 100, startsAt: "2026-06-01T09:00:00Z", assignmentMethod: "department_wise", departmentId: "d2", assignedTo: [], batchAssignments: [] },
  { id: "t1", title: "Aptitude A", subject: "Quant", totalMarks: 100, startsAt: "2026-05-01T09:00:00Z", assignmentMethod: "department_wise", departmentId: "d1", assignedTo: [], batchAssignments: [] },
];
const STUDENTS = [
  { id: "s1", fullName: "Asha", enrollNumber: "R1", departmentId: "d1", year: 3 },
  { id: "s2", fullName: "Vikram", enrollNumber: "R2", departmentId: "d2", year: 3 },
  { id: "s3", fullName: "Meera", enrollNumber: "R3", departmentId: "d1", year: 3 },
  { id: "s4", fullName: "Rahul", enrollNumber: "R4", departmentId: "d3", year: 3 },
];
const submission = (userId, testId, score) => ({
  id: `${userId}-${testId}-${score}`,
  userId,
  testId,
  score,
  status: "SUBMITTED",
  timeSpentSeconds: 1200,
  test: { id: testId, totalMarks: 100, subject: "Quant" },
  user: STUDENTS.find((student) => student.id === userId),
  violations: [],
});

const buildPayloadDb = () => ({
  batch: { findMany: jest.fn(async () => []) },
  department: { findMany: jest.fn(async () => [{ id: "d1", name: "CSE" }, { id: "d2", name: "ECE" }, { id: "d3", name: "MECH" }]) },
  test: { findMany: jest.fn(async () => TESTS) },
  student: { findMany: jest.fn(async () => STUDENTS) },
  submission: {
    findMany: jest
      .fn()
      .mockResolvedValueOnce([submission("s1", "t1", 60), submission("s1", "t1", 80), submission("s2", "t2", 30)])
      .mockResolvedValueOnce([]),
  },
});

describe("multi-test report payload", () => {
  const job = { id: "job-1", filters: { testIds: ["t1", "t2"] } };

  it("scopes to the selected tests and their students, with each student's best result per test", async () => {
    const db = buildPayloadDb();
    const report = await buildInstitutionReportPayload({ db, job, collegeId: COLLEGE_ID, collegeName: "North Valley" });

    expect(db.test.findMany.mock.calls[0][0].where.id).toEqual({ in: ["t1", "t2"] });
    expect(report.meta).toMatchObject({ isMultiTest: true, hasSelectedTest: true, testTitle: "Aptitude B, Aptitude A" });
    // s4 is assigned to neither test, so only s1, s2, s3 are registered.
    expect(report.kpis.totalStudents).toBe(3);
    expect(report.questionAnalytics).toBeNull();

    const { tests, students } = report.testWiseResults;
    // Ordered by test date: Aptitude A (May) is T1.
    expect(tests.map((test) => [test.code, test.title, test.registered, test.attempted, test.averageScore])).toEqual([
      ["T1", "Aptitude A", 2, 1, 80],
      ["T2", "Aptitude B", 1, 1, 30],
    ]);
    const byName = Object.fromEntries(students.map((row) => [row.name, row]));
    expect(byName.Asha.cells).toEqual([
      expect.objectContaining({ code: "T1", status: "scored", scorePercent: 80 }),
      expect.objectContaining({ code: "T2", status: "not_assigned" }),
    ]);
    expect(byName.Meera.cells[0]).toMatchObject({ code: "T1", status: "absent" });
    expect(byName.Meera.averageScore).toBeNull();
    expect(students.map((row) => row.name)).toEqual(["Asha", "Vikram", "Meera"]);
  });

  it("renders a test-wise results page and counts it in the page total", async () => {
    const report = await buildInstitutionReportPayload({ db: buildPayloadDb(), job, collegeId: COLLEGE_ID, collegeName: "North Valley" });
    const html = generateAdminReportHTML({ type: "COMPREHENSIVE", generatedAt: "2026-09-28T00:00:00Z" }, report);

    expect(html).toContain("Test-wise Results");
    expect(html).toContain("Tests (2)");
    expect(html).toContain("Absent");
    expect(html).toContain("Page 8 of 8");
  });

  it("keeps a single selected test on the single-test path", async () => {
    const db = buildPayloadDb();
    db.test.findMany.mockResolvedValue([TESTS[1]]);
    db.answer = { findMany: jest.fn(async () => []) };
    db.question = { findMany: jest.fn(async () => []) };
    const report = await buildInstitutionReportPayload({ db, job: { id: "job-2", filters: { testIds: ["t1"] } }, collegeId: COLLEGE_ID });

    expect(db.test.findMany.mock.calls[0][0].where.id).toBe("t1");
    expect(report.meta.isMultiTest).toBeUndefined();
    expect(report.testWiseResults).toBeUndefined();
  });
});

describe("report generation accepts a test selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("caps the selection at 10 tests", () => {
    const parse = (testIds) => generateReportSchema.parse({ body: { type: "TEST_WISE", filters: { testIds } }, params: {}, query: {} });
    expect(parse(Array.from({ length: 10 }, (_, i) => `t${i}`)).body.filters.testIds).toHaveLength(10);
    expect(() => parse(Array.from({ length: 11 }, (_, i) => `t${i}`))).toThrow();
  });

  const collegeAdminReq = (filters) => ({
    body: { type: "COMPREHENSIVE", filters },
    collegeId: COLLEGE_ID,
    admin: { id: "a1", role: "COLLEGE_ADMIN" },
    baseUrl: "/api/college-admin/reports",
  });

  it("stores one selected test as a plain single-test report", async () => {
    const db = { reportJob: { create: jest.fn(async ({ data }) => ({ id: "job-1", status: "QUEUED", ...data })) } };
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(generateReport, collegeAdminReq({ testIds: ["t1"] }));

    expect(response.statusCode).toBe(202);
    const stored = db.reportJob.create.mock.calls[0][0].data.filters;
    expect(stored.testId).toBe("t1");
    expect(stored.testIds).toBeUndefined();
  });

  it("stores several tests after checking they belong to the college", async () => {
    const db = {
      test: { findMany: jest.fn(async () => [{ id: "t1" }, { id: "t2" }]) },
      reportJob: { create: jest.fn(async ({ data }) => ({ id: "job-1", status: "QUEUED", ...data })) },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(generateReport, collegeAdminReq({ testIds: ["t1", "t2", "t1"] }));

    expect(response.statusCode).toBe(202);
    expect(db.test.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["t1", "t2"] }, collegeId: COLLEGE_ID });
    expect(db.reportJob.create.mock.calls[0][0].data.filters).toMatchObject({ testIds: ["t1", "t2"] });
  });

  it("rejects a selection with a test from another college", async () => {
    const db = { test: { findMany: jest.fn(async () => [{ id: "t1" }]) }, reportJob: { create: jest.fn() } };
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(generateReport, collegeAdminReq({ testIds: ["t1", "foreign"] }));

    expect(response.statusCode).toBe(404);
    expect(db.reportJob.create).not.toHaveBeenCalled();
  });

  it("rejects tests a department admin cannot see", async () => {
    resolveAdminTestScope.mockResolvedValue({ collegeId: COLLEGE_ID, departmentId: "d1", batchId: null, batchIds: [] });
    const db = { test: { findMany: jest.fn(async () => [{ id: "t1" }]) }, reportJob: { create: jest.fn() } };
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(generateReport, {
      body: { type: "COMPREHENSIVE", filters: { testIds: ["t1", "t2"] } },
      collegeId: COLLEGE_ID,
      admin: { id: "a2", role: "ADMIN", departmentId: "d1" },
      baseUrl: "/api/admin/reports",
    });

    expect(response.statusCode).toBe(403);
    expect(db.reportJob.create).not.toHaveBeenCalled();
  });

  it("super admin: stores several tests of the selected college", async () => {
    const db = {
      college: { findUnique: jest.fn(async () => ({ id: COLLEGE_ID, isActive: true })) },
      test: { findMany: jest.fn(async () => [{ id: "t1" }, { id: "t2" }]) },
      superReportJob: { create: jest.fn(async ({ data }) => ({ id: "sjob-1", status: "QUEUED", ...data })) },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(generateSuperReport, {
      body: { type: "COMPREHENSIVE", filters: { collegeId: COLLEGE_ID, testIds: ["t1", "t2"] } },
      superAdmin: { id: "super-1" },
    });

    expect(response.statusCode).toBe(202);
    const stored = db.superReportJob.create.mock.calls[0][0].data.filters;
    expect(stored.testIds).toEqual(["t1", "t2"]);
    expect(stored.testId).toBeUndefined();
  });

  it("super admin: rejects a test from another college", async () => {
    const db = {
      college: { findUnique: jest.fn(async () => ({ id: COLLEGE_ID, isActive: true })) },
      test: { findMany: jest.fn(async () => [{ id: "t1" }]) },
      superReportJob: { create: jest.fn() },
    };
    models.init.mockResolvedValue({ dbClient: db });

    await expect(
      invoke(generateSuperReport, {
        body: { type: "COMPREHENSIVE", filters: { collegeId: COLLEGE_ID, testIds: ["t1", "foreign"] } },
        superAdmin: { id: "super-1" },
      })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(db.superReportJob.create).not.toHaveBeenCalled();
  });
});

describe("results export (one row per student per selected test)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("requires 1–10 tests", () => {
    expect(() => parseExportTestIds("")).toThrow(/at least one test/);
    expect(() => parseExportTestIds(Array.from({ length: 11 }, (_, i) => `t${i}`).join(","))).toThrow(/at most 10/);
    expect(parseExportTestIds("t1, t2,t1")).toEqual(["t1", "t2"]);
  });

  it("keeps each student's best attempt per test, grouped by test", () => {
    const rows = buildTestResultRows({
      scope: { tests: [{ id: "t1", title: "Aptitude A" }, { id: "t2", title: "Aptitude B" }] },
      students: [{ id: "s1", fullName: "Asha", enrollNumber: "R1", department: { name: "CSE" }, batch: { name: "A" } }],
      attempts: [
        { userId: "s1", testId: "t2", scorePercent: 35, score: 35, totalMarks: 100, violations: 0 },
        { userId: "s1", testId: "t1", scorePercent: 60, score: 30, totalMarks: 50, violations: 1 },
        { userId: "s1", testId: "t1", scorePercent: 90, score: 45, totalMarks: 50, violations: 0 },
      ],
    });

    expect(rows.map((row) => [row.test, row.name, row.scorePercent, row.marks, row.result])).toEqual([
      ["Aptitude A", "Asha", 90, "45/50", "PASS"],
      ["Aptitude B", "Asha", 35, "35/100", "FAIL"],
    ]);
  });

  it("super admin: exports only the selected tests as CSV", async () => {
    const db = {
      college: { findUnique: jest.fn(async () => ({ id: COLLEGE_ID, isActive: true })) },
      test: {
        findMany: jest.fn(async () => [
          { id: "t1", title: "Aptitude A", totalMarks: 100, questions: [] },
          { id: "t9", title: "Other Test", totalMarks: 100, questions: [] },
        ]),
      },
      student: { findMany: jest.fn(async () => [{ id: "s1", fullName: "Asha", enrollNumber: "R1", department: { name: "CSE" }, batch: { name: "A" } }]) },
    };
    models.init.mockResolvedValue({ dbClient: db });
    collectSubmissions.mockResolvedValue({
      rows: [{ id: "sub-1", userId: "s1", testId: "t1", score: 72, accuracy: 72, submittedAt: "2026-09-01T00:00:00Z", _count: { violations: 0 } }],
      truncated: false,
    });

    const response = await invoke(exportSuperReportCsv, { query: { collegeId: COLLEGE_ID, dataset: "results", testIds: "t1" } });

    expect(response.statusCode).toBe(200);
    expect(collectSubmissions.mock.calls[0][0].where.testId).toEqual({ in: ["t1"] });
    expect(response.body).toContain("Aptitude A");
    expect(response.body).toContain("Asha");
    expect(response.body).not.toContain("Other Test");
  });

  it("scopes the results export to the selected academic status", async () => {
    const db = {
      college: { findUnique: jest.fn(async () => ({ id: COLLEGE_ID, isActive: true })) },
      test: { findMany: jest.fn(async () => [{ id: "t1", title: "Aptitude A", totalMarks: 100, questions: [] }]) },
      student: { findMany: jest.fn(async () => []) },
    };
    models.init.mockResolvedValue({ dbClient: db });
    collectSubmissions.mockResolvedValue({ rows: [], truncated: false });

    const response = await invoke(exportSuperReportCsv, {
      query: { collegeId: COLLEGE_ID, dataset: "results", testIds: "t1", academicStatus: "graduated" },
    });

    expect(response.statusCode).toBe(200);
    // The export honours the same academic scope the on-screen report uses, so a
    // graduate-only view can never silently include active students.
    expect(db.student.findMany.mock.calls[0][0].where).toMatchObject({
      lifecycleStatus: { in: ["ALUMNI", "GRADUATED"] },
    });
  });
});
