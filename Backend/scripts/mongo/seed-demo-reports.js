#!/usr/bin/env node

/**
 * Demo dataset for the Super Admin reports module.
 *
 * Creates one self-contained college ("Demo Reports College", code DEMO-RPT)
 * with departments, batches, students, two completed tests - one OPEN_TEST and
 * one MODULE_TEST - plus realistic submissions, per-question answers, module
 * state and a few proctoring violations. Nothing outside that college is
 * touched.
 *
 * Usage:
 *   node scripts/mongo/seed-demo-reports.js              # create only if absent
 *   node scripts/mongo/seed-demo-reports.js --reset     # drop the demo college first
 *   node scripts/mongo/seed-demo-reports.js --dry-run    # report what it would do
 *
 * The run is deterministic (fixed PRNG seed), so the same numbers come out
 * every time and the generated reports are reproducible.
 */

require("dotenv").config();

const bcrypt = require("bcrypt");
const dbClient = require("../../src/config/db");

const DRY_RUN = process.argv.includes("--dry-run");
const RESET = process.argv.includes("--reset");

const DEMO_COLLEGE_CODE = "DEMO-RPT";
const DEMO_COLLEGE_NAME = "Demo Reports College";
const DEMO_ADMIN_EMAIL = "demo.college.admin@demoreports.test";
const DEMO_ADMIN_PASSWORD = "DemoAdmin@2025";
const DEMO_STUDENT_PASSWORD = "Demo@2025";

const DEPARTMENTS = [
  { name: "Computer Science and Engineering", code: "CSE" },
  { name: "Electronics and Communication Engineering", code: "ECE" },
  { name: "Mechanical Engineering", code: "MECH" },
];

const BATCHES = [
  { name: "CSE 2023 A", departmentCode: "CSE", academicYear: "2023-2024", section: "A", year: 2, students: 8 },
  { name: "CSE 2024 A", departmentCode: "CSE", academicYear: "2024-2025", section: "A", year: 2, students: 6 },
  { name: "ECE 2024 A", departmentCode: "ECE", academicYear: "2024-2025", section: "A", year: 3, students: 5 },
  { name: "MECH 2024 A", departmentCode: "MECH", academicYear: "2024-2025", section: "A", year: 3, students: 5 },
];

const STUDENT_NAMES = [
  "Aarav Menon", "Diya Sharma", "Vihaan Iyer", "Ananya Nair", "Rohan Desai", "Ishita Kulkarni",
  "Arjun Verma", "Kavya Rao", "Neel Patel", "Saanvi Gupta", "Aditya Bose", "Meera Krishnan",
  "Karthik Reddy", "Priya Malhotra", "Rahul Joshi", "Sneha Pillai", "Vikram Singh", "Anjali Menon",
  "Siddharth Jain", "Pooja Shetty", "Nikhil Chawla", "Snehal Kadam", "Varun Bhat", "Ritu Saxena",
];

// index -> lifecycle. Two graduates and one suspended student make the
// academic-status filters (graduated / on hold) meaningful.
const LIFECYCLE_BY_INDEX = {
  7: { lifecycleStatus: "ALUMNI", isActive: false, disabledReason: "PASSOUT", passoutYear: 2025 },
  13: { lifecycleStatus: "ALUMNI", isActive: false, disabledReason: "PASSOUT", passoutYear: 2025 },
  18: { lifecycleStatus: "SUSPENDED", isActive: false, disabledReason: "MANUAL_SUSPEND" },
};

const OPEN_TEST = {
  title: "Demo Placement Aptitude (OPEN)",
  subject: "Aptitude",
  description: "Seeded OPEN_TEST: 10 mixed questions, 45 marks.",
  durationMins: 45,
  questions: [
    { type: "MCQ", prompt: "What is 15% of 240?", options: ["24", "36", "40", "45"], correctOption: "36", marks: 5, category: null },
    { type: "MCQ", prompt: "The average of the first 10 natural numbers is:", options: ["5", "5.5", "6", "10.5"], correctOption: "5.5", marks: 5, category: null },
    { type: "TRUE_FALSE", prompt: "A rectangle is a parallelogram.", correctBoolean: true, marks: 4, category: null },
    { type: "MCQ", prompt: "Which of these numbers is prime?", options: ["91", "93", "97", "99"], correctOption: "97", marks: 5, category: null },
    { type: "FILL_BLANK", prompt: "The SI unit of force is ______.", correctText: "newton", marks: 4, category: null },
    { type: "TRUE_FALSE", prompt: "The interior angles of a triangle sum to 180 degrees.", correctBoolean: true, marks: 4, category: null },
    { type: "MCQ", prompt: "The HCF of 36 and 84 is:", options: ["6", "12", "18", "24"], correctOption: "12", marks: 5, category: null },
    { type: "FILL_BLANK", prompt: "Speed = Distance / ______.", correctText: "time", marks: 4, category: null },
    { type: "MCQ", prompt: "The smallest prime number greater than 50 is:", options: ["51", "53", "57", "59"], correctOption: "53", marks: 5, category: null },
    { type: "MCQ", prompt: "In a right-angled triangle the hypotenuse is:", options: ["The side opposite the right angle", "The longest adjacent side", "The base", "The hypotenuse side"], correctOption: "The side opposite the right angle", marks: 4, category: null },
  ],
};

// Categories must match the ones the app allows for MODULE_TEST questions.
const MODULE_TEST = {
  title: "Demo Skills Module Test (MODULE)",
  subject: "Engineering Aptitude",
  description: "Seeded MODULE_TEST: 3 modules x 3 questions, 36 marks.",
  modules: [
    { key: "quant", name: "Quantitative Aptitude", order: 1, category: "Quantitative Aptitude", durationMins: 15 },
    { key: "logic", name: "Logical Reasoning", order: 2, category: "Logical Reasoning", durationMins: 15 },
    { key: "verbal", name: "Verbal Ability", order: 3, category: "Verbal", durationMins: 15 },
  ],
  questions: [
    { type: "MCQ", prompt: "The ratio of boys to girls is 3:4. If there are 21 boys, how many girls?", options: ["24", "28", "32", "36"], correctOption: "28", marks: 4, category: "Quantitative Aptitude" },
    { type: "MCQ", prompt: "A shop gives 20% discount on a 1,200 rupee item. The selling price is:", options: ["900", "960", "1,020", "1,080"], correctOption: "960", marks: 4, category: "Quantitative Aptitude" },
    { type: "TRUE_FALSE", prompt: "A can finish a task in 12 days and B in 18 days. Together they finish it in less than 8 days.", correctBoolean: false, marks: 4, category: "Quantitative Aptitude" },

    { type: "MCQ", prompt: "Next in the series: 2, 6, 12, 20, __", options: ["26", "28", "30", "32"], correctOption: "30", marks: 4, category: "Logical Reasoning" },
    { type: "TRUE_FALSE", prompt: "All cats are animals. Some animals are black. Therefore some cats are black.", correctBoolean: false, marks: 4, category: "Logical Reasoning" },
    { type: "MCQ", prompt: "If TEACHER is coded as VGCEJGT, how is STUDENT coded (first letter)?", options: ["T", "U", "V", "W"], correctOption: "V", marks: 4, category: "Logical Reasoning" },

    { type: "MCQ", prompt: "Choose the synonym for 'abundant':", options: ["Scarce", "Plentiful", "Hidden", "Fragile"], correctOption: "Plentiful", marks: 4, category: "Verbal" },
    { type: "MCQ", prompt: "Choose the antonym for 'expand':", options: ["Enlarge", "Extend", "Contract", "Increase"], correctOption: "Contract", marks: 4, category: "Verbal" },
    { type: "FILL_BLANK", prompt: "The report was so ______ that everyone understood it immediately.", correctText: "clear", marks: 4, category: "Verbal" },
  ],
};

// Attempt coverage: the rest of the college shows up as "not attended", which is
// what makes the not-attended sheet meaningful.
const OPEN_TEST_ATTEMPTS = 18;
const MODULE_TEST_ATTEMPTS = 15;
const IN_PROGRESS_ATTEMPTS = 2;

// ---------------------------------------------------------------- utilities

const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const random = mulberry32(20260202);
const round2 = (value) => Math.round(value * 100) / 100;
const pick = (list) => list[Math.floor(random() * list.length)];
const daysAgo = (days, hourOffset = 0) => new Date(Date.now() - days * 86400000 + hourOffset * 3600000);

const demoEmail = (code, index) => `demo.${code.toLowerCase()}.${String(index + 1).padStart(2, "0")}@students.demoreports.test`;

/** Ability 0..1 per student, so the score distribution straddles the pass mark. */
const abilityFor = (index) => {
  const ladder = [0.92, 0.86, 0.81, 0.74, 0.68, 0.63, 0.58, 0.52, 0.47, 0.42, 0.36, 0.3];
  return ladder[index % ladder.length] + (random() * 0.04 - 0.02);
};

const answerValueFor = (question, correct) => {
  if (question.type === "TRUE_FALSE") return !correct;
  if (question.type === "FILL_BLANK") return "incorrect";
  const wrong = (question.options || []).filter((option) => option !== question.correctOption);
  return correct ? question.correctOption : pick(wrong.length ? wrong : ["None of these"]);
};

const buildAnswerRow = (submission, question, correct, skipped) => {
  const base = { submissionId: submission.id, questionId: question.id, attemptCount: 1, timeSpentSeconds: 20 + Math.floor(random() * 70) };
  if (question.type === "TRUE_FALSE") return { ...base, selectedBoolean: skipped ? null : !correct, isCorrect: skipped ? null : correct };
  if (question.type === "FILL_BLANK") return { ...base, selectedText: skipped ? null : answerValueFor(question, correct), isCorrect: skipped ? null : correct };
  if (question.type === "MCQ" || question.type === "MCQ_MULTI" || question.type === "SINGLE_SELECT") {
    return { ...base, selectedOption: skipped ? null : answerValueFor(question, correct), isCorrect: skipped ? null : correct };
  }
  return { ...base, selectedText: skipped ? null : "Answer recorded by the student.", isCorrect: skipped ? null : correct };
};

// ---------------------------------------------------------------- teardown

const dropDemoCollege = async (collegeId) => {
  const db = dbClient;
  const studentDocs = await db.student.findMany({ where: { collegeId } });
  const studentIds = new Set(studentDocs.map((student) => student.id));
  const submissionDocs = await db.submission.findMany({ where: { collegeId } });
  const submissionIds = new Set(submissionDocs.map((submission) => submission.id));

  await db.question.deleteMany({ where: { collegeId } });
  if (submissionIds.size) {
    const submissionIdList = [...submissionIds];
    await db.answer.deleteMany({ where: { submissionId: { in: submissionIdList } } });
    await db.violation.deleteMany({ where: { submissionId: { in: submissionIdList } } });
  }
  await db.submission.deleteMany({ where: { collegeId } });
  await db.test.deleteMany({ where: { collegeId } });
  await db.batch.deleteMany({ where: { collegeId } });
  await db.department.deleteMany({ where: { collegeId } });
  await db.admin.deleteMany({ where: { collegeId } });
  if (studentIds.size) {
    await db.studentStatusEvent.deleteMany({ where: { studentId: { in: [...studentIds] } } });
  }
  await db.student.deleteMany({ where: { collegeId } });
  await db.college.deleteMany({ where: { id: collegeId } });
  return { students: studentIds.size, submissions: submissionIds.size };
};

// ---------------------------------------------------------------- seed

const seed = async () => {
  const summary = { dryRun: DRY_RUN, college: DEMO_COLLEGE_NAME };

  const existing = await dbClient.college.findFirst({ where: { code: DEMO_COLLEGE_CODE } });
  if (existing && !RESET) {
    return {
      ...summary,
      skipped: true,
      reason: `College "${DEMO_COLLEGE_CODE}" already exists. Re-run with --reset to rebuild it.`,
      collegeId: existing.id,
    };
  }

  if (existing && RESET && !DRY_RUN) {
    summary.removed = await dropDemoCollege(existing.id);
  }

  const adminPasswordHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 10);
  const studentPasswordHash = await bcrypt.hash(DEMO_STUDENT_PASSWORD, 10);

  const plan = {
    departments: DEPARTMENTS.length,
    batches: BATCHES.length,
    students: BATCHES.reduce((sum, batch) => sum + batch.students, 0),
  };

  if (DRY_RUN) {
    return {
      ...summary,
      ...plan,
      openTest: { title: OPEN_TEST.title, questions: OPEN_TEST.questions.length, attempts: OPEN_TEST_ATTEMPTS },
      moduleTest: { title: MODULE_TEST.title, modules: MODULE_TEST.modules.length, questions: MODULE_TEST.questions.length, attempts: MODULE_TEST_ATTEMPTS },
      note: "Dry run: nothing was written.",
    };
  }

  const college = await dbClient.college.create({
    data: { name: DEMO_COLLEGE_NAME, code: DEMO_COLLEGE_CODE, isActive: true },
  });
  summary.collegeId = college.id;

  const admin = await dbClient.admin.create({
    data: { fullName: "Demo College Admin", email: DEMO_ADMIN_EMAIL, role: "COLLEGE_ADMIN", collegeId: college.id, passwordHash: adminPasswordHash, isActive: true },
  });

  const departmentByCode = new Map();
  for (const department of DEPARTMENTS) {
    const created = await dbClient.department.create({
      data: { name: department.name, code: department.code, collegeId: college.id, isActive: true },
    });
    departmentByCode.set(department.code, created);
  }

  const batchByName = new Map();
  for (const batch of BATCHES) {
    const created = await dbClient.batch.create({
      data: {
        name: batch.name,
        departmentId: departmentByCode.get(batch.departmentCode).id,
        collegeId: college.id,
        year: batch.year,
        academicYear: batch.academicYear,
        section: batch.section,
        capacity: 60,
        isActive: true,
      },
    });
    batchByName.set(batch.name, created);
  }

  const studentDocs = [];
  let studentIndex = 0;
  for (const batch of BATCHES) {
    for (let i = 0; i < batch.students; i += 1) {
      const index = studentIndex;
      const code = batch.departmentCode;
      const lifecycle = LIFECYCLE_BY_INDEX[index] || { lifecycleStatus: "ACTIVE", isActive: true };
      const fullName = STUDENT_NAMES[index];
      const enrollNumber = `DEMO${batch.academicYear.slice(0, 4)}${code}${String(index + 1).padStart(3, "0")}`;
      const batchDoc = batchByName.get(batch.name);

      studentDocs.push({
        data: {
          fullName,
          email: demoEmail(code, index),
          role: "student",
          collegeId: college.id,
          departmentId: departmentByCode.get(code).id,
          batchId: batchDoc.id,
          batchIds: [batchDoc.id],
          year: batch.year,
          studentId: enrollNumber,
          enrollNumber,
          enrollmentNumber: enrollNumber,
          registerNumber: enrollNumber,
          passwordHash: studentPasswordHash,
          lifecycleStatus: lifecycle.lifecycleStatus,
          isActive: lifecycle.isActive,
          disabledReason: lifecycle.disabledReason || null,
          disabledAt: lifecycle.disabledReason ? daysAgo(40) : null,
          passoutYear: lifecycle.passoutYear || null,
          phoneNumber: `9${String(100000000 + index * 137).slice(0, 9)}`,
        },
      });
      studentIndex += 1;
    }
  }

  const students = [];
  for (const doc of studentDocs) {
    students.push(await dbClient.student.create(doc));
  }
  summary.students = students.length;

  // --- tests + questions -------------------------------------------------
  const createTest = async ({ title, subject, description, durationMins, questions, modules, assessmentFormat }) => {
    const totalMarks = questions.reduce((sum, question) => sum + Number(question.marks || 0), 0);
    const test = await dbClient.test.create({
      data: {
        title,
        subject,
        description,
        instructions: "Answer every question. Negative marking is disabled for this assessment.",
        durationMins,
        totalMarks,
        attemptsAllowed: 1,
        negativeMarkingEnabled: false,
        status: "COMPLETED",
        isPublished: true,
        assessmentFormat,
        modules: modules || [],
        assignmentMethod: "everyone",
        collegeId: college.id,
        createdByAdminId: admin.id,
        startsAt: daysAgo(7),
        endsAt: daysAgo(3),
        proctoringEnabled: true,
        violationLimit: 5,
      },
    });

    const created = [];
    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i];
      created.push(
        await dbClient.question.create({
          data: {
            testId: test.id,
            collegeId: college.id,
            prompt: question.prompt,
            type: question.type,
            options: question.options || [],
            correctOption: question.correctOption || null,
            correctBoolean: question.correctBoolean ?? null,
            correctText: question.correctText || null,
            marks: question.marks,
            order: i + 1,
            category: question.category || null,
            explanation: "Seeded demo question for report verification.",
            isActive: true,
          },
        })
      );
    }

    return { test, questions: created, totalMarks };
  };

  const openTest = await createTest({
    title: OPEN_TEST.title,
    subject: OPEN_TEST.subject,
    description: OPEN_TEST.description,
    durationMins: OPEN_TEST.durationMins,
    questions: OPEN_TEST.questions,
    assessmentFormat: "OPEN_TEST",
  });

  const moduleTest = await createTest({
    title: MODULE_TEST.title,
    subject: MODULE_TEST.subject,
    description: MODULE_TEST.description,
    durationMins: MODULE_TEST.modules.reduce((sum, mod) => sum + mod.durationMins, 0),
    questions: MODULE_TEST.questions,
    modules: MODULE_TEST.modules,
    assessmentFormat: "MODULE_TEST",
  });

  summary.tests = [
    { id: openTest.test.id, title: OPEN_TEST.title, format: "OPEN_TEST", totalMarks: openTest.totalMarks, questions: openTest.questions.length },
    { id: moduleTest.test.id, title: MODULE_TEST.title, format: "MODULE_TEST", totalMarks: moduleTest.totalMarks, questions: moduleTest.questions.length },
  ];

  // --- submissions, answers, module state, violations -------------------
  const seedSubmissions = async ({ test, questions, totalMarks, modules, participants, inProgress, startedDaysAgo }) => {
    let answerBuffer = [];
    let violationBuffer = [];
    let created = 0;

    const flush = async () => {
      if (answerBuffer.length) await dbClient.answer.createMany({ data: answerBuffer });
      if (violationBuffer.length) await dbClient.violation.createMany({ data: violationBuffer });
      answerBuffer = [];
      violationBuffer = [];
    };

    for (let i = 0; i < students.length; i += 1) {
      const student = students[i];
      const inProgressAttempt = inProgress && i < inProgress;

      if (i >= participants && !inProgressAttempt) continue;

      const ability = abilityFor(i);
      const startedAt = daysAgo(startedDaysAgo, i % 6);
      const timeSpentSeconds = 900 + Math.floor(random() * 1500);
      const isAutoSubmitted = i % 7 === 5;
      const status = inProgressAttempt ? "IN_PROGRESS" : isAutoSubmitted ? "AUTO_SUBMITTED" : i % 5 === 2 ? "GRADED" : "SUBMITTED";

      const perQuestion = questions.map((question) => {
        const skipped = !inProgressAttempt && random() < 0.05;
        const correct = !skipped && random() < ability;
        return { question, skipped, correct };
      });

      const earnedMarks = round2(perQuestion.filter((entry) => entry.correct).reduce((sum, entry) => sum + Number(entry.question.marks || 0), 0));
      const answeredCount = perQuestion.filter((entry) => !entry.skipped).length;
      const scorePercent = totalMarks > 0 ? round2((earnedMarks / totalMarks) * 100) : null;

      let moduleState = [];
      // Mirrors what the real MODULE_TEST submit path persists: per-module state
      // plus the overall denominators, so the module sheet has a real maximum.
      let overallMaxScore = 0;
      let overallPercentage = null;
      if (modules && modules.length && !inProgressAttempt) {
        moduleState = modules.map((mod) => {
          const entries = perQuestion.filter((entry) => entry.question.category === mod.category);
          const moduleMax = entries.reduce((sum, entry) => sum + Number(entry.question.marks || 0), 0);
          const moduleScore = round2(entries.filter((entry) => entry.correct).reduce((sum, entry) => sum + Number(entry.question.marks || 0), 0));
          const endedAt = new Date(startedAt.getTime() + mod.durationMins * 60000);
          return {
            key: mod.key,
            name: mod.name,
            order: mod.order,
            category: mod.category,
            configuredDurationMins: mod.durationMins,
            startedAt: new Date(startedAt.getTime() + (mod.order - 1) * mod.durationMins * 60000),
            endedAt,
            timeTakenSeconds: Math.floor(mod.durationMins * 60 * (0.5 + random() * 0.45)),
            status: isAutoSubmitted && mod.order === modules.length ? "AUTO_SUBMIT" : "MANUAL_SUBMIT",
            score: moduleScore,
            maxScore: moduleMax,
            percentage: moduleMax > 0 ? round2((moduleScore / moduleMax) * 100) : 0,
            questionCount: entries.length,
            answeredCount: entries.filter((entry) => !entry.skipped).length,
          };
        });
        overallMaxScore = round2(moduleState.reduce((sum, mod) => sum + mod.maxScore, 0));
        overallPercentage = overallMaxScore > 0 ? round2((earnedMarks / overallMaxScore) * 100) : null;
      }

      const violationCount = i % 9 === 4 ? 2 : 0;

      const submission = await dbClient.submission.create({
        data: {
          userId: student.id,
          testId: test.id,
          collegeId: college.id,
          attemptNumber: 1,
          score: earnedMarks,
          accuracy: scorePercent,
          status,
          startedAt,
          submittedAt: inProgressAttempt ? null : new Date(startedAt.getTime() + timeSpentSeconds * 1000),
          timeSpentSeconds: inProgressAttempt ? 0 : timeSpentSeconds,
          completion: totalMarks > 0 ? round2((answeredCount / questions.length) * 100) : 0,
          overallMaxScore,
          overallPercentage,
          violationCount,
          violationLimit: 5,
          isAutoSubmitted: Boolean(isAutoSubmitted) && !inProgressAttempt,
          agreedToInstructions: true,
          agreedAt: startedAt,
          moduleState,
          currentModuleKey: null,
        },
      });

      perQuestion.forEach((entry) => {
        answerBuffer.push(buildAnswerRow(submission, entry.question, entry.correct, entry.skipped || inProgressAttempt));
      });

      for (let v = 0; v < violationCount; v += 1) {
        violationBuffer.push({
          submissionId: submission.id,
          userId: student.id,
          testId: test.id,
          collegeId: college.id,
          departmentId: student.departmentId,
          type: v % 2 === 0 ? "TAB_SWITCH" : "WINDOW_BLUR",
          metadata: { seeded: true },
          createdAt: new Date(startedAt.getTime() + (v + 1) * 60000),
        });
      }

      created += 1;
      if (answerBuffer.length >= 400 || i === students.length - 1) await flush();
    }

    await flush();
    return created;
  };

  summary.openTestSubmissions = await seedSubmissions({
    test: openTest.test,
    questions: openTest.questions,
    totalMarks: openTest.totalMarks,
    participants: OPEN_TEST_ATTEMPTS,
    inProgress: IN_PROGRESS_ATTEMPTS,
    startedDaysAgo: 6,
  });

  summary.moduleTestSubmissions = await seedSubmissions({
    test: moduleTest.test,
    questions: moduleTest.questions,
    totalMarks: moduleTest.totalMarks,
    modules: MODULE_TEST.modules,
    participants: MODULE_TEST_ATTEMPTS,
    inProgress: 0,
    startedDaysAgo: 4,
  });

  summary.credentials = {
    collegeAdmin: { email: DEMO_ADMIN_EMAIL, password: DEMO_ADMIN_PASSWORD },
    students: { emailPattern: demoEmail("cse", 0).replace("01@", "NN@"), password: DEMO_STUDENT_PASSWORD },
  };

  return summary;
};

if (require.main === module) {
  seed()
    .then(async (result) => {
      console.log(JSON.stringify(result, null, 2));
      await dbClient.$disconnect();
    })
    .catch(async (error) => {
      console.error(error.code || "DEMO_SEED_FAILED");
      console.error(error.message);
      await dbClient.$disconnect().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { seed, DEMO_COLLEGE_CODE, DEMO_COLLEGE_NAME };