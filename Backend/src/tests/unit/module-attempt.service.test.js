jest.mock("../../services/test.service", () => ({
  completeSubmission: jest.fn(async () => ({ submission: { id: "sub-1", status: "SUBMITTED" }, summary: { score: 7 } })),
  calculateSubmissionScore: jest.fn(async () => ({ score: 7 })),
}));

const { completeSubmission } = require("../../services/test.service");
const {
  buildInitialModuleState,
  advanceModule,
  autoAdvanceExpiredModules,
  filterQuestionsForModule,
  getNextModule,
  getModuleByKey,
} = require("../../services/module-attempt.service");

const TEST = {
  assessmentFormat: "MODULE_TEST",
  modules: [
    { key: "QUANT", name: "Quantitative Aptitude", order: 1, category: "Quantitative Aptitude", durationMins: 30 },
    { key: "REASONING", name: "Logical Reasoning", order: 2, category: "Logical Reasoning", durationMins: 25 },
    { key: "VERBAL", name: "Verbal", order: 3, category: "Verbal", durationMins: 20 },
  ],
};

const buildDb = () => ({
  submission: {
    updateMany: jest.fn(async () => ({ count: 1 })),
    findUnique: jest.fn(async () => ({ id: "sub-1", status: "IN_PROGRESS", currentModuleKey: "REASONING" })),
  },
  testSession: {
    updateMany: jest.fn(async () => ({ count: 1 })),
    findUnique: jest.fn(async () => null),
  },
});

describe("module-attempt state machine", () => {
  beforeEach(() => jest.clearAllMocks());

  it("initializes the first module active with per-module and whole-test deadlines", () => {
    const start = new Date("2025-01-01T10:00:00.000Z");
    const init = buildInitialModuleState(TEST, start);

    expect(init.currentModuleKey).toBe("QUANT");
    expect(init.moduleState.map((m) => m.status)).toEqual(["ACTIVE", "NOT_STARTED", "NOT_STARTED"]);
    expect(new Date(init.moduleExpiresAt).getTime()).toBe(start.getTime() + 30 * 60000);
    expect(new Date(init.expiresAt).getTime()).toBe(start.getTime() + 75 * 60000);
  });

  it("filters questions to the active module category", () => {
    const questions = [
      { id: "a", category: "Quantitative Aptitude" },
      { id: "b", category: "Verbal" },
      { id: "c", category: "Quantitative Aptitude" },
    ];
    const quant = getModuleByKey(TEST, "QUANT");
    expect(filterQuestionsForModule(questions, quant).map((q) => q.id)).toEqual(["a", "c"]);
  });

  it("advances to the next module giving it a FRESH deadline (no carry-over)", async () => {
    const db = buildDb();
    const now = new Date("2025-01-01T10:10:00.000Z"); // 20 min early in QUANT
    const submission = {
      id: "sub-1",
      userId: "u1",
      testId: "t1",
      status: "IN_PROGRESS",
      currentModuleKey: "QUANT",
      moduleState: buildInitialModuleState(TEST, new Date("2025-01-01T10:00:00.000Z")).moduleState,
    };
    const session = {
      moduleExpiresAt: new Date("2025-01-01T10:30:00.000Z"), // 10 min left, unused
      expiresAt: new Date("2025-01-01T11:15:00.000Z"),
    };

    const result = await advanceModule({ db, test: TEST, submission, session, fromModuleKey: "QUANT", now });

    expect(result.status).toBe("ADVANCED");
    expect(result.nextModule.key).toBe("REASONING");
    // Fresh 25-minute window from `now`, NOT now + leftover.
    expect(new Date(result.moduleExpiresAt).getTime()).toBe(now.getTime() + 25 * 60000);

    const writeArgs = db.submission.updateMany.mock.calls[0][0];
    expect(writeArgs.where).toMatchObject({ currentModuleKey: "QUANT", status: "IN_PROGRESS" });
    expect(writeArgs.data.currentModuleKey).toBe("REASONING");
    expect(completeSubmission).not.toHaveBeenCalled();
  });

  it("completes the whole attempt when the last module is submitted", async () => {
    const db = buildDb();
    const submission = {
      id: "sub-1",
      userId: "u1",
      testId: "t1",
      status: "IN_PROGRESS",
      currentModuleKey: "VERBAL",
      moduleState: buildInitialModuleState(TEST, new Date()).moduleState.map((m) =>
        m.key === "VERBAL" ? { ...m, status: "ACTIVE", startedAt: new Date() } : m
      ),
    };
    const session = { moduleExpiresAt: new Date(Date.now() + 60000), expiresAt: new Date(Date.now() + 60000) };

    const result = await advanceModule({ db, test: TEST, submission, session, fromModuleKey: "VERBAL", now: new Date() });

    expect(result.status).toBe("COMPLETED");
    expect(completeSubmission).toHaveBeenCalledWith(expect.objectContaining({ submissionId: "sub-1" }));
  });

  it("is idempotent when fromModuleKey no longer matches the current module", async () => {
    const db = buildDb();
    const submission = { id: "sub-1", userId: "u1", testId: "t1", status: "IN_PROGRESS", currentModuleKey: "REASONING", moduleState: [] };
    const session = { moduleExpiresAt: new Date(Date.now() + 60000), expiresAt: new Date(Date.now() + 60000) };

    const result = await advanceModule({ db, test: TEST, submission, session, fromModuleKey: "QUANT", now: new Date() });

    expect(result.status).toBe("IDEMPOTENT");
    expect(db.submission.updateMany).not.toHaveBeenCalled();
  });

  it("returns IDEMPOTENT when a concurrent writer already advanced (conditional write matched 0)", async () => {
    const db = buildDb();
    db.submission.updateMany = jest.fn(async () => ({ count: 0 }));
    db.submission.findUnique = jest.fn(async () => ({ id: "sub-1", status: "IN_PROGRESS", currentModuleKey: "REASONING" }));
    const submission = { id: "sub-1", userId: "u1", testId: "t1", status: "IN_PROGRESS", currentModuleKey: "QUANT", moduleState: buildInitialModuleState(TEST, new Date()).moduleState };
    const session = { moduleExpiresAt: new Date(Date.now() + 60000), expiresAt: new Date(Date.now() + 999999) };

    const result = await advanceModule({ db, test: TEST, submission, session, fromModuleKey: "QUANT", now: new Date() });
    expect(result.status).toBe("IDEMPOTENT");
  });

  it("auto-advances an expired module on resume", async () => {
    const db = buildDb();
    const expiredSession = { moduleExpiresAt: new Date(Date.now() - 60000), expiresAt: new Date(Date.now() + 999999) };
    const submission = {
      id: "sub-1",
      userId: "u1",
      testId: "t1",
      status: "IN_PROGRESS",
      currentModuleKey: "QUANT",
      moduleState: buildInitialModuleState(TEST, new Date(Date.now() - 120000)).moduleState,
    };

    // After one advance, reloaded state points at REASONING with a fresh (future) deadline.
    const advancedSubmission = { ...submission, currentModuleKey: "REASONING" };
    const advancedSession = { moduleExpiresAt: new Date(Date.now() + 25 * 60000), expiresAt: expiredSession.expiresAt, endedAt: null };

    const out = await autoAdvanceExpiredModules({
      db,
      test: TEST,
      submission,
      session: expiredSession,
      now: new Date(),
      reloadSubmission: async () => advancedSubmission,
      reloadSession: async () => advancedSession,
    });

    expect(db.submission.updateMany).toHaveBeenCalledTimes(1);
    expect(out.submission.currentModuleKey).toBe("REASONING");
  });

  it("getNextModule respects fixed order and stops at the last module", () => {
    expect(getNextModule(TEST, "QUANT").key).toBe("REASONING");
    expect(getNextModule(TEST, "REASONING").key).toBe("VERBAL");
    expect(getNextModule(TEST, "VERBAL")).toBeNull();
  });
});
