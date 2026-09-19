jest.mock("../../utils/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("../../utils/score", () => ({
  getSubmissionScorePercent: jest.fn(() => 80),
}));

const { getDb } = require("../../utils/db");
const { getSuperAdminDashboard } = require("../../controllers/SuperAdmin/dashboard.controller");

const invoke = async (handler) =>
  new Promise((resolve, reject) => {
    const res = {
      status: jest.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn((payload) => {
        resolve({ res, payload });
      }),
    };

    handler({}, res, (error) => {
      if (error) {
        reject(error);
      }
    });
  });

describe("super-admin dashboard controller", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-29T12:00:00.000Z"));
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("counts active users from open sessions and deduplicates per user", async () => {
    const db = {
      college: {
        count: jest.fn(async () => 4),
        findMany: jest.fn(async () => [
          {
            id: "college-1",
            name: "College One",
            submissions: [
              { score: 40, test: { totalMarks: 50 } },
            ],
          },
        ]),
      },
      admin: {
        count: jest.fn(async () => 6),
      },
      student: {
        count: jest.fn(async () => 120),
      },
      test: {
        count: jest.fn(async () => 18),
      },
      testSession: {
        findMany: jest.fn(async () => [
          { userId: "student-1", lastHeartbeatAt: new Date("2026-05-29T09:00:00.000Z") },
          { userId: "student-1", lastHeartbeatAt: new Date("2026-05-29T10:00:00.000Z") },
          { userId: "student-2", lastHeartbeatAt: new Date("2026-05-29T08:30:00.000Z") },
          { userId: "student-3", lastHeartbeatAt: new Date("2026-05-28T08:15:00.000Z") },
          { userId: "student-4", lastHeartbeatAt: new Date("2026-05-27T08:15:00.000Z") },
        ]),
      },
      submission: {
        findMany: jest.fn(async () => [
          { submittedAt: new Date("2026-05-29T07:00:00.000Z"), score: 40, collegeId: "college-1", test: { totalMarks: 50 } },
          { submittedAt: new Date("2026-05-28T07:00:00.000Z"), score: 35, collegeId: "college-1", test: { totalMarks: 50 } },
        ]),
      },
    };

    getDb.mockResolvedValue(db);

    const { res, payload } = await invoke(getSuperAdminDashboard);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.cards.activeUsers).toBe(2);
    expect(payload.charts.dailyActiveUsers.find((item) => item.day === "2026-05-29")).toEqual({ day: "2026-05-29", users: 2 });
    expect(payload.charts.dailyActiveUsers.find((item) => item.day === "2026-05-28")).toEqual({ day: "2026-05-28", users: 1 });
    expect(payload.charts.dailyActiveUsers.find((item) => item.day === "2026-05-27")).toEqual({ day: "2026-05-27", users: 1 });
    expect(payload.charts.testParticipationTrend.find((item) => item.day === "2026-05-29")).toEqual({ day: "2026-05-29", count: 1 });
  });
});