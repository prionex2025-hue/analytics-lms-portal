jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../models/validation", () => ({
  UserValidation: function UserValidation() {},
}));

jest.mock("../../services/model-validation.service", () => ({
  validateDocument: jest.fn(async (_Model, payload) => payload),
  validateDocuments: jest.fn(async (_Model, payloads) => payloads),
}));

const models = require("../../models");
const { validateDocument } = require("../../services/model-validation.service");
const { createStudent, updateStudent } = require("../../services/student.service");

describe("student.service duplicate email validation", () => {
  let db;

  beforeEach(() => {
    db = {
      college: {
        findUnique: jest.fn(async () => ({ id: "college-1" })),
      },
      admin: {
        findUnique: jest.fn(async () => null),
      },
      student: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(async ({ data }) => ({ id: "student-created", ...data })),
        update: jest.fn(async ({ data }) => ({ id: "student-1", ...data })),
      },
      auditLog: {
        create: jest.fn(async ({ data }) => ({ id: "audit-1", ...data })),
      },
    };

    models.init.mockResolvedValue({ dbClient: db });
    validateDocument.mockImplementation(async (_Model, payload) => payload);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("rejects createStudent when email already exists in the college", async () => {
    db.student.findFirst.mockResolvedValue({
      id: "existing-student",
      email: "dupe@example.edu",
      collegeId: "college-1",
    });

    await expect(
      createStudent(
        {
          fullName: "Duplicate Student",
          email: "DUPE@example.edu",
          enrollmentNumber: "2024001",
        },
        "college-1",
        null
      )
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "DUPLICATE_EMAIL",
    });

    expect(db.student.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "dupe@example.edu", mode: "insensitive" },
        collegeId: "college-1",
      },
    });
    expect(db.student.create).not.toHaveBeenCalled();
  });

  it("rejects updateStudent when email belongs to another student", async () => {
    db.student.findUnique.mockResolvedValue({
      id: "student-1",
      fullName: "Original Student",
      email: "original@example.edu",
      role: "STUDENT",
      collegeId: "college-1",
      departmentId: null,
      batchId: null,
      batchIds: [],
      year: null,
      isActive: true,
    });
    db.student.findFirst.mockResolvedValue({
      id: "student-2",
      email: "taken@example.edu",
      collegeId: "college-1",
    });

    await expect(
      updateStudent(
        "student-1",
        {
          email: "TAKEN@example.edu",
        },
        "college-1",
        null
      )
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "DUPLICATE_EMAIL",
    });

    expect(db.student.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "taken@example.edu", mode: "insensitive" },
        collegeId: "college-1",
        id: { not: "student-1" },
      },
    });
    expect(db.student.update).not.toHaveBeenCalled();
  });
});
