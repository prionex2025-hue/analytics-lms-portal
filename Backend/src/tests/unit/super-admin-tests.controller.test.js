const models = require("../../models");
const {
  deactivateTest,
  transitionGlobalTestStatus,
  updateGlobalTest,
} = require("../../controllers/SuperAdmin/tests.controller");
const { createAuditLog } = require("../../services/audit.service");

jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../services/audit.service", () => ({
  createAuditLog: jest.fn(async () => {}),
}));

const collegeId = "507f1f77bcf86cd799439031";
const departmentId = "507f1f77bcf86cd799439032";
const testId = "507f1f77bcf86cd799439033";

const existingTest = {
  id: testId,
  collegeId,
  title: "Physics",
  subject: "Physics",
  description: "Mechanics",
  durationMins: 60,
  totalMarks: 10,
  attemptsAllowed: 1,
  evaluationRule: "BEST_ATTEMPT",
  startsAt: new Date("2026-05-20T10:00:00.000Z"),
  endsAt: new Date("2026-05-20T11:00:00.000Z"),
  isPublished: false,
  status: "DRAFT",
  questions: [],
  batchAssignments: [],
};

const createDb = () => {
  const updatedTest = {
    ...existingTest,
    assignmentMethod: "department_wise",
    assignedTo: [departmentId],
    departmentId,
    batchId: null,
  };

  const tx = {
    test: {
      update: jest.fn(async () => updatedTest),
      create: jest.fn(),
    },
    testBatch: {
      deleteMany: jest.fn(async () => {}),
      createMany: jest.fn(),
    },
    question: {
      deleteMany: jest.fn(async () => {}),
      createMany: jest.fn(async () => {}),
    },
  };

  return {
    tx,
    db: {
      test: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(existingTest)
          .mockResolvedValueOnce({
            ...updatedTest,
            college: null,
            department: null,
            questions: [],
            batchAssignments: [],
            _count: { questions: 1, submissions: 0 },
          }),
        findMany: jest.fn(async () => [{ id: testId, collegeId }]),
      },
      admin: {
        findMany: jest.fn(async () => [{ id: "507f1f77bcf86cd799439034", collegeId }]),
      },
      department: {
        findMany: jest.fn(async () => [{ id: departmentId }]),
      },
      batch: {
        findMany: jest.fn(async () => []),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    },
  };
};

const invoke = async (handler, req) => {
  let resolveResponse;
  let rejectResponse;
  const responsePromise = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const res = {
    status: jest.fn(function status() {
      return this;
    }),
    json: jest.fn((payload) => {
      resolveResponse(payload);
    }),
  };

  handler(req, res, (error) => {
    if (error) {
      rejectResponse(error);
    }
  });
  await responsePromise;

  return res;
};

describe("super-admin tests controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates a department-wise test even when the department has no batches", async () => {
    const { db, tx } = createDb();
    models.init.mockResolvedValue({ dbClient: db });

    const res = await invoke(updateGlobalTest, {
      params: { testId },
      body: {
        title: "Physics",
        subject: "Physics",
        description: "Mechanics",
        durationMins: 60,
        totalMarks: 10,
        attemptsAllowed: 1,
        evaluationRule: "BEST_ATTEMPT",
        startsAt: "2026-05-20T10:00:00.000Z",
        endsAt: "2026-05-20T11:00:00.000Z",
        collegeIds: [collegeId],
        allColleges: false,
        assignmentMethod: "department_wise",
        departmentIds: [departmentId],
        batchIds: [],
        questions: [{ prompt: "Q1", type: "MCQ", options: ["A", "B"], correctOption: "A", marks: 10 }],
      },
      superAdmin: { id: "507f1f77bcf86cd799439035" },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(tx.test.update).toHaveBeenCalled();
    expect(tx.testBatch.createMany).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalled();
  });

  it("honors publishState when updating a draft global test", async () => {
    const { db, tx } = createDb();
    models.init.mockResolvedValue({ dbClient: db });
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    await invoke(updateGlobalTest, {
      params: { testId },
      body: {
        title: "Physics",
        subject: "Physics",
        description: "Mechanics",
        durationMins: 60,
        totalMarks: 10,
        attemptsAllowed: 1,
        evaluationRule: "BEST_ATTEMPT",
        startsAt,
        endsAt,
        publishState: "UPCOMING",
        collegeIds: [collegeId],
        allColleges: false,
        assignmentMethod: "department_wise",
        departmentIds: [departmentId],
        batchIds: [],
        questions: [{ prompt: "Q1", type: "MCQ", options: ["A", "B"], correctOption: "A", marks: 10 }],
      },
      superAdmin: { id: "507f1f77bcf86cd799439035" },
    });

    expect(tx.test.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "SCHEDULED",
        isPublished: true,
      }),
    }));
  });

  it("lets super admin go live immediately for a future scheduled test", async () => {
    const futureStart = new Date(Date.now() + 60 * 60 * 1000);
    const scheduledTest = {
      ...existingTest,
      status: "SCHEDULED",
      isPublished: true,
      startsAt: futureStart,
      endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    };
    const db = {
      test: {
        findUnique: jest.fn(async () => scheduledTest),
        update: jest.fn(async ({ data }) => ({ ...scheduledTest, ...data })),
      },
      submission: {
        findMany: jest.fn(async () => []),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const res = await invoke(transitionGlobalTestStatus, {
      params: { testId },
      body: { action: "GO_LIVE" },
      superAdmin: { id: "507f1f77bcf86cd799439035" },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.test.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "LIVE",
        isPublished: true,
        startsAt: expect.any(Date),
      }),
    }));
    expect(db.test.update.mock.calls[0][0].data.startsAt.getTime()).toBeLessThan(futureStart.getTime());
  });

  it("blocks deleting non-draft global tests even when they have no submissions", async () => {
    const db = {
      test: {
        findUnique: jest.fn(async () => ({
          ...existingTest,
          status: "SCHEDULED",
          isPublished: true,
        })),
      },
      submission: {
        count: jest.fn(async () => 0),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    await expect(invoke(deactivateTest, {
      params: { testId },
      body: {},
      superAdmin: { id: "507f1f77bcf86cd799439035" },
    })).rejects.toMatchObject({
      code: "TEST_DELETE_BLOCKED",
    });
  });
});
