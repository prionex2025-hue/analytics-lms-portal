const models = require("../../models");
const {
  calculateSubmissionScore,
  completeSubmission,
  findAnswerForQuestion,
  isAnswerProvided,
  isQuestionCorrect,
} = require("../../services/test.service");

describe("test service scoring", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not count cleared blank answers as completed", async () => {
    jest.spyOn(models, "init").mockResolvedValue({
      dbClient: {
        submission: {
          findUnique: jest.fn(async () => ({
            id: "submission-1",
            test: {
              questions: [
                { id: "q1", type: "MCQ", correctOption: "A", marks: 5 },
                { id: "q2", type: "FILL_BLANK", correctText: "React", marks: 5 },
              ],
            },
            answers: [
              { questionId: "q1", selectedOption: null, selectedOptions: [], answerText: "", answerBoolean: null },
              { questionId: "q2", answerText: "React" },
            ],
          })),
        },
      },
    });

    const summary = await calculateSubmissionScore("submission-1");

    expect(summary).toEqual({
      score: 5,
      accuracy: 50,
      completion: 50,
      totalQuestions: 2,
    });
  });

  it("scores multi-select answers by comparing option sets", () => {
    const question = {
      type: "MCQ_MULTI",
      correctOptions: ["A", "C"],
    };

    expect(isQuestionCorrect(question, { selectedOptions: ["C", "A"] })).toBe(true);
    expect(isQuestionCorrect(question, { selectedOptions: ["A"] })).toBe(false);
  });

  it("deducts negative marks only for answered wrong questions", async () => {
    jest.spyOn(models, "init").mockResolvedValue({
      dbClient: {
        submission: {
          findUnique: jest.fn(async () => ({
            id: "submission-1",
            test: {
              negativeMarkingEnabled: true,
              negativeMarks: 1,
              questions: [
                { id: "q1", type: "MCQ", correctOption: "A", marks: 5 },
                { id: "q2", type: "MCQ", correctOption: "B", marks: 5 },
                { id: "q3", type: "MCQ", correctOption: "C", marks: 5 },
              ],
            },
            answers: [
              { questionId: "q1", selectedOption: "A" },
              { questionId: "q2", selectedOption: "A" },
              { questionId: "q3", selectedOption: null, selectedOptions: [], answerText: "" },
            ],
          })),
        },
      },
    });

    const summary = await calculateSubmissionScore("submission-1");

    expect(summary).toEqual({
      score: 4,
      accuracy: 26.67,
      completion: 66.67,
      totalQuestions: 3,
    });
  });

  it("uses the same answered check as the student test palette", () => {
    expect(isAnswerProvided({ selectedOption: null, selectedOptions: [], answerText: "" })).toBe(false);
    expect(isAnswerProvided({ markedForReview: true })).toBe(false);
    expect(isAnswerProvided({ selectedOption: 0 })).toBe(true);
    expect(isAnswerProvided({ answerBoolean: false })).toBe(true);
    expect(isAnswerProvided({ selectedOptions: ["A"] })).toBe(true);
  });

  it("scores numeric zero as a real selected option", () => {
    const question = {
      type: "MCQ",
      correctOption: "0",
    };

    expect(isQuestionCorrect(question, { selectedOption: 0 })).toBe(true);
  });

  it("matches answers through included question source ids", () => {
    const answer = {
      questionId: "question-copy-1",
      question: {
        id: "question-copy-1",
        sourceQuestionId: "bank-question-1",
      },
    };

    expect(findAnswerForQuestion([answer], { id: "bank-question-1" })).toBe(answer);
  });

  it("caps completed attempt time at the server session expiry", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T10:45:00.000Z"));

    const updateMany = jest.fn(async () => ({ count: 1 }));
    const scoreSubmission = {
      id: "submission-1",
      testId: "test-1",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      status: "IN_PROGRESS",
      test: {
        questions: [{ id: "q1", type: "MCQ", correctOption: "A", marks: 10 }],
      },
      answers: [{ questionId: "q1", selectedOption: "A" }],
    };
    const existingSubmission = {
      id: "submission-1",
      testId: "test-1",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      status: "IN_PROGRESS",
    };
    const completedSubmission = {
      ...existingSubmission,
      status: "AUTO_SUBMITTED",
      timeSpentSeconds: 1800,
    };

    jest.spyOn(models, "init").mockResolvedValue({
      dbClient: {
        submission: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(scoreSubmission)
            .mockResolvedValueOnce(existingSubmission)
            .mockResolvedValueOnce(completedSubmission),
          updateMany,
        },
        testSession: {
          findFirst: jest.fn(async () => ({
            expiresAt: new Date("2026-01-01T10:30:00.000Z"),
          })),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
        test: {
          findUnique: jest.fn(async () => ({ durationMins: 60 })),
        },
      },
    });

    const completed = await completeSubmission({ submissionId: "submission-1", autoSubmitted: true });

    expect(completed).toBe(completedSubmission);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "AUTO_SUBMITTED",
        timeSpentSeconds: 1800,
      }),
    }));

    jest.useRealTimers();
  });

  it("caps completed attempt time at test duration when no session expiry exists", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T10:45:00.000Z"));

    const updateMany = jest.fn(async () => ({ count: 1 }));
    const scoreSubmission = {
      id: "submission-1",
      testId: "test-1",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      status: "IN_PROGRESS",
      test: {
        questions: [{ id: "q1", type: "MCQ", correctOption: "A", marks: 10 }],
      },
      answers: [{ questionId: "q1", selectedOption: "A" }],
    };
    const existingSubmission = {
      id: "submission-1",
      testId: "test-1",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      status: "IN_PROGRESS",
    };

    jest.spyOn(models, "init").mockResolvedValue({
      dbClient: {
        submission: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(scoreSubmission)
            .mockResolvedValueOnce(existingSubmission)
            .mockResolvedValueOnce({ ...existingSubmission, status: "AUTO_SUBMITTED" }),
          updateMany,
        },
        testSession: {
          findFirst: jest.fn(async () => null),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
        test: {
          findUnique: jest.fn(async () => ({ durationMins: 20 })),
        },
      },
    });

    await completeSubmission({ submissionId: "submission-1", autoSubmitted: true });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        timeSpentSeconds: 1200,
      }),
    }));

    jest.useRealTimers();
  });
});
