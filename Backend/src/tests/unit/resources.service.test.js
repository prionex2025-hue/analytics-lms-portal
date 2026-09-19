const path = require("path");

process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/lms_test";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "a".repeat(48);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "b".repeat(48);

jest.mock("../../models", () => ({
  init: jest.fn(),
}));

const models = require("../../models");
const {
  assertSafeStoredPath,
  buildSubjectWhereForActor,
  buildVisibilityWhereForActor,
  canAccessResource,
  createResourceSubject,
  normalizeResourcePayload,
} = require("../../modules/resources/services/resource.service");

describe("learning resources service", () => {
  beforeEach(() => {
    models.init.mockReset();
  });

  it("grants students access only through matching college visibility scopes", () => {
    const student = {
      id: "student-1",
      role: "STUDENT",
      collegeId: "college-1",
      departmentId: "dept-1",
      batchIds: ["batch-1"],
    };

    expect(canAccessResource(student, {
      collegeId: "college-1",
      visibilityScope: "COLLEGE",
      isActive: true,
    })).toBe(true);

    expect(canAccessResource(student, {
      collegeId: "college-1",
      visibilityScope: "DEPARTMENT",
      departmentIds: ["dept-2"],
      isActive: true,
    })).toBe(false);

    expect(canAccessResource(student, {
      collegeId: "college-1",
      visibilityScope: "BATCH",
      batchIds: ["batch-1"],
      isActive: true,
    })).toBe(true);
  });

  it("builds department-admin queries with college and department isolation", () => {
    const where = buildVisibilityWhereForActor({
      id: "admin-1",
      role: "ADMIN",
      collegeId: "college-1",
      departmentId: "dept-1",
      batchIds: [],
    });

    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { isActive: { not: false } },
        {
          OR: expect.arrayContaining([
            { collegeId: "college-1", departmentIds: { in: ["dept-1"] } },
            { collegeId: "college-1", uploadedBy: "admin-1" },
          ]),
        },
      ]),
    });
  });

  it("normalizes comma-separated upload fields", () => {
    const payload = normalizeResourcePayload({
      title: "Placement Guide",
      subjectId: "subject-1",
      resourceType: "google drive url",
      visibilityScope: "batch",
      batchIds: "batch-1, batch-2",
      tags: "aptitude, placement",
    });

    expect(payload).toMatchObject({
      resourceType: "GOOGLE_DRIVE_URL",
      visibilityScope: "BATCH",
      batchIds: ["batch-1", "batch-2"],
      tags: ["aptitude", "placement"],
    });
  });

  it("rejects stored file paths outside the upload root", () => {
    const outside = path.resolve(process.cwd(), "..", "secret.pdf");

    expect(() => assertSafeStoredPath(outside)).toThrow(expect.objectContaining({
      code: "UNSAFE_RESOURCE_PATH",
    }));
  });

  it("includes manual global subjects in learning resource lookups", () => {
    expect(buildSubjectWhereForActor({
      role: "STUDENT",
      collegeId: "college-1",
    })).toEqual({
      AND: [
        { resourceSubjectScope: { in: ["GLOBAL", "COLLEGE"] } },
        { OR: [{ collegeId: null }, { collegeId: "college-1" }] },
      ],
    });

    expect(buildSubjectWhereForActor({
      role: "SUPER_ADMIN",
      collegeId: null,
    })).toEqual({
      AND: [
        { resourceSubjectScope: { in: ["GLOBAL", "COLLEGE"] } },
        { collegeId: null },
      ],
    });

    expect(buildSubjectWhereForActor({
      role: "SUPER_ADMIN",
      collegeId: null,
    }, { collegeId: "college-2" })).toEqual({
      AND: [
        { resourceSubjectScope: { in: ["GLOBAL", "COLLEGE"] } },
        { OR: [{ collegeId: null }, { collegeId: "college-2" }] },
      ],
    });
  });

  it("creates global subjects through super admins and college subjects through admins", async () => {
    const db = {
      subject: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
          .mockResolvedValueOnce({
            id: "subject-global",
            name: "Placement Preparation",
            collegeId: null,
          })
          .mockResolvedValueOnce({
            id: "subject-1",
            name: "Data Structures",
            collegeId: "college-1",
          }),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    await expect(createResourceSubject({
      actor: { id: "super-1", role: "SUPER_ADMIN", collegeId: null },
      body: { name: "Placement Preparation" },
    })).resolves.toMatchObject({ id: "subject-global" });

    await expect(createResourceSubject({
      actor: { id: "admin-1", role: "ADMIN", collegeId: "college-1" },
      body: { name: "Data Structures" },
    })).resolves.toMatchObject({ id: "subject-1" });

    expect(db.subject.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        name: "Placement Preparation",
        collegeId: null,
        createdByAdminId: null,
        createdBySuperAdminId: "super-1",
        resourceSubjectScope: "GLOBAL",
      }),
    });
    expect(db.subject.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        name: "Data Structures",
        collegeId: "college-1",
        createdByAdminId: "admin-1",
        createdBySuperAdminId: null,
        resourceSubjectScope: "COLLEGE",
      }),
    });
  });

  it("checks duplicate resource subjects within the resource subject scope only", async () => {
    const db = {
      subject: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "subject-1",
          name: "Aptitude",
          collegeId: "college-1",
        }),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    await createResourceSubject({
      actor: { id: "admin-1", role: "ADMIN", collegeId: "college-1" },
      body: { name: "Aptitude" },
    });

    expect(db.subject.findFirst).toHaveBeenCalledWith({
      where: {
        collegeId: "college-1",
        resourceSubjectScope: "COLLEGE",
        name: { equals: "Aptitude", mode: "insensitive" },
      },
    });
  });
});
