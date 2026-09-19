const { aggregateModulePerformance, buildAggregateReportResponse } = require("../../services/report-analytics-aggregation.service");
const { generateAdminReportHTML } = require("../../services/report-formatter.service");
const { buildInstitutionReportPayload } = require("../../services/admin-department-report.service");

const MODULES = [
  { key: "QUANT", name: "Quantitative Aptitude", order: 1 },
  { key: "REASONING", name: "Logical Reasoning", order: 2 },
  { key: "VERBAL", name: "Verbal", order: 3 },
];

const submission = (id, userId, quant, reasoning, verbal) => ({
  id,
  userId,
  score: quant.score + reasoning.score + verbal.score,
  overallMaxScore: quant.maxScore + reasoning.maxScore + verbal.maxScore,
  overallPercentage: 50,
  totalActualTimeSeconds: 600,
  moduleState: [
    { key: "QUANT", name: "Quantitative Aptitude", order: 1, status: "MANUAL_SUBMIT", timeTakenSeconds: 300, ...quant },
    { key: "REASONING", name: "Logical Reasoning", order: 2, status: "EXPIRED", timeTakenSeconds: 200, ...reasoning },
    { key: "VERBAL", name: "Verbal", order: 3, status: "COMPLETED", timeTakenSeconds: 100, ...verbal },
  ],
});

describe("aggregateModulePerformance", () => {
  it("computes module-wise averages, completion, and per-student rows", () => {
    const submissions = [
      submission("s1", "u1", { score: 4, maxScore: 5, percentage: 80 }, { score: 5, maxScore: 5, percentage: 100 }, { score: 0, maxScore: 4, percentage: 0 }),
      submission("s2", "u2", { score: 2, maxScore: 5, percentage: 40 }, { score: 1, maxScore: 5, percentage: 20 }, { score: 4, maxScore: 4, percentage: 100 }),
    ];

    const result = aggregateModulePerformance(submissions, { modules: MODULES });

    expect(result.attempts).toBe(2);
    const quant = result.moduleStats.find((m) => m.key === "QUANT");
    expect(quant.averageScore).toBe(3); // (4 + 2) / 2
    expect(quant.averagePercentage).toBe(60); // (80 + 40) / 2
    expect(quant.completionRate).toBe(100); // both MANUAL_SUBMIT
    expect(quant.averageTimeSeconds).toBe(300);
    expect(result.studentRows).toHaveLength(2);
    expect(result.studentRows[0].modules.map((m) => m.key)).toEqual(["QUANT", "REASONING", "VERBAL"]);
  });

  it("ignores OPEN_TEST submissions without moduleState", () => {
    const result = aggregateModulePerformance([{ id: "s1", userId: "u1", score: 5 }], { modules: MODULES });
    expect(result.attempts).toBe(0);
  });
});

describe("report formatter module sheet", () => {
  it("renders a Section Performance sheet for a MODULE_TEST report payload", () => {
    const reportData = {
      meta: { title: "Module Test", collegeName: "Test College", isModuleTest: true },
      kpis: {},
      studentPerformance: [],
      modulePerformance: {
        modules: MODULES,
        moduleStats: [
          { key: "QUANT", name: "Quantitative Aptitude", order: 1, averageScore: 3, averageMaxScore: 5, averagePercentage: 60, averageTimeSeconds: 300, completionRate: 100 },
        ],
        studentRows: [
          { userId: "u1", name: "Alice", rollNo: "STU001", status: "SUBMITTED", overallScore: 9, overallMaxScore: 14, overallPercentage: 64, totalActualTimeSeconds: 600, modules: [{ key: "QUANT", name: "Quantitative Aptitude", score: 4, maxScore: 5 }] },
        ],
      },
    };

    const html = generateAdminReportHTML({ type: "DEPARTMENT_WISE", generatedAt: new Date(), expiresAt: new Date() }, reportData);
    expect(html).toContain("Section Performance (Module Test)");
    expect(html).toContain("Student Module Breakdown");
    expect(html).toContain("Alice");
    expect(html).toContain("Reg No");
    expect(html).toContain("STU001");
    expect(html).toContain("4/5 (80%)");
    expect(html).toContain("Submitted");
    expect(html).toContain("9/14 (64%)");
  });

  it("does not render a module sheet for an OPEN_TEST payload even when meta marks it non-module", () => {
    const html = generateAdminReportHTML(
      { type: "DEPARTMENT_WISE", generatedAt: new Date(), expiresAt: new Date() },
      { meta: { title: "Open Test", assessmentFormat: "OPEN_TEST" }, kpis: {}, studentPerformance: [] }
    );
    expect(html).not.toContain("Section Performance (Module Test)");
  });

  it("renders the module sheet for a MODULE_TEST payload even without modulePerformance flag via meta.isModuleTest", () => {
    const html = generateAdminReportHTML(
      { type: "TEST_WISE", generatedAt: new Date(), expiresAt: new Date() },
      {
        meta: { title: "Module Test", isModuleTest: true, assessmentFormat: "MODULE_TEST" },
        kpis: {},
        studentPerformance: [],
        modulePerformance: {
          modules: MODULES,
          moduleStats: [
            { key: "QUANT", name: "Quantitative Aptitude", order: 1, averageScore: 3, averageMaxScore: 5, averagePercentage: 60, averageTimeSeconds: 300, completionRate: 100 },
          ],
          studentRows: [],
        },
      }
    );
    expect(html).toContain("Section Performance (Module Test)");
    expect(html).toContain("No student module data available.");
  });
});

describe("buildInstitutionReportPayload (Admin/College shared core) module analytics", () => {
  const moduleTest = {
    id: "test-1",
    title: "Aptitude Modules",
    subject: "Aptitude",
    collegeId: "college-1",
    durationMins: 12,
    assignmentMethod: "everyone",
    assessmentFormat: "MODULE_TEST",
    modules: [
      { key: "QUANT", name: "Quantitative Aptitude", order: 1, category: "Quantitative Aptitude", durationMins: 4 },
      { key: "REASONING", name: "Logical Reasoning", order: 2, category: "Logical Reasoning", durationMins: 4 },
      { key: "VERBAL", name: "Verbal", order: 3, category: "Verbal", durationMins: 4 },
    ],
  };
  const reportableSubmission = {
    id: "sub-1",
    userId: "user-1",
    collegeId: "college-1",
    testId: "test-1",
    status: "SUBMITTED",
    submittedAt: new Date("2026-08-17T00:00:00.000Z"),
    score: 9,
    overallMaxScore: 15,
    overallPercentage: 60,
    totalActualTimeSeconds: 900,
    moduleState: [
      { key: "QUANT", name: "Quantitative Aptitude", order: 1, status: "MANUAL_SUBMIT", timeTakenSeconds: 300, score: 3, maxScore: 5, percentage: 60 },
      { key: "REASONING", name: "Logical Reasoning", order: 2, status: "MANUAL_SUBMIT", timeTakenSeconds: 300, score: 4, maxScore: 5, percentage: 80 },
      { key: "VERBAL", name: "Verbal", order: 3, status: "COMPLETED", timeTakenSeconds: 300, score: 2, maxScore: 5, percentage: 40 },
    ],
    user: {
      id: "user-1",
      fullName: "Alice",
      email: "alice@edu",
      studentId: "U1",
      enrollNumber: "2024001",
      departmentId: "dept-1",
      year: 2,
      batch: { name: "Batch A", year: 2, academicYear: "2024" },
    },
  };

  const mockDb = (opts = {}) => ({
    batch: { findMany: jest.fn(async () => []) },
    department: { findMany: jest.fn(async () => [{ id: "dept-1", name: "CSE" }]) },
    test: { findMany: jest.fn(async () => [opts.test || moduleTest]) },
    student: { findMany: jest.fn(async () => []) },
    submission: {
      findMany: jest.fn(async ({ where }) =>
        where?.status?.in?.[0] === "IN_PROGRESS" ? [] : [opts.submission || reportableSubmission]
      ),
    },
    question: { findMany: jest.fn(async () => []) },
    answer: { findMany: jest.fn(async () => []) },
  });

  const buildPayload = (db, { filters } = {}) =>
    buildInstitutionReportPayload({
      db,
      job: { id: "job-1", createdAt: new Date("2026-08-17T00:00:00.000Z"), type: "TEST_WISE", filters: filters || { testId: "test-1" } },
      collegeId: "college-1",
      collegeName: "College One",
      departmentFallbackName: "-",
    });

  it("attaches module analytics + enriched student rows for a single MODULE_TEST scope", async () => {
    const payload = await buildPayload(mockDb());

    expect(payload.meta.isModuleTest).toBe(true);
    expect(payload.meta.assessmentFormat).toBe("MODULE_TEST");
    expect(payload.modulePerformance).toBeTruthy();
    expect(payload.modulePerformance.moduleStats.map((m) => m.key)).toEqual(["QUANT", "REASONING", "VERBAL"]);
    expect(payload.modulePerformance.studentRows).toHaveLength(1);
    expect(payload.modulePerformance.studentRows[0]).toMatchObject({
      userId: "user-1",
      name: "Alice",
      rollNo: "2024001",
      department: "CSE",
      year: "2",
      status: "SUBMITTED",
    });
  });

  it("omits module analytics for an OPEN_TEST scope", async () => {
    const openTest = { ...moduleTest, id: "test-2", assessmentFormat: "OPEN_TEST", modules: [] };
    const payload = await buildPayload(mockDb({ test: openTest, submission: { ...reportableSubmission, testId: "test-2", moduleState: undefined } }));

    expect(payload.meta.isModuleTest).toBeUndefined();
    expect(payload.meta.assessmentFormat).toBe("OPEN_TEST");
    expect(payload.modulePerformance).toBeUndefined();
  });
});

describe("buildAggregateReportResponse modulePerformance", () => {
  it("derives ordered module definitions from the byModule facet for the report page", () => {
    const payload = buildAggregateReportResponse({
      facet: {
        byModule: [
          { key: "VERBAL", name: "Verbal", order: 3, averageScore: 2, averageMaxScore: 5, averagePercentage: 40, completionRate: 100 },
          { key: "QUANT", name: "Quantitative Aptitude", order: 1, averageScore: 3, averageMaxScore: 5, averagePercentage: 60, completionRate: 100 },
          { key: "REASONING", name: "Logical Reasoning", order: 2, averageScore: 4, averageMaxScore: 5, averagePercentage: 80, completionRate: 100 },
        ],
      },
    });

    expect(payload.modulePerformance).toBeTruthy();
    expect(payload.modulePerformance.modules).toEqual([
      { key: "QUANT", name: "Quantitative Aptitude", order: 1 },
      { key: "REASONING", name: "Logical Reasoning", order: 2 },
      { key: "VERBAL", name: "Verbal", order: 3 },
    ]);
    expect(payload.modulePerformance.moduleStats).toHaveLength(3);
  });

  it("keeps modulePerformance additive for scopes without module data", () => {
    const payload = buildAggregateReportResponse({ facet: {} });
    expect(payload.modulePerformance).toBeTruthy();
    expect(payload.modulePerformance.modules).toEqual([]);
    expect(payload.modulePerformance.moduleStats).toEqual([]);
  });
});
