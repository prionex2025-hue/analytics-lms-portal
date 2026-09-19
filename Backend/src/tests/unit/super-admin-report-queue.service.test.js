describe("super admin report queue payload builder", () => {
  const REPORTABLE_STATUSES = ["SUBMITTED", "AUTO_SUBMITTED", "GRADED"];

  const loadService = () => {
    jest.resetModules();
    jest.doMock("../../config/redis", () => ({
      redisClient: null,
      getRedisQueueConnection: jest.fn(() => null),
    }));
    return require("../../services/super-admin-report-queue.service");
  };

  it("filters platform-wide student-wise exports to completed submissions inside the requested date range", async () => {
    const { buildGlobalReportPayload } = loadService();
    const findMany = jest.fn(async () => []);
    const db = {
      batch: { findMany: jest.fn(async () => []) },
      submission: { findMany },
    };

    // No collegeId => platform-wide list export (the only path that still emits a
    // raw-row summary list rather than the comprehensive Institution report).
    await buildGlobalReportPayload(db, {
      type: "STUDENT_WISE",
      filters: {
        dateFrom: "2026-01-01T00:00:00.000Z",
        dateTo: "2026-01-31T23:59:59.000Z",
      },
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: REPORTABLE_STATUSES },
        submittedAt: {
          gte: new Date("2026-01-01T00:00:00.000Z"),
          lte: new Date("2026-01-31T23:59:59.000Z"),
        },
      }),
    }));
  });

  it("filters nested platform-wide test-wise export submissions to completed attempts", async () => {
    const { buildGlobalReportPayload } = loadService();
    const testFindMany = jest.fn(async () => []);
    const db = {
      batch: { findMany: jest.fn(async () => []) },
      test: { findMany: testFindMany },
    };

    await buildGlobalReportPayload(db, {
      type: "TEST_WISE",
      filters: {
        studentId: "student-1",
      },
    });

    expect(testFindMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        submissions: expect.objectContaining({
          where: expect.objectContaining({
            userId: "student-1",
            status: { in: REPORTABLE_STATUSES },
          }),
        }),
      }),
    }));
  });

  it("builds the comprehensive Institution payload (matching College Admin) for any college-scoped report", async () => {
    const { buildGlobalReportPayload } = loadService();
    const db = {
      college: { findUnique: jest.fn(async () => ({ name: "College One" })) },
      batch: { findMany: jest.fn(async () => []) },
      department: { findMany: jest.fn(async () => []) },
      test: { findMany: jest.fn(async () => []) },
      student: { findMany: jest.fn(async () => []) },
      submission: { findMany: jest.fn(async () => []) },
    };

    // A college is selected but no specific test — the case that previously fell
    // through to a plain summary list. It must now produce the same meta/kpis
    // Institution payload the College Admin pipeline emits.
    const payload = await buildGlobalReportPayload(db, {
      id: "super-job-1",
      createdAt: new Date("2026-08-17T00:00:00.000Z"),
      type: "TEST_WISE",
      filters: { collegeId: "college-1" },
    });

    expect(payload).toEqual(expect.objectContaining({
      meta: expect.any(Object),
      kpis: expect.any(Object),
      departmentPerformance: expect.any(Array),
      studentPerformance: expect.any(Array),
    }));
    expect(payload.meta.collegeName).toBe("College One");
    expect(db.college.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "college-1" },
    }));
  });

  it("routes a college-scoped report WITH a selected test through the shared Institution core, not the divergent test-only path", async () => {
    const { buildGlobalReportPayload } = loadService();
    const testFindFirst = jest.fn(async () => ({ id: "test-1", collegeId: "college-1" }));
    const batchFindMany = jest.fn(async () => [{ id: "batch-1", name: "Batch 1", academicYear: "2025", departmentId: "dept-1" }]);
    const testFindMany = jest.fn(async () => []);
    const db = {
      college: { findUnique: jest.fn(async () => ({ name: "College One" })) },
      batch: { findMany: batchFindMany },
      department: { findMany: jest.fn(async () => []) },
      // buildInstitutionReportPayload resolves tests via findMany (buildTestScope);
      // the divergent buildDepartmentAcademicPayload resolves via findFirst.
      test: { findMany: testFindMany, findFirst: testFindFirst },
      student: { findMany: jest.fn(async () => []) },
      submission: { findMany: jest.fn(async () => []) },
      question: { findMany: jest.fn(async () => []) },
    };

    const payload = await buildGlobalReportPayload(db, {
      id: "super-job-2",
      createdAt: new Date("2026-08-17T00:00:00.000Z"),
      type: "TEST_WISE",
      filters: { collegeId: "college-1", departmentId: "dept-1", batchId: "batch-1", testId: "test-1" },
    });

    // Comprehensive Institution payload, identical shape to College Admin.
    expect(payload).toEqual(expect.objectContaining({
      meta: expect.any(Object),
      kpis: expect.any(Object),
    }));
    // The shared core was used (batch-scoped test resolution)...
    expect(batchFindMany).toHaveBeenCalled();
    expect(testFindMany).toHaveBeenCalled();
    // ...and the divergent test-only path (findFirst) was NOT taken.
    expect(testFindFirst).not.toHaveBeenCalled();
  });

  it("carries module analytics into a single MODULE_TEST report (no pinned college), test-type driven", async () => {
    const { buildGlobalReportPayload } = loadService();
    const moduleTest = {
      id: "test-1",
      title: "Aptitude Modules",
      subject: "Aptitude",
      collegeId: "college-1",
      assessmentFormat: "MODULE_TEST",
      modules: [
        { key: "QUANT", name: "Quantitative Aptitude", order: 1, category: "Quantitative Aptitude", durationMins: 4 },
        { key: "REASONING", name: "Logical Reasoning", order: 2, category: "Logical Reasoning", durationMins: 4 },
        { key: "VERBAL", name: "Verbal", order: 3, category: "Verbal", durationMins: 4 },
      ],
      assignmentMethod: "everyone",
    };
    const submission = {
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
    const db = {
      college: { findUnique: jest.fn(async () => ({ name: "College One" })) },
      test: { findFirst: jest.fn(async () => moduleTest) },
      department: { findMany: jest.fn(async () => [{ id: "dept-1", name: "CSE" }]) },
      student: { findMany: jest.fn(async () => []) },
      submission: {
        findMany: jest.fn(async ({ where }) =>
          where?.status?.in?.[0] === "IN_PROGRESS" ? [] : [submission]
        ),
      },
      question: { findMany: jest.fn(async () => []) },
      answer: { findMany: jest.fn(async () => []) },
    };

    // No college pinned => the test-only branch (buildDepartmentAcademicPayload)
    // resolves the test, derives the college, and must attach module analytics.
    const payload = await buildGlobalReportPayload(db, {
      id: "super-job-3",
      createdAt: new Date("2026-08-17T00:00:00.000Z"),
      type: "DEPARTMENT_WISE",
      filters: { testId: "test-1" },
    });

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
});
