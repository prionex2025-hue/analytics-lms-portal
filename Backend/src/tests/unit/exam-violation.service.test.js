const { recordExamViolation } = require("../../services/exam-violation.service");

const baseSubmission = {
  id: "submission-1",
  userId: "student-1",
  testId: "test-1",
  collegeId: "college-1",
  departmentId: "department-1",
};

const baseUser = {
  id: "student-1",
  collegeId: "college-1",
  departmentId: "department-1",
};

const buildDb = ({ recent = null, violationCount = 1 } = {}) => ({
  violation: {
    findFirst: jest.fn().mockResolvedValue(recent),
    create: jest.fn(async ({ data }) => ({ id: "violation-new", ...data })),
    update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    count: jest.fn().mockResolvedValue(violationCount),
  },
});

describe("exam violation service", () => {
  it("creates a new actionable violation with college-scoped analytics fields", async () => {
    const db = buildDb({ violationCount: 4 });
    const now = new Date("2026-05-30T10:00:00.000Z");

    const result = await recordExamViolation({
      db,
      submission: baseSubmission,
      user: baseUser,
      type: "tab_switch",
      metadata: { reason: "blur" },
      now,
    });

    expect(result.duplicate).toBe(false);
    expect(result.violationCount).toBe(4);
    expect(db.violation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: "submission-1",
        userId: "student-1",
        testId: "test-1",
        collegeId: "college-1",
        departmentId: "department-1",
        type: "TAB_SWITCH",
        violationType: "TAB_SWITCH",
        count: 1,
        metadata: { reason: "blur" },
        detectedAt: now,
      }),
    });
  });

  it("deduplicates rapid same-type events without increasing actionable count", async () => {
    const now = new Date("2026-05-30T10:00:01.000Z");
    const db = buildDb({
      violationCount: 1,
      recent: {
        id: "violation-1",
        count: 2,
        metadata: { first: true },
        logs: [
          {
            type: "WINDOW_BLUR",
            timestamp: new Date("2026-05-30T10:00:00.000Z"),
            metadata: { first: true },
          },
        ],
      },
    });

    const result = await recordExamViolation({
      db,
      submission: baseSubmission,
      user: baseUser,
      type: "WINDOW_BLUR",
      metadata: { duplicate: true },
      now,
    });

    expect(result.duplicate).toBe(true);
    expect(result.violationCount).toBe(1);
    expect(db.violation.create).not.toHaveBeenCalled();
    expect(db.violation.update).toHaveBeenCalledWith({
      where: { id: "violation-1" },
      data: expect.objectContaining({
        count: 3,
        metadata: { duplicate: true },
        detectedAt: now,
        logs: expect.arrayContaining([
          expect.objectContaining({ type: "WINDOW_BLUR", metadata: { duplicate: true } }),
        ]),
      }),
    });
  });
});
