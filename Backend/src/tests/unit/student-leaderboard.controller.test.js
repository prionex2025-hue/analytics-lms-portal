const models = require("../../models");
const { getLeaderboard } = require("../../controllers/Students/leaderboard.controller");

jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../config/redis", () => ({
  isRedisAvailable: jest.fn(() => false),
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      status: jest.fn(function status() {
        return this;
      }),
      json: jest.fn((payload) => resolve({ res, payload })),
    };

    handler(req, res, (error) => {
      if (error) {
        reject(error);
      }
    });
  });

describe("student leaderboard controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sorts all scoped submissions by normalized score before paginating ranks", async () => {
    const db = {
      submission: {
        findMany: jest.fn(async () => [
          {
            id: "recent-low",
            score: 40,
            timeSpentSeconds: 100,
            submittedAt: new Date("2026-06-10T10:00:00.000Z"),
            user: { id: "student-low", fullName: "Recent Low", studentId: "S-LOW" },
            test: { id: "test-1", title: "Aptitude", subject: "Math", totalMarks: 100 },
          },
          {
            id: "older-high",
            score: 45,
            timeSpentSeconds: 120,
            submittedAt: new Date("2026-06-09T10:00:00.000Z"),
            user: { id: "student-high", fullName: "Older High", studentId: "S-HIGH" },
            test: { id: "test-2", title: "Coding", subject: "CS", totalMarks: 50 },
          },
        ]),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const { res, payload } = await invoke(getLeaderboard, {
      query: { page: "1", limit: "1" },
      user: {
        id: "student-high",
        collegeId: "college-1",
        departmentId: "dept-1",
        batchIds: ["batch-1"],
      },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.submission.findMany).toHaveBeenCalledWith(expect.not.objectContaining({
      skip: expect.any(Number),
      take: expect.any(Number),
    }));
    expect(payload.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(payload.data).toEqual([
      expect.objectContaining({
        rank: 1,
        id: "older-high",
        score: 90,
      }),
    ]);
  });
});
