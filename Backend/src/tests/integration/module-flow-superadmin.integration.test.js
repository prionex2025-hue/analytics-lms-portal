/**
 * Super Admin MODULE_TEST integration test.
 *
 * Drives the real Super Admin controller `createGlobalTest` to create a global
 * MODULE_TEST for a college, verifies the persisted test + questions carry the
 * module config and categories, then runs a student through the created test
 * end to end (start -> advance x3 -> complete -> per-module result) using the
 * real student controllers.
 */
const crypto = require("crypto");
const { describe, it, expect, beforeAll, afterAll } = require("@jest/globals");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

const models = require("../../models");
const { createGlobalTest } = require("../../controllers/SuperAdmin/tests.controller");
const {
  startTest,
  saveAnswer,
  advanceModuleAttempt,
  getAttemptResult,
} = require("../../controllers/Students/tests.controller");

const CLIENT_ID = "sa-integration-client";
const INSTRUCTIONS = "Follow the global module rules.";
const instructionsVersion = crypto.createHash("sha256").update(INSTRUCTIONS).digest("hex").slice(0, 16);

const invoke = (handler, { user, superAdmin, params = {}, body = {}, headers = {} }) =>
  new Promise((resolve, reject) => {
    const req = { user, superAdmin, params, body, headers: { "x-test-client-id": CLIENT_ID, ...headers } };
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
let college;
let department;
let superAdmin;

const modulesInput = [
  { key: "QUANT", durationMins: 2 },
  { key: "REASONING", durationMins: 2 },
  { key: "VERBAL", durationMins: 2 },
];

const q = (category, correct) => ({
  prompt: `${category} question`,
  type: "MCQ",
  options: ["A", "B"],
  correctOption: correct,
  correctBoolean: null,
  correctText: null,
  marks: 1,
  category,
});

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: "moduletest-sa" });
  const m = await models.init();
  db = m.dbClient;

  college = await db.college.create({ data: { name: "SA College", isActive: true } });
  department = await db.department.create({ data: { collegeId: college.id, name: "ECE" } });
  // createGlobalTest needs at least one active admin per targeted college.
  await db.admin.create({
    data: { collegeId: college.id, departmentId: department.id, role: "ADMIN", isActive: true, fullName: "A", email: "a@sa.test" },
  });
  superAdmin = { id: new mongoose.Types.ObjectId().toString() };
}, 60000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
  if (mem) await mem.stop();
});

describe("Super Admin MODULE_TEST (integration)", () => {
  it("creates a global MODULE_TEST and a student completes it with per-module scoring", async () => {
    const now = Date.now();

    // 1) Super Admin creates a global MODULE_TEST.
    const create = await invoke(createGlobalTest, {
      superAdmin,
      body: {
        title: "Global Aptitude Module Test",
        subject: "Aptitude",
        instructions: INSTRUCTIONS,
        assessmentFormat: "MODULE_TEST",
        modules: modulesInput,
        totalMarks: 6,
        attemptsAllowed: 1,
        evaluationRule: "BEST_ATTEMPT",
        startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
        endsAt: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
        publishState: "PUBLISH",
        allColleges: false,
        collegeIds: [college.id],
        assignmentMethod: "department_wise",
        departmentIds: [department.id],
        years: [1, 2, 3, 4],
        questions: [
          q("Quantitative Aptitude", "A"),
          q("Quantitative Aptitude", "B"),
          q("Logical Reasoning", "A"),
          q("Logical Reasoning", "B"),
          q("Verbal", "A"),
          q("Verbal", "B"),
        ],
      },
    });

    expect(create.status).toBe(201);
    const createdTest = create.body.data[0];
    expect(createdTest.assessment_format).toBe("MODULE_TEST");
    expect(createdTest.durationMins).toBe(6); // sum of module durations

    // 2) Persisted test + questions carry module config and categories.
    const testId = createdTest.id;
    const persisted = await db.test.findUnique({ where: { id: testId } });
    expect(persisted.assessmentFormat).toBe("MODULE_TEST");
    expect(persisted.modules.map((mod) => mod.key)).toEqual(["QUANT", "REASONING", "VERBAL"]);
    expect(persisted.modules.every((mod) => mod.durationMins === 2)).toBe(true);

    const persistedQuestions = await db.question.findMany({ where: { testId }, orderBy: { order: "asc" } });
    expect(persistedQuestions).toHaveLength(6);
    const categories = new Set(persistedQuestions.map((question) => question.category));
    expect(categories).toEqual(new Set(["Quantitative Aptitude", "Logical Reasoning", "Verbal"]));

    // 3) Seed a student assigned via department + an instruction agreement.
    const studentId = new mongoose.Types.ObjectId().toString();
    const student = {
      id: studentId,
      collegeId: college.id,
      departmentId: department.id,
      batchIds: [],
      role: "STUDENT",
      isActive: true,
      lifecycleStatus: "ACTIVE",
      year: 1,
    };
    await db.testInstructionAgreement.create({
      data: { userId: studentId, testId, collegeId: college.id, agreedAt: new Date(), instructionsVersion },
    });

    const byCategory = persistedQuestions.reduce((acc, question) => {
      (acc[question.category] = acc[question.category] || []).push(question);
      return acc;
    }, {});

    // 4) Student runs the module flow start -> advance x3 -> complete.
    const start = await invoke(startTest, { user: student, params: { testId }, body: { clientSessionId: CLIENT_ID } });
    expect(start.status).toBe(200);
    expect(start.body.current_module.key).toBe("QUANT");
    expect(start.body.questions.every((question) => question.category === "Quantitative Aptitude")).toBe(true);
    const submissionId = start.body.submission.id;

    const answer = (question) =>
      invoke(saveAnswer, {
        user: student,
        params: { testId },
        body: { submissionId, questionId: question.id, selectedOption: "A", clientSessionId: CLIENT_ID },
      });
    const advance = (fromModuleKey) =>
      invoke(advanceModuleAttempt, {
        user: student,
        params: { testId },
        body: { submissionId, fromModuleKey, clientSessionId: CLIENT_ID },
      });

    await answer(byCategory["Quantitative Aptitude"][0]); // correct
    const adv1 = await advance("QUANT");
    expect(adv1.body.current_module.key).toBe("REASONING");

    await answer(byCategory["Logical Reasoning"][0]); // correct
    const adv2 = await advance("REASONING");
    expect(adv2.body.current_module.key).toBe("VERBAL");

    await answer(byCategory.Verbal[0]); // correct
    const adv3 = await advance("VERBAL");
    expect(adv3.body.completed).toBe(true);

    // 5) Result carries per-module sections + overall aggregates.
    const result = await invoke(getAttemptResult, { user: student, params: { attemptId: submissionId } });
    expect(result.body.assessment_format).toBe("MODULE_TEST");
    expect(result.body.sections).toHaveLength(3);
    expect(result.body.overall_max_score).toBe(6);
    expect(result.body.score).toBe(3); // one correct per module
    const quant = result.body.sections.find((section) => section.key === "QUANT");
    expect(quant).toMatchObject({ score: 1, max_score: 2 });
  }, 30000);
});
