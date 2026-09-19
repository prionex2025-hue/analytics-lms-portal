const models = require("../../models");

jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../services/report-pdf.service", () => ({
  renderHtmlToPdfBuffer: jest.fn(),
}));

const { buildStudentReportPayload } = require("../../controllers/Students/reports.controller");

describe("student reports controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes graded completed submissions in student reports", async () => {
    const db = {
      submission: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: "submission-1",
              userId: "student-1",
              testId: "test-1",
              status: "GRADED",
              score: 8,
              submittedAt: new Date("2026-01-10T10:00:00.000Z"),
              timeSpentSeconds: 600,
              test: {
                id: "test-1",
                title: "Aptitude",
                subject: "Quant",
                status: "COMPLETED",
                totalMarks: 10,
              },
            },
          ]),
      },
      answer: {
        findMany: jest.fn(async () => []),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const payload = await buildStudentReportPayload({
      db,
      userId: "student-1",
      filters: { view: "overall" },
    });

    expect(db.submission.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        userId: "student-1",
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED", "GRADED"] },
      }),
    }));
    expect(payload.overall.summary.tests_taken).toBe(1);
    expect(payload.testWise).toHaveLength(1);
    expect(payload.testWise[0]).toMatchObject({
      submissionId: "submission-1",
      testName: "Aptitude",
      scorePercent: 80,
      obtainedMarks: 8,
      totalMarks: 10,
    });
  });
});
