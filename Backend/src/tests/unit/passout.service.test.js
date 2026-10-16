jest.mock("../../models", () => ({ init: jest.fn() }));
jest.mock("../../services/redis-lock.service", () => ({ withRedisLock: jest.fn(({ task }) => task({ lockAcquired: false })) }));
jest.mock("../../services/audit.service", () => ({ createAuditLog: jest.fn() }));
jest.mock("../../services/auth-revocation.service", () => ({ bumpPrincipalTokenVersion: jest.fn(), invalidatePrincipalAuthCache: jest.fn() }));
jest.mock("../../services/refresh-token-cache.service", () => ({ invalidateRefreshTokenRecord: jest.fn() }));

const {
  buildStudentWhere,
  buildIdempotencyKey,
  previewPassout,
  createPassoutJob,
} = require("../../services/passout.service");

describe("passout service", () => {
  test("filters by the stored year and fixed March month, never by a batch name", () => {
    expect(buildStudentWhere({ collegeId: "college-1", year: 2027 })).toEqual(expect.objectContaining({
      collegeId: "college-1",
      expectedPassoutYear: 2027,
      expectedPassoutMonth: 3,
      studentStatus: "ACTIVE",
    }));
    expect(buildStudentWhere({ collegeId: "college-1", year: 2027, batchIds: ["batch-1"] })).toEqual(expect.objectContaining({
      expectedPassoutYear: 2027,
      expectedPassoutMonth: 3,
      studentStatus: "ACTIVE",
      OR: expect.arrayContaining([{ batchId: "batch-1" }]),
    }));
  });

  test("idempotency keys are stable for the same promotion scope", () => {
    const input = { collegeId: "c1", passoutYear: 2027, scopeType: "INDIVIDUAL", studentIds: ["b", "a"], batchIds: [] };
    expect(buildIdempotencyKey(input)).toBe(buildIdempotencyKey({ ...input, studentIds: ["a", "b"] }));
  });

  test("preview reports unfinished submissions as explicit exceptions", async () => {
    const db = {
      student: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ id: "student-1", fullName: "Ada", batches: [], department: { name: "CS" } }]),
      },
      submission: { count: jest.fn((args) => Promise.resolve(args.where.status === "IN_PROGRESS" ? 1 : 2)), findMany: jest.fn().mockResolvedValue([{ id: "submission-1" }]) },
      answer: { count: jest.fn().mockResolvedValue(4) },
      testSession: { count: jest.fn().mockResolvedValue(1) },
      batch: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const result = await previewPassout({ db, collegeId: "c1", passoutYear: 2027 });
    expect(result.data[0].expectedPassoutMonth).toBe(3);
    expect(result.exceptions.incompleteAttempts).toEqual([{ studentId: "student-1", count: 1 }]);
  });

  test("duplicate promotion requests reuse the durable job", async () => {
    const existing = { id: "job-1", idempotencyKey: "same" };
    const db = {
      passoutJob: {
        findFirst: jest.fn().mockResolvedValueOnce(existing),
        create: jest.fn(),
      },
    };
    const result = await createPassoutJob({ db, collegeId: "c1", passoutYear: 2027, scopeType: "INDIVIDUAL", studentIds: ["s1"], initiatedBy: "admin-1", reason: "verified", confirmed: true });
    expect(result.reused).toBe(true);
    expect(result.job).toBe(existing);
    expect(db.passoutJob.create).not.toHaveBeenCalled();
  });
});
