const models = require("../../models");
const {
  listUpcomingTests,
  startTest,
} = require("../../controllers/Students/tests.controller");
const { withRedisLock } = require("../../services/redis-lock.service");
const { getCachedTestQuestions, setCachedTestQuestions } = require("../../services/test-cache.service");
const { isStudentAssignedToTest } = require("../../services/student-test-assignment.service");

jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../services/audit.service", () => ({
  createAuditLog: jest.fn(async () => {}),
}));

jest.mock("../../services/redis-lock.service", () => ({
  withRedisLock: jest.fn(async ({ task }) => task({ lockAcquired: false })),
}));

jest.mock("../../services/exam-state-cache.service", () => ({
  setExamState: jest.fn(async () => {}),
  clearExamState: jest.fn(async () => {}),
}));

jest.mock("../../services/heartbeat-buffer.service", () => ({
  bufferHeartbeat: jest.fn(async () => false),
}));

jest.mock("../../realtime/socket", () => ({
  emitToCollege: jest.fn(),
  emitToUser: jest.fn(),
  emitToTestRoom: jest.fn(),
}));

jest.mock("../../services/test-cache.service", () => ({
  getCachedTestQuestions: jest.fn(async () => null),
  setCachedTestQuestions: jest.fn(async () => {}),
}));

jest.mock("../../services/test-config.service", () => ({
  attachResolvedTestConfiguration: jest.fn((test) => test),
}));

jest.mock("../../services/exam-violation.service", () => ({
  recordExamViolation: jest.fn(),
}));

jest.mock("../../services/student-test-assignment.service", () => ({
  buildStudentAssignmentScope: jest.fn(() => ({ collegeId: "college-1" })),
  isStudentAssignedToTest: jest.fn(() => true),
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

const createStartRequest = () => ({
  params: { testId: "test-1" },
  body: {},
  headers: {},
  user: {
    id: "student-1",
    collegeId: "college-1",
    departmentId: "department-1",
    batchIds: [],
    year: 1,
    status: "ACTIVE",
  },
});

describe("student tests controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withRedisLock.mockImplementation(async ({ task }) => task({ lockAcquired: false }));
    isStudentAssignedToTest.mockReturnValue(true);
  });

  it("lists only published upcoming tests for students", async () => {
    const db = {
      test: {
        findMany: jest.fn(async () => []),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const { res, payload } = await invoke(listUpcomingTests, createStartRequest());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload).toEqual([]);
    expect(db.test.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        collegeId: "college-1",
        isPublished: true,
        startsAt: expect.objectContaining({ gt: expect.any(Date) }),
      }),
    }));
    expect(JSON.stringify(db.test.findMany.mock.calls[0][0].where)).not.toContain("\"status\":\"UPCOMING\"");
  });

  it.each([
    ["draft", { isPublished: false, status: "DRAFT" }],
    ["archived", { isPublished: true, status: "ARCHIVED" }],
    ["completed", { isPublished: true, status: "COMPLETED" }],
  ])("blocks starting %s tests even when the student knows the test id", async (_label, overrides) => {
    const db = {
      test: {
        findUnique: jest.fn(async () => ({
          id: "test-1",
          collegeId: "college-1",
          title: "Hidden test",
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 60_000),
          durationMins: 60,
          attemptsAllowed: 1,
          assignmentMethod: "everyone",
          questions: [],
          ...overrides,
        })),
      },
      testSession: {
        findUnique: jest.fn(),
      },
      testBatch: {
        findFirst: jest.fn(),
      },
      submission: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    await expect(invoke(startTest, createStartRequest())).rejects.toMatchObject({
      statusCode: 403,
      code: "TEST_NOT_AVAILABLE",
    });

    expect(getCachedTestQuestions).not.toHaveBeenCalled();
    expect(setCachedTestQuestions).not.toHaveBeenCalled();
    expect(db.testSession.findUnique).not.toHaveBeenCalled();
    expect(db.submission.create).not.toHaveBeenCalled();
  });

  it("blocks lock-timeout session resume when the student is no longer assigned", async () => {
    withRedisLock.mockImplementationOnce(async ({ onLockTimeout }) => onLockTimeout());
    isStudentAssignedToTest.mockReturnValueOnce(false);

    const db = {
      test: {
        findUnique: jest.fn(async () => ({
          id: "test-1",
          collegeId: "college-1",
          title: "Published test",
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 60_000),
          durationMins: 60,
          attemptsAllowed: 1,
          assignmentMethod: "batch_wise",
          isPublished: true,
          status: "LIVE",
          questions: [],
        })),
      },
      testBatch: {
        findFirst: jest.fn(async () => null),
      },
      testSession: {
        findUnique: jest.fn(),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    await expect(invoke(startTest, createStartRequest())).rejects.toMatchObject({
      statusCode: 403,
      code: "TEST_NOT_ASSIGNED",
    });

    expect(db.testBatch.findFirst).toHaveBeenCalledWith({
      where: {
        testId: "test-1",
        batchId: { in: [] },
      },
    });
    expect(db.testSession.findUnique).not.toHaveBeenCalled();
    expect(getCachedTestQuestions).not.toHaveBeenCalled();
  });

  it("requires persisted instruction agreement before creating a new attempt", async () => {
    const db = {
      test: {
        findUnique: jest.fn(async () => ({
          id: "test-1",
          collegeId: "college-1",
          title: "Published test",
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 60_000),
          durationMins: 60,
          attemptsAllowed: 1,
          assignmentMethod: "everyone",
          isPublished: true,
          status: "LIVE",
          instructions: "Read first",
          questions: [],
        })),
      },
      testBatch: {
        findFirst: jest.fn(async () => null),
      },
      testSession: {
        findUnique: jest.fn(async () => null),
      },
      testInstructionAgreement: {
        findUnique: jest.fn(async () => null),
      },
      submission: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    await expect(invoke(startTest, createStartRequest())).rejects.toMatchObject({
      statusCode: 428,
      code: "TEST_INSTRUCTIONS_AGREEMENT_REQUIRED",
    });

    expect(db.testInstructionAgreement.findUnique).toHaveBeenCalledWith({
      where: { userId_testId: { userId: "student-1", testId: "test-1" } },
    });
    expect(db.submission.findFirst).not.toHaveBeenCalled();
    expect(db.submission.create).not.toHaveBeenCalled();
  });
});
