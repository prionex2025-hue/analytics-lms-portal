const models = require("../../models");
const { cloneTestToCollege, cloneTestWithinCollege } = require("../../services/clone.service");

jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../services/model-validation.service", () => ({
  validateDocument: jest.fn(async (_schema, payload) => payload),
  validateDocuments: jest.fn(async (_schema, payloads) => payloads),
}));

const sourceTest = {
  id: "507f1f77bcf86cd799439011",
  title: "Physics",
  subject: "Physics",
  description: "Mechanics",
  durationMins: 60,
  totalMarks: 20,
  attemptsAllowed: 1,
  evaluationRule: "BEST_ATTEMPT",
  startsAt: new Date("2026-05-20T10:00:00.000Z"),
  endsAt: new Date("2026-05-20T11:00:00.000Z"),
  isGlobal: true,
  collegeId: "507f1f77bcf86cd799439012",
};

const createDb = ({ departmentIds = [], batches = [] } = {}) => {
  const tx = {
    admin: {
      findFirst: jest.fn(async () => ({ id: "507f1f77bcf86cd799439013" })),
    },
    department: {
      findMany: jest.fn(async () => departmentIds.map((id) => ({ id }))),
    },
    batch: {
      findMany: jest.fn(async () => batches),
    },
    test: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }) => ({ id: "507f1f77bcf86cd799439099", ...data })),
    },
    question: {
      findMany: jest.fn(async () => []),
      createMany: jest.fn(),
    },
    testBatch: {
      createMany: jest.fn(),
    },
    cloneMapping: {
      create: jest.fn(),
    },
  };

  return {
    tx,
    db: {
      test: {
        findUnique: jest.fn(async () => sourceTest),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    },
  };
};

describe("clone.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows super-admin department-wise clones when selected departments have no batches", async () => {
    const departmentIds = ["507f1f77bcf86cd799439021", "507f1f77bcf86cd799439022"];
    const { db, tx } = createDb({ departmentIds, batches: [] });
    models.init.mockResolvedValue({ dbClient: db });

    const cloned = await cloneTestToCollege({
      sourceTestId: sourceTest.id,
      destinationCollegeId: "507f1f77bcf86cd799439023",
      assignmentMethod: "department_wise",
      departmentIds,
      superAdminId: "507f1f77bcf86cd799439024",
    });

    expect(cloned.assignmentMethod).toBe("department_wise");
    expect(cloned.assignedTo).toEqual(departmentIds);
    expect(cloned.departmentId).toBeNull();
    expect(cloned.batchId).toBeNull();
    expect(tx.testBatch.createMany).not.toHaveBeenCalled();
  });

  it("allows admin department-wise clones when the department has no batches", async () => {
    const { db, tx } = createDb({ batches: [] });
    models.init.mockResolvedValue({ dbClient: db });

    const cloned = await cloneTestWithinCollege({
      sourceTestId: sourceTest.id,
      collegeId: sourceTest.collegeId,
      assignmentMethod: "department_wise",
      departmentId: "507f1f77bcf86cd799439025",
      adminId: "507f1f77bcf86cd799439026",
    });

    expect(cloned.assignmentMethod).toBe("department_wise");
    expect(cloned.departmentId).toBe("507f1f77bcf86cd799439025");
    expect(cloned.batchId).toBeNull();
    expect(tx.testBatch.createMany).not.toHaveBeenCalled();
  });
});
