const models = require("../../models");
const { ApiError, asyncHandler } = require("../../utils/http");
const { getSubmissionScorePercent, getTestTotalMarks } = require("../../utils/score");
const { isQuestionCorrect } = require("../../services/test.service");
const { computeItemAnalysis } = require("../../services/item-analysis.service");
const { computeIntegrityAnalytics } = require("../../services/integrity-analysis.service");
const { computeCohortTrends } = require("../../services/cohort-trends.service");
const { computeAtRisk } = require("../../services/at-risk.service");
const { collectSubmissions } = require("../../services/submission-batch.service");
const { buildAdminTestVisibilityWhere, getDepartmentBatchIds } = require("../../utils/admin-test-access");
const {
  REPORTABLE_SUBMISSION_STATUSES,
  buildStudentLifecycleWhere,
  normalizeStudentScope,
  normalizePassoutYear,
  normalizeOptionalId,
} = require("../../services/report-scope.service");

// These endpoints mirror the admin advanced-report endpoints but are scoped by
// the college selected in the query (super admins are not bound to one college
// by their token). All heavy statistics come from the same pure compute
// services the admin portal uses, so both portals stay in lockstep.

const SUBMITTED_STATUSES = REPORTABLE_SUBMISSION_STATUSES;

const normalizeId = (value) => {
  const normalized = String(value || "").trim();
  return normalized === "all" ? "" : normalized;
};

const normalizeStudentYear = (value) => {
  if (value == null || value === "") return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1 && year <= 4 ? year : null;
};

const toValidDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const deriveMonthKey = (dateLike) => {
  const date = new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";
const resolveSubmissionStudentId = (submission = {}) => String(submission.userId || submission.user?.id || "");
const getScorePercent = getSubmissionScorePercent;

const assertActiveCollege = async (db, collegeId) => {
  if (!collegeId) {
    throw new ApiError(400, "Select a college before viewing report analytics");
  }
  const college = await db.college.findUnique({ where: { id: collegeId }, select: { id: true, isActive: true } });
  if (!college || !college.isActive) {
    throw new ApiError(404, "College not found or inactive");
  }
};

// College-scoped equivalent of buildAdminReportScope: resolve the visible tests
// for the selected college / department / batch / test filters.
const resolveSuperTestScope = async ({ db, collegeId, departmentId, batchId, testId, testSelect }) => {
  const batchIds = departmentId ? await getDepartmentBatchIds({ db, collegeId, departmentId }) : [];
  const where = buildAdminTestVisibilityWhere({
    collegeId,
    departmentId: departmentId || null,
    batchId: batchId || null,
    batchIds: batchId ? [batchId] : batchIds,
    testId: testId || null,
  });
  const tests = await db.test.findMany({ where, select: testSelect });
  return {
    tests,
    testIds: tests.map((test) => String(test.id)),
    departmentId: departmentId || null,
    batchId: batchId || null,
    batchIds: batchId ? [batchId] : batchIds,
  };
};

const loadSuperTestAttemptData = async ({ db, collegeId, testId }) => {
  const scope = await resolveSuperTestScope({
    db,
    collegeId,
    testId,
    testSelect: {
      id: true,
      title: true,
      durationMins: true,
      totalMarks: true,
      questions: {
        select: { id: true, order: true, prompt: true, type: true, options: true, correctOption: true, correctOptions: true, correctBoolean: true, correctText: true, marks: true },
      },
    },
  });

  if (!scope.testIds.includes(String(testId))) return { ok: false };
  const test = scope.tests.find((item) => String(item.id) === String(testId));
  if (!test) return { ok: false };

  const { rows: submissions, truncated } = await collectSubmissions({
    db,
    where: { collegeId, testId, status: { in: SUBMITTED_STATUSES } },
    include: {
      user: { select: { id: true, fullName: true, studentId: true, enrollNumber: true, enrollmentNumber: true } },
    },
  });

  const totalMarks = getTestTotalMarks(test);
  const attempts = submissions.map((submission) => ({
    id: submission.id,
    userId: resolveSubmissionStudentId(submission),
    studentName: submission.user?.fullName || "Student",
    startedAt: submission.startedAt,
    scorePercent: getScorePercent({ score: submission.score, accuracy: submission.accuracy, test: { totalMarks } }),
  }));

  return { ok: true, test, submissions, attempts, truncated };
};

const loadSuperScopedAttempts = async ({ db, collegeId, filters }) => {
  const scope = await resolveSuperTestScope({
    db,
    collegeId,
    departmentId: filters.departmentId,
    batchId: filters.batchId,
    testSelect: { id: true, title: true, totalMarks: true, endsAt: true, questions: { select: { marks: true } } },
  });

  if (scope.testIds.length === 0) return { ok: false };

  const studentWhere = {
    collegeId,
    ...buildStudentLifecycleWhere(filters),
    ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
    ...(filters.year ? { year: filters.year } : {}),
    ...(scope.batchId ? { OR: [{ batchId: scope.batchId }, { batchIds: { in: [scope.batchId] } }] } : {}),
  };

  const students = await db.student.findMany({
    where: studentWhere,
    select: {
      id: true,
      fullName: true,
      studentId: true,
      enrollNumber: true,
      enrollmentNumber: true,
      departmentId: true,
      department: { select: { id: true, name: true } },
      batch: { select: { id: true, name: true } },
    },
  });
  const studentIds = students.map((student) => String(student.id));

  const { rows: submissions, truncated } = studentIds.length
    ? await collectSubmissions({
        db,
        where: {
          collegeId,
          status: { in: SUBMITTED_STATUSES },
          testId: { in: scope.testIds },
          userId: { in: studentIds },
          ...(filters.dateFrom || filters.dateTo
            ? {
                submittedAt: {
                  ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
                  ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
                },
              }
            : {}),
        },
        select: {
          id: true,
          userId: true,
          testId: true,
          score: true,
          accuracy: true,
          submittedAt: true,
          createdAt: true,
          _count: { select: { violations: true } },
        },
      })
    : { rows: [], truncated: false };

  const testTotals = new Map(scope.tests.map((test) => [String(test.id), getTestTotalMarks(test)]));
  const attempts = submissions.map((submission) => ({
    ...submission,
    scorePercent: getScorePercent({
      score: submission.score,
      accuracy: submission.accuracy,
      test: { totalMarks: testTotals.get(String(submission.testId)) },
    }),
    date: submission.submittedAt || submission.createdAt,
    violations: Number(submission._count?.violations || 0),
  }));

  return { ok: true, scope, students, attempts, truncated };
};

const resolveSuperFilters = (query = {}) => {
  const validDateFrom = toValidDate(query.dateFrom);
  const validDateTo = toValidDate(query.dateTo);
  return {
    departmentId: normalizeId(query.departmentId) || undefined,
    batchId: normalizeId(query.batchId) || undefined,
    year: normalizeStudentYear(query.year) || undefined,
    studentScope: normalizeStudentScope(query.studentScope),
    passoutYear: normalizePassoutYear(query.passoutYear) || undefined,
    passoutCohortId: normalizeOptionalId(query.passoutCohortId) || undefined,
    dateFrom: validDateFrom ? validDateFrom.toISOString() : undefined,
    dateTo: validDateTo ? validDateTo.toISOString() : undefined,
  };
};

const getSuperReportItemAnalysis = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);
  const testId = normalizeId(req.query.testId);
  await assertActiveCollege(db, collegeId);
  if (!testId) {
    throw new ApiError(400, "testId is required for item analysis", null, "TEST_ID_REQUIRED");
  }

  const data = await loadSuperTestAttemptData({ db, collegeId, testId });
  if (!data.ok) {
    return res.status(200).json({ items: [], summary: { totalQuestions: 0, analysedQuestions: 0, flaggedQuestions: 0 }, test: null });
  }

  const { test, submissions, attempts } = data;
  const questions = Array.isArray(test.questions) ? test.questions : [];
  const questionById = new Map(questions.map((question) => [String(question.id), question]));

  const answerRows = submissions.length
    ? await db.answer.findMany({
        where: { submissionId: { in: submissions.map((submission) => submission.id) } },
        select: {
          submissionId: true,
          questionId: true,
          selectedOption: true,
          selectedOptions: true,
          selectedBoolean: true,
          selectedText: true,
          answerBoolean: true,
          answerText: true,
          isCorrect: true,
          markedForReview: true,
          timeSpentSeconds: true,
        },
      })
    : [];

  const answers = answerRows.map((answer) => {
    const question = questionById.get(String(answer.questionId));
    const resolved = typeof answer.isCorrect === "boolean"
      ? answer.isCorrect
      : question
        ? Boolean(isQuestionCorrect(question, answer))
        : false;
    return { ...answer, isCorrect: resolved };
  });

  const { items, summary } = computeItemAnalysis({ questions, submissions: attempts, answers });

  res.status(200).json({
    test: { id: test.id, title: test.title, totalMarks: getTestTotalMarks(test) },
    summary: { ...summary, attempts: attempts.length, truncated: Boolean(data.truncated) },
    items,
  });
});

const getSuperReportIntegrity = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);
  const testId = normalizeId(req.query.testId);
  await assertActiveCollege(db, collegeId);
  if (!testId) {
    throw new ApiError(400, "testId is required for integrity analytics", null, "TEST_ID_REQUIRED");
  }

  const data = await loadSuperTestAttemptData({ db, collegeId, testId });
  if (!data.ok) {
    return res.status(200).json({
      summary: { totalViolations: 0, attempts: 0, flaggedAttempts: 0, cleanAttempts: 0, flaggedRate: 0, repeatOffenders: 0 },
      byType: [],
      timeline: [],
      repeatOffenders: [],
      scoreByViolationBand: [],
      test: null,
    });
  }

  const { test, submissions, attempts } = data;
  const violations = submissions.length
    ? await db.violation.findMany({
        where: { submissionId: { in: submissions.map((submission) => submission.id) } },
        select: { id: true, submissionId: true, userId: true, type: true, timestamp: true, createdAt: true },
      })
    : [];

  const analytics = computeIntegrityAnalytics({
    violations,
    submissions: attempts,
    durationMins: Number(test.durationMins || 60),
    bucketMinutes: 5,
  });

  res.status(200).json({
    test: { id: test.id, title: test.title, durationMins: Number(test.durationMins || 0) },
    ...analytics,
    truncated: Boolean(data.truncated),
  });
});

const getSuperReportTrends = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);
  await assertActiveCollege(db, collegeId);
  const filters = resolveSuperFilters(req.query || {});
  const groupBy = String(req.query.groupBy || "department").toLowerCase() === "batch" ? "batch" : "department";
  const indexToBase = String(req.query.indexed || "") === "true";

  const data = await loadSuperScopedAttempts({ db, collegeId, filters });
  if (!data.ok) {
    return res.status(200).json({ periods: [], series: [], summary: { entities: 0, periods: 0, improving: 0, declining: 0, stable: 0 } });
  }

  const { students, attempts } = data;
  const studentById = new Map(students.map((student) => [String(student.id), student]));

  const entityMap = new Map();
  const points = [];
  for (const attempt of attempts) {
    const student = studentById.get(String(attempt.userId));
    if (!student) continue;
    const entity = groupBy === "batch" ? student.batch : student.department;
    const entityId = entity?.id || `unassigned-${groupBy}`;
    const entityName = entity?.name || "Unassigned";
    if (!entityMap.has(String(entityId))) entityMap.set(String(entityId), { id: entityId, name: entityName });
    points.push({ entityId, period: deriveMonthKey(attempt.date), scorePercent: attempt.scorePercent });
  }

  const result = computeCohortTrends({ entities: [...entityMap.values()], points, indexToBase });
  res.status(200).json({ groupBy, ...result, truncated: Boolean(data.truncated) });
});

const getSuperReportAtRisk = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);
  await assertActiveCollege(db, collegeId);
  const filters = resolveSuperFilters(req.query || {});

  const data = await loadSuperScopedAttempts({ db, collegeId, filters });
  if (!data.ok) {
    return res.status(200).json({ students: [], summary: { assessed: 0, atRisk: 0, critical: 0, high: 0, moderate: 0 } });
  }

  const { scope, students, attempts } = data;
  const assignedTests = scope.testIds.length;

  const attemptsByStudent = new Map();
  for (const attempt of attempts) {
    const key = String(attempt.userId);
    if (!attemptsByStudent.has(key)) attemptsByStudent.set(key, []);
    attemptsByStudent.get(key).push(attempt);
  }

  const payload = students.map((student) => {
    const studentAttempts = attemptsByStudent.get(String(student.id)) || [];
    return {
      id: student.id,
      name: student.fullName || "Student",
      rollNo: getStudentNumber(student),
      department: student.department?.name || "-",
      batch: student.batch?.name || "-",
      assignedTests,
      violations: studentAttempts.reduce((sum, attempt) => sum + attempt.violations, 0),
      attempts: studentAttempts.map((attempt) => ({ scorePercent: attempt.scorePercent, date: attempt.date })),
    };
  });

  res.status(200).json({ ...computeAtRisk({ students: payload }), truncated: Boolean(data.truncated) });
});

module.exports = {
  getSuperReportItemAnalysis,
  getSuperReportIntegrity,
  getSuperReportTrends,
  getSuperReportAtRisk,
};
