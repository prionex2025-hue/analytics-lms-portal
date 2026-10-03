/**
 * Academic-integrity regression for the module flow.
 *
 * The whole-test deadline (testSession.expiresAt) is absolute, and is NOT the same
 * as the per-module deadline (moduleExpiresAt). advanceModule() previously checked
 * only the module deadline, then finalized the attempt with
 * completeSubmission({ autoSubmitted: false }). A student who let the overall clock
 * run out could therefore keep clicking "Submit Section & Continue" and have the
 * final module recorded as MANUAL_SUBMIT, effectively receiving time beyond the
 * hard cap.
 *
 * These tests pin the corrected contract:
 *  - past the hard cap -> the attempt finalizes as an auto-submit, not a manual one
 *  - past the hard cap -> no further module is unlocked
 *  - before the hard cap -> a normal manual advance is untouched
 *  - an explicit auto-submit still behaves as before
 */

jest.mock("../../services/test.service", () => ({
  completeSubmission: jest.fn(async () => ({ submission: { id: "sub-1", status: "SUBMITTED" } })),
  calculateSubmissionScore: jest.fn(async () => ({ totalScore: 3, maxScore: 10 })),
}));

const { completeSubmission } = require("../../services/test.service");
const { advanceModule } = require("../../services/module-attempt.service");

const T0 = new Date("2026-01-01T10:00:00.000Z").getTime();
const MIN = 60 * 1000;

const buildTest = () => ({
  modules: [
    { key: "m1", order: 1, durationMins: 10 },
    { key: "m2", order: 2, durationMins: 10 },
  ],
});

const buildSession = ({ moduleExpiresAt, expiresAt }) => ({
  currentModuleKey: "m2",
  moduleExpiresAt: new Date(moduleExpiresAt),
  expiresAt: new Date(expiresAt),
});

const buildSubmission = () => ({
  id: "sub-1",
  userId: "u1",
  testId: "t1",
  currentModuleKey: "m2",
  status: "IN_PROGRESS",
  moduleState: [
    { key: "m1", order: 1, status: "MANUAL_SUBMIT", startedAt: new Date(T0), endedAt: new Date(T0 + 10 * MIN), timeTakenSeconds: 600, score: 3, maxScore: 5, percentage: 60 },
    { key: "m2", order: 2, status: "ACTIVE", startedAt: new Date(T0 + 10 * MIN), endedAt: null, timeTakenSeconds: 0, score: 0, maxScore: 5, percentage: 0 },
  ],
});

const buildDb = () => ({
  submission: {
    updateMany: jest.fn(async () => ({ count: 1 })),
    findUnique: jest.fn(async () => buildSubmission()),
  },
  testSession: { updateMany: jest.fn(async () => ({ count: 1 })) },
});

const runAdvance = async ({ now, session }) => {
  const db = buildDb();
  const result = await advanceModule({
    db,
    test: buildTest(),
    submission: buildSubmission(),
    session,
    fromModuleKey: "m2",
    now: new Date(now),
    autoSubmitted: false,
  });
  return { db, result };
};

beforeEach(() => jest.clearAllMocks());

describe("advanceModule whole-test deadline enforcement", () => {
  it("finalizes as an auto-submit once the hard cap has passed", async () => {
    // Whole test expired at T0+15m; the student clicks submit at T0+18m.
    const { result } = await runAdvance({
      now: T0 + 18 * MIN,
      session: buildSession({ moduleExpiresAt: T0 + 20 * MIN, expiresAt: T0 + 15 * MIN }),
    });

    expect(result.status).toBe("COMPLETED");
    expect(completeSubmission).toHaveBeenCalledTimes(1);
    expect(completeSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: "sub-1", autoSubmitted: true })
    );
  });

  it("does not unlock another module after the hard cap", async () => {
    const { db, result } = await runAdvance({
      now: T0 + 18 * MIN,
      session: buildSession({ moduleExpiresAt: T0 + 20 * MIN, expiresAt: T0 + 15 * MIN }),
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.status).not.toBe("ADVANCED");
    // currentModuleKey must not be pushed to a new module.
    expect(db.submission.updateMany.mock.calls[0][0].data.currentModuleKey).toBeUndefined();
  });

  it("marks the timed-out module as EXPIRED", async () => {
    const { db } = await runAdvance({
      now: T0 + 18 * MIN,
      session: buildSession({ moduleExpiresAt: T0 + 20 * MIN, expiresAt: T0 + 15 * MIN }),
    });

    const moduleState = db.submission.updateMany.mock.calls[0][0].data.moduleState;
    const finalModule = moduleState.find((m) => m.key === "m2");
    expect(finalModule.status).toBe("EXPIRED");
  });

  it("preserves a normal manual advance before the deadline", async () => {
    const { db, result } = await runAdvance({
      now: T0 + 12 * MIN,
      session: buildSession({ moduleExpiresAt: T0 + 20 * MIN, expiresAt: T0 + 30 * MIN }),
    });

    expect(result.status).toBe("COMPLETED");
    // On the last module with time left, this stays a manual submission.
    expect(completeSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ autoSubmitted: false })
    );
    expect(db.submission.updateMany.mock.calls[0][0].data.moduleState.find((m) => m.key === "m2").status)
      .toBe("MANUAL_SUBMIT");
  });

  it("still auto-submits when the caller says so, before any deadline", async () => {
    const db = buildDb();
    await advanceModule({
      db,
      test: buildTest(),
      submission: buildSubmission(),
      session: buildSession({ moduleExpiresAt: T0 + 20 * MIN, expiresAt: T0 + 30 * MIN }),
      fromModuleKey: "m2",
      now: new Date(T0 + 11 * MIN),
      autoSubmitted: true,
    });

    expect(completeSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ autoSubmitted: true })
    );
  });

  it("treats a stale duplicate request as idempotent", async () => {
    const db = buildDb();
    const result = await advanceModule({
      db,
      test: buildTest(),
      submission: buildSubmission(),
      session: buildSession({ moduleExpiresAt: T0 + 20 * MIN, expiresAt: T0 + 30 * MIN }),
      fromModuleKey: "m1",
      now: new Date(T0 + 11 * MIN),
      autoSubmitted: false,
    });

    expect(result.status).toBe("IDEMPOTENT");
    expect(completeSubmission).not.toHaveBeenCalled();
  });
});
