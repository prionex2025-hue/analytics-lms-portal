/**
 * Full MODULE_TEST lifecycle integration test.
 *
 * Boots an in-memory MongoDB, seeds a published MODULE_TEST with categorized
 * questions, then drives the ACTUAL student controllers end to end:
 *   start -> (guard) -> save Quant -> advance -> save Reasoning -> advance
 *   -> save Verbal -> advance (completes) -> result with per-module sections.
 *
 * Redis and Socket.IO are absent, so locks run inline and emits are no-ops
 * (production fail-open behavior). Mongo is the source of truth throughout.
 */
const crypto = require("crypto");
const { describe, it, expect, beforeAll, afterAll } = require("@jest/globals");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

const models = require("../../models");
const {
  startTest,
  saveAnswer,
  advanceModuleAttempt,
  getAttemptResult,
  getSession,
} = require("../../controllers/Students/tests.controller");

const CLIENT_ID = "integration-client-1";
const INSTRUCTIONS = "Follow the module rules.";
const instructionsVersion = crypto.createHash("sha256").update(INSTRUCTIONS).digest("hex").slice(0, 16);

// Invoke an asyncHandler-wrapped controller with a mock req/res.
const invoke = (handler, { user, params = {}, body = {}, headers = {} }) =>
  new Promise((resolve, reject) => {
    const req = { user, params, body, headers: { "x-test-client-id": CLIENT_ID, ...headers } };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };
    Promise.resolve(handler(req, res, (err) => reject(err))).catch(reject);
  });

let mem;
let db;
let student;
let test;
let questionsByCategory;

const seed = async () => {
  const college = await db.college.create({ data: { name: "Integration College", isActive: true } });
  const department = await db.department.create({ data: { collegeId: college.id, name: "CSE" } });
  const admin = await db.admin.create({
    data: { collegeId: college.id, departmentId: department.id, role: "ADMIN", isActive: true, fullName: "Admin", email: "admin@int.test" },
  });

  const now = Date.now();
  test = await db.test.create({
    data: {
      title: "Aptitude Module Test",
      subject: "Aptitude",
      instructions: INSTRUCTIONS,
      collegeId: college.id,
      departmentId: department.id,
      createdByAdminId: admin.id,
      assessmentFormat: "MODULE_TEST",
      modules: [
        { key: "QUANT", name: "Quantitative Aptitude", order: 1, category: "Quantitative Aptitude", durationMins: 2 },
        { key: "REASONING", name: "Logical Reasoning", order: 2, category: "Logical Reasoning", durationMins: 2 },
        { key: "VERBAL", name: "Verbal", order: 3, category: "Verbal", durationMins: 2 },
      ],
      durationMins: 6,
      totalMarks: 6,
      attemptsAllowed: 1,
      evaluationRule: "BEST_ATTEMPT",
      assignmentMethod: "everyone",
      years: [],
      isPublished: true,
      status: "LIVE",
      startsAt: new Date(now - 60 * 60 * 1000),
      endsAt: new Date(now + 3 * 60 * 60 * 1000),
    },
  });

  const mkQ = (category, order, correct) => ({
    testId: test.id,
    collegeId: college.id,
    prompt: `${category} question ${order}`,
    type: "MCQ",
    options: ["A", "B"],
    correctOption: correct,
    marks: 1,
    order,
    category,
  });

  await db.question.createMany({
    data: [
      mkQ("Quantitative Aptitude", 1, "A"),
      mkQ("Quantitative Aptitude", 2, "B"),
      mkQ("Logical Reasoning", 3, "A"),
      mkQ("Logical Reasoning", 4, "B"),
      mkQ("Verbal", 5, "A"),
      mkQ("Verbal", 6, "B"),
    ],
  });

  const allQuestions = await db.question.findMany({ where: { testId: test.id }, orderBy: { order: "asc" } });
  questionsByCategory = allQuestions.reduce((acc, q) => {
    (acc[q.category] = acc[q.category] || []).push(q);
    return acc;
  }, {});

  const studentId = new mongoose.Types.ObjectId().toString();
  student = {
    id: studentId,
    collegeId: college.id,
    departmentId: department.id,
    batchIds: [],
    role: "STUDENT",
    isActive: true,
    lifecycleStatus: "ACTIVE",
    year: 1,
    fullName: "Test Student",
  };

  await db.testInstructionAgreement.create({
    data: { userId: studentId, testId: test.id, collegeId: college.id, agreedAt: new Date(), instructionsVersion },
  });
};

describe("MODULE_TEST full lifecycle (integration)", () => {
  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri(), { dbName: "moduletest" });
    const m = await models.init();
    db = m.dbClient;
    await seed();
  }, 60000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
    if (mem) await mem.stop();
  });

  it("runs Quant -> Reasoning -> Verbal -> Completed with per-module timers and scoring", async () => {
    // 1) START -> only Quant questions, module timeline present.
    const start = await invoke(startTest, {
      user: student,
      params: { testId: test.id },
      body: { clientSessionId: CLIENT_ID },
    });
    expect(start.status).toBe(200);
    expect(start.body.assessment_format).toBe("MODULE_TEST");
    expect(start.body.current_module.key).toBe("QUANT");
    expect(start.body.questions).toHaveLength(2);
    expect(start.body.questions.every((q) => q.category === "Quantitative Aptitude")).toBe(true);
    expect(start.body.modules.map((m) => m.key)).toEqual(["QUANT", "REASONING", "VERBAL"]);

    const submissionId = start.body.submission.id;
    const quantEnd = start.body.server_module_end_time;
    // Quant window ~2 minutes from now.
    expect(quantEnd - Date.now()).toBeGreaterThan(60 * 1000);
    expect(quantEnd - Date.now()).toBeLessThan(150 * 1000);

    // 2) SAVE a correct Quant answer.
    const quantQ = questionsByCategory["Quantitative Aptitude"][0]; // correctOption "A"
    const saveQuant = await invoke(saveAnswer, {
      user: student,
      params: { testId: test.id },
      body: { submissionId, questionId: quantQ.id, selectedOption: "A", clientSessionId: CLIENT_ID },
    });
    expect(saveQuant.status).toBe(200);

    // 3) GUARD: saving a Verbal (future-module) question while in Quant is rejected.
    const verbalQ = questionsByCategory.Verbal[0];
    await expect(
      invoke(saveAnswer, {
        user: student,
        params: { testId: test.id },
        body: { submissionId, questionId: verbalQ.id, selectedOption: "A", clientSessionId: CLIENT_ID },
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "QUESTION_NOT_IN_ACTIVE_MODULE" });

    // 4) ADVANCE Quant -> Reasoning; fresh 2-minute window (no carry-over).
    const adv1 = await invoke(advanceModuleAttempt, {
      user: student,
      params: { testId: test.id },
      body: { submissionId, fromModuleKey: "QUANT", clientSessionId: CLIENT_ID },
    });
    expect(adv1.status).toBe(200);
    expect(adv1.body.advanced).toBe(true);
    expect(adv1.body.completed).toBe(false);
    expect(adv1.body.current_module.key).toBe("REASONING");
    expect(adv1.body.questions.every((q) => q.category === "Logical Reasoning")).toBe(true);
    const reasoningEnd = adv1.body.server_module_end_time;
    // Fresh ~2 min, NOT ~4 min (would be the case if Quant's leftover carried over).
    expect(reasoningEnd - Date.now()).toBeGreaterThan(60 * 1000);
    expect(reasoningEnd - Date.now()).toBeLessThan(150 * 1000);

    // 4b) IDEMPOTENCY: re-advancing from the now-stale QUANT key does not skip a module.
    const advDup = await invoke(advanceModuleAttempt, {
      user: student,
      params: { testId: test.id },
      body: { submissionId, fromModuleKey: "QUANT", clientSessionId: CLIENT_ID },
    });
    expect(advDup.body.idempotent).toBe(true);
    expect(advDup.body.current_module.key).toBe("REASONING");

    // 5) SAVE a correct Reasoning answer.
    const reasoningQ = questionsByCategory["Logical Reasoning"][0]; // "A"
    await invoke(saveAnswer, {
      user: student,
      params: { testId: test.id },
      body: { submissionId, questionId: reasoningQ.id, selectedOption: "A", clientSessionId: CLIENT_ID },
    });

    // 6) ADVANCE Reasoning -> Verbal.
    const adv2 = await invoke(advanceModuleAttempt, {
      user: student,
      params: { testId: test.id },
      body: { submissionId, fromModuleKey: "REASONING", clientSessionId: CLIENT_ID },
    });
    expect(adv2.body.current_module.key).toBe("VERBAL");
    expect(adv2.body.questions.every((q) => q.category === "Verbal")).toBe(true);

    // 7) SAVE a correct Verbal answer.
    const verbalCorrect = questionsByCategory.Verbal[0]; // "A"
    await invoke(saveAnswer, {
      user: student,
      params: { testId: test.id },
      body: { submissionId, questionId: verbalCorrect.id, selectedOption: "A", clientSessionId: CLIENT_ID },
    });

    // 8) ADVANCE Verbal (last) -> completes the whole attempt.
    const adv3 = await invoke(advanceModuleAttempt, {
      user: student,
      params: { testId: test.id },
      body: { submissionId, fromModuleKey: "VERBAL", clientSessionId: CLIENT_ID },
    });
    expect(adv3.body.completed).toBe(true);
    expect(adv3.body.summary).toBeTruthy();

    // 9) RESULT: per-module sections + overall aggregates.
    const result = await invoke(getAttemptResult, {
      user: student,
      params: { attemptId: submissionId },
    });
    expect(result.status).toBe(200);
    expect(result.body.assessment_format).toBe("MODULE_TEST");
    expect(result.body.sections).toHaveLength(3);

    const byKey = Object.fromEntries(result.body.sections.map((s) => [s.key, s]));
    expect(byKey.QUANT).toMatchObject({ score: 1, max_score: 2 });
    expect(byKey.REASONING).toMatchObject({ score: 1, max_score: 2 });
    expect(byKey.VERBAL).toMatchObject({ score: 1, max_score: 2 });
    expect(result.body.overall_max_score).toBe(6);
    expect(result.body.score).toBe(3);
    // Each finalized module carries a status and configured duration.
    result.body.sections.forEach((section) => {
      expect(section.configured_duration_mins).toBe(2);
      expect(["MANUAL_SUBMIT", "AUTO_SUBMIT", "EXPIRED", "COMPLETED"]).toContain(section.status);
    });

    // 10) Post-completion: the session is closed, so any further save is rejected.
    await expect(
      invoke(saveAnswer, {
        user: student,
        params: { testId: test.id },
        body: { submissionId, questionId: verbalCorrect.id, selectedOption: "B", clientSessionId: CLIENT_ID },
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "NO_ACTIVE_SESSION" });
  }, 30000);

  it("auto-advances an expired module on resume (server-authoritative timer)", async () => {
    // A fresh student for a new attempt on the same published test.
    const studentId = new mongoose.Types.ObjectId().toString();
    const student2 = { ...student, id: studentId };
    await db.testInstructionAgreement.create({
      data: { userId: studentId, testId: test.id, collegeId: student.collegeId, agreedAt: new Date(), instructionsVersion },
    });

    const start = await invoke(startTest, {
      user: student2,
      params: { testId: test.id },
      body: { clientSessionId: CLIENT_ID },
    });
    expect(start.body.current_module.key).toBe("QUANT");
    const submissionId = start.body.submission.id;

    // Simulate the Quant module timer elapsing while the student was away by
    // moving the server-side per-module deadline into the past (Mongo authority).
    const past = new Date(Date.now() - 5000);
    await db.testSession.updateMany({ where: { userId: studentId, testId: test.id }, data: { moduleExpiresAt: past } });
    await db.submission.updateMany({ where: { id: submissionId }, data: { moduleExpiresAt: past } });

    // On resume (getSession), the server auto-advances the expired module.
    const resumed = await invoke(getSession, {
      user: student2,
      params: { testId: test.id },
      body: { clientSessionId: CLIENT_ID },
    });
    expect(resumed.status).toBe(200);
    expect(resumed.body.current_module.key).toBe("REASONING");
    // getSession nests the active-module questions under `test.questions`.
    const resumedQuestions = resumed.body.test?.questions || [];
    expect(resumedQuestions.length).toBe(2);
    expect(resumedQuestions.every((q) => q.category === "Logical Reasoning")).toBe(true);

    // The expired Quant module is recorded as EXPIRED in the attempt state.
    const submission = await db.submission.findUnique({ where: { id: submissionId } });
    const quantState = (submission.moduleState || []).find((m) => m.key === "QUANT");
    expect(quantState.status).toBe("EXPIRED");
  }, 30000);
});
