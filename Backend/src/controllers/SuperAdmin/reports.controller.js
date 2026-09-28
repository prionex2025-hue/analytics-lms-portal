const mongoose = require("mongoose");

const models = require("../../models");
const { enqueueSuperReportJob } = require("../../services/super-admin-report-queue.service");
const { aggregateReportSubmissions, buildAggregateReportResponse, buildSubmissionModuleColumns } = require("../../services/report-analytics-aggregation.service");
const { describeDistribution } = require("../../utils/stats");
const { generateSuperAdminReportHTML } = require("../../services/report-formatter.service");
const { renderHtmlToPdfBuffer } = require("../../services/report-pdf.service");
const { readReportPayload } = require("../../services/report-payload-store.service");
const { createAuditLog } = require("../../services/audit.service");
const { emitToRole } = require("../../realtime/socket");
const { ApiError, asyncHandler } = require("../../utils/http");
const { clampPercent, getSubmissionScorePercent, getTestTotalMarks } = require("../../utils/score");
const { collectSubmissions } = require("../../services/submission-batch.service");
const { isQuestionCorrect } = require("../../services/test.service");
const { buildAdminTestVisibilityWhere } = require("../../utils/admin-test-access");
const {
  REPORTABLE_SUBMISSION_STATUSES,
  buildStudentLifecycleWhere,
  buildReportScopeMetadata,
  normalizeStudentScope,
  normalizePassoutYear,
  normalizeOptionalId,
} = require("../../services/report-scope.service");

// Prisma student filter that matches a student assigned to a batch either via the
// scalar batchId or the batchIds[] array (students can belong to multiple batches).
const buildBatchStudentWhere = (batchId) =>
  batchId ? { OR: [{ batchId }, { batchIds: { in: [batchId] } }] } : {};

const PASS_THRESHOLD_PERCENT = 40;

const toPercent = (value) => clampPercent(value);
const getScorePercent = getSubmissionScorePercent;

const scoreBand = (score) => {
  if (score <= 20) return "0-20";
  if (score <= 40) return "21-40";
  if (score <= 60) return "41-60";
  if (score <= 80) return "61-80";
  return "81-100";
};

const deriveMonthKey = (dateLike) => {
  const date = new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

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

const getViolationCount = (submission) =>
  Number(submission?._count?.violations ?? submission?.violations?.length ?? submission?.violationCount ?? 0);
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

const toObjectIdIfValid = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || "")) ? new mongoose.Types.ObjectId(String(value)) : value;

const buildSuperReportCollegeWhere = (collegeId) => ({
  OR: [
    { "filters.collegeId": collegeId },
    { "filters.collegeId": toObjectIdIfValid(collegeId) },
  ],
});

const validateReportScope = async ({ db, collegeId, departmentId, batchId, studentId, testId, studentScope, passoutYear, passoutCohortId }) => {
  if (collegeId) {
    const college = await db.college.findUnique({ where: { id: collegeId }, select: { id: true, isActive: true } });
    if (!college || !college.isActive) {
      throw new ApiError(404, "College not found or inactive");
    }
  }

  if (departmentId) {
    const department = await db.department.findFirst({
      where: {
        id: departmentId,
        ...(collegeId ? { collegeId } : {}),
      },
      select: { id: true, collegeId: true },
    });
    if (!department) {
      throw new ApiError(404, "Department not found for selected college");
    }
  }

  if (batchId) {
    // Validate the batch belongs to the college only. A "global" batch spans
    // several departments (departmentId null, departmentIds[] populated), so
    // constraining by departmentId here would wrongly reject a valid selection.
    const batch = await db.batch.findFirst({
      where: {
        id: batchId,
        ...(collegeId ? { collegeId } : {}),
      },
      select: { id: true },
    });
    if (!batch) {
      throw new ApiError(404, "Batch not found for selected report scope");
    }
  }

  if (studentId) {
    const student = await db.student.findFirst({
      where: {
        id: studentId,
        ...(collegeId ? { collegeId } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...buildStudentLifecycleWhere({ studentScope, passoutYear, passoutCohortId }),
      },
      select: { id: true },
    });
    if (!student) {
      throw new ApiError(404, "Student not found for selected report scope");
    }
  }

  if (testId) {
    const test = await db.test.findFirst({
      where: {
        id: testId,
        ...(collegeId ? { collegeId } : {}),
      },
      select: { id: true },
    });
    if (!test) {
      throw new ApiError(404, "Test not found for selected report scope");
    }
  }
};

const generateSuperReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const filters = req.body.filters || {};
  const collegeId = normalizeId(filters.collegeId);
  const departmentId = normalizeId(filters.departmentId);
  const batchId = normalizeId(filters.batchId);
  const studentId = normalizeId(filters.studentId);
  // One selected test stays a single-test report (testId); several become a
  // multi-test report (testIds), matching the admin generateReport.
  const selectedTestIds = [
    ...new Set([...(Array.isArray(filters.testIds) ? filters.testIds : []), filters.testId].map(normalizeId).filter(Boolean)),
  ];
  const testId = selectedTestIds.length === 1 ? selectedTestIds[0] : "";
  const testIds = selectedTestIds.length > 1 ? selectedTestIds : [];
  const year = normalizeStudentYear(filters.year);
  const studentScope = normalizeStudentScope(filters.studentScope);
  const passoutYear = normalizePassoutYear(filters.passoutYear);
  const passoutCohortId = normalizeOptionalId(filters.passoutCohortId);

  if (!collegeId) {
    throw new ApiError(400, "Select a college before generating a super admin report");
  }

  if (testIds.length > 0) {
    const found = await db.test.findMany({ where: { id: { in: testIds }, collegeId }, select: { id: true } });
    if (found.length !== testIds.length) {
      throw new ApiError(404, "One or more selected tests were not found for the selected college");
    }
  }

  await validateReportScope({ db, collegeId, departmentId, batchId, studentId, testId, studentScope, passoutYear, passoutCohortId });
  const reportFilters = { ...filters, collegeId };
  delete reportFilters.testId;
  delete reportFilters.testIds;
  if (testIds.length > 0) reportFilters.testIds = testIds;
  if (departmentId) reportFilters.departmentId = departmentId;
  if (batchId) reportFilters.batchId = batchId;
  else delete reportFilters.batchId;
  if (studentId) reportFilters.studentId = studentId;
  if (testId) reportFilters.testId = testId;
  if (year) reportFilters.year = year;
  reportFilters.studentScope = studentScope;
  if (passoutYear) reportFilters.passoutYear = passoutYear;
  if (passoutCohortId) reportFilters.passoutCohortId = passoutCohortId;

  const job = await db.superReportJob.create({
    data: {
      type: req.body.type,
      filters: reportFilters,
      initiatedById: req.superAdmin.id,
    },
  });

  await enqueueSuperReportJob(job.id);

  res.status(202).json({
    message: "Super admin report queued",
    jobId: job.id,
    status: job.status,
  });
});

const getSuperReportAnalytics = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);
  const departmentId = normalizeId(req.query.departmentId);
  const batchId = normalizeId(req.query.batchId);
  const studentId = normalizeId(req.query.studentId);
  const testId = normalizeId(req.query.testId);
  const year = normalizeStudentYear(req.query.year);
  const reportScopeFilters = {
    studentScope: normalizeStudentScope(req.query.studentScope),
    passoutYear: normalizePassoutYear(req.query.passoutYear),
    passoutCohortId: normalizeOptionalId(req.query.passoutCohortId),
  };
  const studentLifecycleWhere = buildStudentLifecycleWhere(reportScopeFilters);
  const dateFrom = toValidDate(req.query.dateFrom);
  const dateTo = toValidDate(req.query.dateTo);

  if (!collegeId) {
    throw new ApiError(400, "Select a college before viewing super admin report analytics");
  }

  await validateReportScope({ db, collegeId, departmentId, batchId, studentId, testId, ...reportScopeFilters });
  const submittedAtFilter = {
    ...(dateFrom ? { gte: dateFrom } : {}),
    ...(dateTo ? { lte: dateTo } : {}),
  };

  const departmentBatchIds = departmentId
    ? (await db.batch.findMany({
        where: {
          departmentId,
          ...(collegeId ? { collegeId } : {}),
        },
        select: { id: true },
      })).map((batch) => batch.id)
    : [];

  const studentWhere = {
    ...(collegeId ? { collegeId } : {}),
    ...studentLifecycleWhere,
    ...(departmentId ? { departmentId } : {}),
    ...buildBatchStudentWhere(batchId),
    ...(studentId ? { id: studentId } : {}),
    ...(year ? { year } : {}),
  };

  // Test scope resolved with the SAME visibility helper the College Admin report
  // uses, so a Super Admin sees exactly the tests a College Admin would for the
  // same college / department / batch — including "everyone"-assigned tests, and,
  // when a batch is selected, that batch's tests. A selected batch narrows the
  // batch scope to that single batch (mirroring resolveAdminTestScope).
  const scopedBatchIds = batchId ? [batchId] : departmentBatchIds;
  const testWhere = buildAdminTestVisibilityWhere({
    collegeId,
    departmentId: departmentId || null,
    batchId: batchId || null,
    batchIds: scopedBatchIds,
    testId: testId || null,
  });
  const [students, tests, departments] = await Promise.all([
    db.student.findMany({
      where: studentWhere,
      include: {
        college: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true } },
      },
    }),
    db.test.findMany({
      where: testWhere,
      select: {
        id: true,
        title: true,
        subject: true,
        totalMarks: true,
        collegeId: true,
        departmentId: true,
        assignedTo: true,
        batchId: true,
      },
    }),
    db.department.findMany({
      where: {
        ...(collegeId ? { collegeId } : {}),
        ...(departmentId ? { id: departmentId } : {}),
      },
      include: {
        college: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ collegeId: "asc" }, { name: "asc" }],
    }),
  ]);

  const scopedTestIds = new Set(tests.map((test) => test.id));
  const scopedStudentIds = new Set(students.map((student) => student.id));
  const submissionWhere = {
    status: { in: REPORTABLE_SUBMISSION_STATUSES },
    ...(collegeId ? { collegeId } : {}),
    testId: { in: Array.from(scopedTestIds) },
    userId: { in: Array.from(scopedStudentIds) },
    ...(Object.keys(submittedAtFilter).length ? { submittedAt: submittedAtFilter } : {}),
  };

  // Non-student scope: compute everything database-side via aggregation rather
  // than loading up to 20k submissions into memory. The student deep-dive below
  // stays on the detailed path (bounded to one student, needs per-question data).
  if (!studentId) {
    const facet = await aggregateReportSubmissions({
      collegeId,
      testIds: Array.from(scopedTestIds),
      studentIds: Array.from(scopedStudentIds),
      dateFrom,
      dateTo,
    });

    const payload = buildAggregateReportResponse({
      facet,
      students,
      tests,
      departments,
      filters: {
        collegeId: collegeId || null,
        departmentId: departmentId || null,
        studentId: null,
        testId: testId || null,
        year: year || null,
        ...buildReportScopeMetadata(reportScopeFilters),
      },
    });

    return res.status(200).json(payload);
  }

  const submissions = await db.submission.findMany({
    where: submissionWhere,
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          studentId: true,
          enrollNumber: true,
          enrollmentNumber: true,
          year: true,
          collegeId: true,
          departmentId: true,
          batchId: true,
          college: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true } },
          batch: { select: { id: true, name: true } },
        },
      },
      test: {
        select: {
          id: true,
          title: true,
          subject: true,
          totalMarks: true,
          ...(studentId
            ? {
                questions: {
                  select: {
                    id: true,
                    type: true,
                    marks: true,
                    correctOption: true,
                    correctOptions: true,
                    correctBoolean: true,
                    correctText: true,
                  },
                },
              }
            : {}),
          collegeId: true,
          departmentId: true,
        },
      },
      ...(studentId
        ? {
            violations: {
              select: {
                id: true,
                type: true,
                createdAt: true,
                metadata: true,
              },
              orderBy: { createdAt: "desc" },
            },
            answers: {
              select: {
                id: true,
                questionId: true,
                selectedOption: true,
                selectedOptions: true,
                selectedBoolean: true,
                selectedText: true,
                answerBoolean: true,
                answerText: true,
              },
            },
          }
        : {
            _count: {
              select: {
                violations: true,
              },
            },
          }),
    },
    orderBy: { submittedAt: "asc" },
  });
  const scopedSubmissions = submissions.filter((submission) => {
    if (studentId && !scopedStudentIds.has(submission.userId)) return false;
    if (testId && !scopedTestIds.has(submission.testId)) return false;
    if (scopedStudentIds.size && !scopedStudentIds.has(submission.userId)) return false;
    if ((testId || departmentId) && !scopedTestIds.has(submission.testId)) return false;
    return true;
  });

  const submissionsByStudent = new Map();
  scopedSubmissions.forEach((submission) => {
    const key = submission.userId || submission.user?.id;
    if (!key) return;
    const list = submissionsByStudent.get(key) || [];
    list.push(submission);
    submissionsByStudent.set(key, list);
  });

  const studentRows = students.map((student) => {
    const rows = submissionsByStudent.get(student.id) || [];
    const avgScore = rows.length
      ? rows.reduce((sum, submission) => sum + getScorePercent(submission), 0) / rows.length
      : 0;
    const violations = rows.reduce((sum, submission) => sum + getViolationCount(submission), 0);

    return {
      studentId: student.id,
      name: student.fullName,
      rollNo: getStudentNumber(student),
      collegeId: student.collegeId,
      college: student.college?.name || "-",
      departmentId: student.departmentId,
      department: student.department?.name || "-",
      batch: student.batch?.name || "-",
      year: student.year || null,
      avgScore: toPercent(avgScore),
      testsTaken: rows.length,
      violations,
      participation: tests.length > 0 ? toPercent((rows.length / tests.length) * 100) : 0,
    };
  });

  const rankedStudents = studentRows
    .filter((row) => row.testsTaken > 0)
    .sort((a, b) => b.avgScore - a.avgScore)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const rankedByStudentId = new Map(rankedStudents.map((row) => [row.studentId, row]));
  const tableRows = studentRows
    .map((row) => rankedByStudentId.get(row.studentId) || { ...row, rank: null })
    .sort((a, b) => {
      if (a.rank == null && b.rank == null) return a.name.localeCompare(b.name);
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    });

  const avgScore = scopedSubmissions.length
    ? scopedSubmissions.reduce((sum, submission) => sum + getScorePercent(submission), 0) / scopedSubmissions.length
    : 0;
  const passRate = scopedSubmissions.length
    ? (scopedSubmissions.filter((submission) => getScorePercent(submission) >= PASS_THRESHOLD_PERCENT).length / scopedSubmissions.length) * 100
    : 0;
  const attemptedStudentIds = new Set(scopedSubmissions.map((submission) => submission.userId).filter(Boolean));
  const participationRate = students.length ? (attemptedStudentIds.size / students.length) * 100 : 0;
  const totalViolations = scopedSubmissions.reduce(
    (sum, submission) => sum + getViolationCount(submission),
    0
  );

  const trendMap = new Map();
  scopedSubmissions.forEach((submission) => {
    const key = deriveMonthKey(submission.submittedAt || submission.updatedAt || submission.createdAt);
    const current = trendMap.get(key) || { total: 0, count: 0 };
    current.total += getScorePercent(submission);
    current.count += 1;
    trendMap.set(key, current);
  });

  const scoreTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, stat]) => ({ month, score: toPercent(stat.total / Math.max(1, stat.count)) }));

  const subjectMap = new Map();
  scopedSubmissions.forEach((submission) => {
    const subject = submission.test?.subject || "General";
    const current = subjectMap.get(subject) || { total: 0, count: 0 };
    current.total += getScorePercent(submission);
    current.count += 1;
    subjectMap.set(subject, current);
  });

  const subjectPerformance = Array.from(subjectMap.entries())
    .map(([subject, stat]) => ({ subject, score: toPercent(stat.total / Math.max(1, stat.count)) }))
    .sort((a, b) => b.score - a.score);

  const distributionBase = {
    "0-20": 0,
    "21-40": 0,
    "41-60": 0,
    "61-80": 0,
    "81-100": 0,
  };
  rankedStudents.forEach((row) => {
    distributionBase[scoreBand(row.avgScore)] += 1;
  });

  const studentsByDepartment = new Map();
  students.forEach((student) => {
    const key = student.departmentId || "unknown";
    const list = studentsByDepartment.get(key) || [];
    list.push(student);
    studentsByDepartment.set(key, list);
  });

  const submissionsByDepartment = new Map();
  scopedSubmissions.forEach((submission) => {
    const key = submission.user?.departmentId || "unknown";
    const list = submissionsByDepartment.get(key) || [];
    list.push(submission);
    submissionsByDepartment.set(key, list);
  });

  const departmentRows = departments.map((department) => {
    const deptStudents = studentsByDepartment.get(department.id) || [];
    const deptSubmissions = submissionsByDepartment.get(department.id) || [];
    const deptAttempted = new Set(deptSubmissions.map((submission) => submission.userId).filter(Boolean));
    const deptAvg = deptSubmissions.length
      ? deptSubmissions.reduce((sum, submission) => sum + getScorePercent(submission), 0) / deptSubmissions.length
      : 0;
    const deptPass = deptSubmissions.length
      ? (deptSubmissions.filter((submission) => getScorePercent(submission) >= PASS_THRESHOLD_PERCENT).length / deptSubmissions.length) * 100
      : 0;
    const deptViolations = deptSubmissions.reduce(
      (sum, submission) => sum + getViolationCount(submission),
      0
    );

    return {
      departmentId: department.id,
      department: department.name,
      collegeId: department.collegeId,
      college: department.college?.name || "-",
      students: deptStudents.length,
      submissions: deptSubmissions.length,
      avgScore: toPercent(deptAvg),
      passRate: toPercent(deptPass),
      participation: deptStudents.length ? toPercent((deptAttempted.size / deptStudents.length) * 100) : 0,
      violations: deptViolations,
    };
  });

  const selectedStudentBase = studentId ? students.find((student) => student.id === studentId) : null;
  const selectedStudentRank = studentId ? rankedByStudentId.get(studentId) : null;
  const selectedStudentSubmissions = studentId ? scopedSubmissions.filter((submission) => submission.userId === studentId) : [];
  const selectedStudent = selectedStudentBase
    ? {
        id: selectedStudentBase.id,
        name: selectedStudentBase.fullName,
        studentId: getStudentNumber(selectedStudentBase),
        college: selectedStudentBase.college?.name || "-",
        department: selectedStudentBase.department?.name || "-",
        batch: selectedStudentBase.batch?.name || "-",
        year: selectedStudentBase.year || null,
        rank: selectedStudentRank?.rank || null,
      }
    : null;

  const attemptHistory = selectedStudentSubmissions
    .map((submission) => {
      const questions = Array.isArray(submission.test?.questions) ? submission.test.questions : [];
      const answers = Array.isArray(submission.answers) ? submission.answers : [];
      const totalQuestions = questions.length || answers.length;
      const answeredQuestionIds = new Set(answers.map((answer) => String(answer.questionId || "")).filter(Boolean));
      const findAnswer = (question) => answers.find((answer) => String(answer.questionId) === String(question.id));
      const correct = questions.reduce((sum, question) => sum + (isQuestionCorrect(question, findAnswer(question)) ? 1 : 0), 0);
      const incorrect = questions.length > 0
        ? questions.reduce((sum, question) => {
            const answered = answeredQuestionIds.has(String(question.id));
            return sum + (answered && !isQuestionCorrect(question, findAnswer(question)) ? 1 : 0);
          }, 0)
        : Math.max(0, answers.length - correct);
      const totalMarks = questions.length
        ? questions.reduce((sum, question) => sum + Number(question.marks || 0), 0)
        : Number(submission.test?.totalMarks || 0);
      const obtainedMarks = Number(submission.score || 0);
      const scorePercent = getScorePercent(submission);
      const violationEvents = (submission.violations || []).map((violation) => ({
        id: violation.id,
        type: violation.type,
        anomalyId: violation.id,
        anomalyType: violation.type,
        createdAt: violation.createdAt,
        metadata: violation.metadata || null,
        testId: submission.testId,
        testName: submission.test?.title || "Test",
        submissionId: submission.id,
      }));

      return {
        id: submission.id,
        testId: submission.testId,
        testName: submission.test?.title || "Test",
        subject: submission.test?.subject || "General",
        scorePercent,
        score: scorePercent,
        obtainedMarks,
        totalMarks,
        timeTaken: Number(submission.timeSpentSeconds || 0),
        status: submission.status,
        date: submission.submittedAt || submission.updatedAt || submission.createdAt,
        violationsCount: violationEvents.length,
        violationEvents,
        questionAnalysis: {
          total: totalQuestions,
          correct,
          incorrect,
        },
      };
    })
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  res.status(200).json({
    filters: {
      collegeId: collegeId || null,
      departmentId: departmentId || null,
      studentId: studentId || null,
      testId: testId || null,
      year: year || null,
      ...buildReportScopeMetadata(reportScopeFilters),
    },
    metrics: {
      totalStudents: students.length,
      attemptedStudents: attemptedStudentIds.size,
      totalTests: tests.length,
      totalSubmissions: scopedSubmissions.length,
      avgScore: toPercent(avgScore),
      passRate: toPercent(passRate),
      participationRate: toPercent(participationRate),
      violations: totalViolations,
    },
    scoreTrend,
    subjectPerformance,
    distribution: Object.entries(distributionBase).map(([range, count]) => ({ range, count })),
    distributionStats: describeDistribution(rankedStudents.map((row) => row.avgScore)),
    departmentRows,
    tableRows,
    selectedStudent,
    attemptHistory,
  });
});

// Derived lifecycle status mirroring the admin tests controller.
const deriveSuperTestListStatus = (test = {}) => {
  const raw = String(test.status || "").trim().toUpperCase();
  if (raw === "DRAFT" || raw === "ARCHIVED") return raw;
  const now = Date.now();
  const startsAt = test.startsAt ? new Date(test.startsAt).getTime() : null;
  const endsAt = test.endsAt ? new Date(test.endsAt).getTime() : null;
  if (startsAt && startsAt > now) return "SCHEDULED";
  if (endsAt && endsAt < now) return "COMPLETED";
  return "LIVE";
};

// College-scoped, paginated per-test aggregate list for the super-admin
// Reports "Tests" tab. Mirrors the admin buildReportTestsPayload; the tests CSV/XLSX
// export reuses it so an export can never diverge from the tab.
const buildSuperReportTestsPayload = async (req) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);
  const departmentId = normalizeId(req.query.departmentId);
  const batchId = normalizeId(req.query.batchId);
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const sortBy = String(req.query.sortBy || "startsAt");
  const sortDir = String(req.query.sortDir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const search = String(req.query.search || "").trim().toLowerCase();
  const statusFilter = String(req.query.status || "").trim().toUpperCase();
  const reportScopeFilters = {
    studentScope: normalizeStudentScope(req.query.studentScope),
    passoutYear: normalizePassoutYear(req.query.passoutYear),
    passoutCohortId: normalizeOptionalId(req.query.passoutCohortId),
  };
  const dateFrom = toValidDate(req.query.dateFrom);
  const dateTo = toValidDate(req.query.dateTo);

  if (!collegeId) {
    throw new ApiError(400, "Select a college before viewing test reports");
  }

  // Resolve the tests a College Admin would see for this scope: everyone-assigned
  // tests, the department's tests, and (when a batch is selected) that batch's
  // tests — not only the batch_wise-assigned ones. This is the same helper the
  // College Admin tests dashboard uses, so both portals list identical tests.
  const departmentBatchIds = departmentId
    ? (await db.batch.findMany({ where: { collegeId, departmentId }, select: { id: true } })).map((batch) => batch.id)
    : [];
  const scopedBatchIds = batchId ? [batchId] : departmentBatchIds;
  const tests = await db.test.findMany({
    where: buildAdminTestVisibilityWhere({
      collegeId,
      departmentId: departmentId || null,
      batchId: batchId || null,
      batchIds: scopedBatchIds,
    }),
    select: {
      id: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      totalMarks: true,
      department: { select: { name: true } },
      batch: { select: { name: true } },
      questions: { select: { marks: true } },
    },
  });

  if (tests.length === 0) {
    return { data: [], pagination: { page: 1, limit, total: 0, totalPages: 1 } };
  }
  const testIds = tests.map((test) => String(test.id));

  const scopedStudents = await db.student.findMany({
    where: {
      collegeId,
      ...buildStudentLifecycleWhere(reportScopeFilters),
      ...(departmentId ? { departmentId } : {}),
      ...buildBatchStudentWhere(batchId),
    },
    select: { id: true },
  });
  const inScopeStudentCount = scopedStudents.length;

  const { rows: submissions, truncated } = await collectSubmissions({
    db,
    where: {
      collegeId,
      status: { in: REPORTABLE_SUBMISSION_STATUSES },
      testId: { in: testIds },
      ...(dateFrom || dateTo
        ? { submittedAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
        : {}),
    },
    select: {
      testId: true,
      userId: true,
      score: true,
      accuracy: true,
      _count: { select: { violations: true } },
    },
  });

  const testTotalMarks = new Map(tests.map((test) => [String(test.id), getTestTotalMarks(test)]));
  const byTest = new Map();
  for (const submission of submissions) {
    const testKey = String(submission.testId);
    const current = byTest.get(testKey) || { count: 0, scoreSum: 0, passCount: 0, violations: 0, students: new Set() };
    const scorePercent = getScorePercent({
      score: submission.score,
      accuracy: submission.accuracy,
      test: { totalMarks: testTotalMarks.get(testKey) },
    });
    current.count += 1;
    current.scoreSum += scorePercent;
    if (scorePercent >= PASS_THRESHOLD_PERCENT) current.passCount += 1;
    current.violations += Number(submission._count?.violations || 0);
    if (submission.userId) current.students.add(String(submission.userId));
    byTest.set(testKey, current);
  }

  let rows = tests.map((test) => {
    const agg = byTest.get(String(test.id)) || { count: 0, scoreSum: 0, passCount: 0, violations: 0, students: new Set() };
    const submissionCount = agg.count;
    return {
      testId: test.id,
      id: test.id,
      title: test.title || "Untitled test",
      status: deriveSuperTestListStatus(test),
      department: test.department?.name || "-",
      batch: test.batch?.name || "-",
      startsAt: test.startsAt || null,
      endsAt: test.endsAt || null,
      totalMarks: testTotalMarks.get(String(test.id)) || 0,
      submissionCount,
      attemptedStudents: agg.students.size,
      avgScore: submissionCount ? toPercent(agg.scoreSum / submissionCount) : 0,
      passRate: submissionCount ? toPercent((agg.passCount / submissionCount) * 100) : 0,
      participation: inScopeStudentCount ? toPercent((agg.students.size / inScopeStudentCount) * 100) : 0,
      violations: agg.violations,
    };
  });

  if (search) {
    rows = rows.filter((row) => `${row.title} ${row.department} ${row.batch}`.toLowerCase().includes(search));
  }

  // Filter on the DERIVED lifecycle status (window-aware), not the stored one.
  if (statusFilter && statusFilter !== "ALL") {
    rows = rows.filter((row) => row.status === statusFilter);
  }

  const getSortValue = (row) => {
    if (sortBy === "title") return String(row.title || "");
    if (sortBy === "startsAt") return new Date(row.startsAt || 0).getTime();
    return Number(row[sortBy] || 0);
  };
  rows.sort((a, b) => {
    const av = getSortValue(a);
    const bv = getSortValue(b);
    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "asc" ? av - bv : bv - av;
    }
    return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  return {
    data: rows.slice(start, start + limit),
    pagination: { page: safePage, limit, total, totalPages },
    truncated,
  };
};

const getSuperReportTestsDashboard = asyncHandler(async (req, res) => {
  res.status(200).json(await buildSuperReportTestsPayload(req));
});

// Per-submission student results for a scoped test, mirroring the College Admin
// getReportTableDashboard exactly (same scope helper, same row shape, same
// server-side search/sort/pagination) so the super-admin test deep-dive shows an
// identical batch-wise test report. The only difference is the college comes from
// the query instead of the authenticated admin's token.
const getSuperReportTableDashboard = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);
  const departmentId = normalizeId(req.query.departmentId);
  const batchId = normalizeId(req.query.batchId);
  const testId = normalizeId(req.query.testId);
  const studentId = normalizeId(req.query.studentId);
  const year = normalizeStudentYear(req.query.year);
  const reportScopeFilters = {
    studentScope: normalizeStudentScope(req.query.studentScope),
    passoutYear: normalizePassoutYear(req.query.passoutYear),
    passoutCohortId: normalizeOptionalId(req.query.passoutCohortId),
  };
  const studentLifecycleWhere = buildStudentLifecycleWhere(reportScopeFilters);
  const dateFrom = toValidDate(req.query.dateFrom);
  const dateTo = toValidDate(req.query.dateTo);
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const sortBy = String(req.query.sortBy || "date");
  const sortDir = String(req.query.sortDir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const search = String(req.query.search || req.query.studentSearch || "").trim().toLowerCase();

  if (!collegeId) {
    throw new ApiError(400, "Select a college before viewing test results");
  }

  await validateReportScope({ db, collegeId, departmentId, batchId, studentId, testId, ...reportScopeFilters });

  // Resolve the in-scope tests with the SAME visibility helper College Admin uses.
  const departmentBatchIds = departmentId
    ? (await db.batch.findMany({ where: { collegeId, departmentId }, select: { id: true } })).map((batch) => batch.id)
    : [];
  const scopedBatchIds = batchId ? [batchId] : departmentBatchIds;
  const scopeTests = await db.test.findMany({
    where: buildAdminTestVisibilityWhere({
      collegeId,
      departmentId: departmentId || null,
      batchId: batchId || null,
      batchIds: scopedBatchIds,
      testId: testId || null,
    }),
    select: { id: true },
  });
  const testIds = scopeTests.map((test) => String(test.id));

  if (testIds.length === 0) {
    return res.status(200).json({ data: [], pagination: { page: 1, limit, total: 0, totalPages: 1 } });
  }

  const tableStudentWhere = {
    collegeId,
    ...studentLifecycleWhere,
    ...(studentId ? { id: studentId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(year ? { year } : {}),
    ...buildBatchStudentWhere(batchId),
  };
  const tableStudents = await db.student.findMany({ where: tableStudentWhere, select: { id: true } });
  const tableStudentIds = tableStudents.map((student) => String(student.id));
  const submissionStudentFilter = studentId
    ? (tableStudentIds.includes(String(studentId)) ? { userId: studentId } : { userId: { in: [] } })
    : { userId: { in: tableStudentIds } };

  const submissions = await db.submission.findMany({
    where: {
      collegeId,
      status: { in: REPORTABLE_SUBMISSION_STATUSES },
      testId: { in: testIds },
      ...submissionStudentFilter,
      ...(dateFrom || dateTo
        ? { submittedAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
        : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          studentId: true,
          enrollNumber: true,
          enrollmentNumber: true,
          department: { select: { name: true } },
          batch: { select: { name: true } },
        },
      },
      test: {
        select: { title: true, totalMarks: true, assessmentFormat: true, modules: true, questions: { select: { id: true, marks: true } } },
      },
      violations: { select: { id: true, type: true, createdAt: true }, orderBy: { createdAt: "desc" } },
      _count: { select: { violations: true } },
    },
    orderBy: { submittedAt: "desc" },
  });

  const resolveStudentId = (submission) => String(submission.userId || submission.user?.id || "");
  const attemptsPerStudent = submissions.reduce((acc, submission) => {
    const key = resolveStudentId(submission);
    if (key) acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});

  let rows = submissions.map((submission) => {
    const obtainedMarks = Number(submission.score || 0);
    const totalMarks = Array.isArray(submission.test?.questions) && submission.test.questions.length > 0
      ? submission.test.questions.reduce((sum, question) => sum + Number(question.marks || 0), 0)
      : Number(submission.test?.totalMarks || 0);
    const scorePercent = getScorePercent(submission);
    const date = submission.submittedAt || submission.updatedAt || submission.createdAt || new Date();

    return {
      id: submission.id,
      submissionId: submission.id,
      testId: submission.testId,
      studentId: resolveStudentId(submission),
      studentName: submission.user?.fullName || "-",
      studentRollNo: getStudentNumber(submission.user),
      department: submission.user?.department?.name || "-",
      batch: submission.user?.batch?.name || "-",
      testName: submission.test?.title || "-",
      score: scorePercent,
      scorePercent,
      accuracy: scorePercent,
      obtainedMarks,
      totalMarks,
      timeTaken: Number(submission.timeSpentSeconds || 0),
      attemptCount: Number(attemptsPerStudent[resolveStudentId(submission)] || 0),
      status: submission.status || "IN_PROGRESS",
      ...buildSubmissionModuleColumns(submission, submission.test),
      violationCount: Number(submission._count?.violations || submission.violations?.length || 0),
      violations: (submission.violations || []).map((violation) => ({
        id: violation.id,
        type: violation.type,
        anomalyId: violation.id,
        anomalyType: violation.type,
        testId: submission.testId,
        testName: submission.test?.title || "Test",
        submissionId: submission.id,
        createdAt: violation.createdAt,
      })),
      date: new Date(date).toISOString(),
    };
  });

  if (search) {
    rows = rows.filter((row) =>
      `${row.studentName} ${row.studentRollNo} ${row.department} ${row.batch} ${row.testName}`.toLowerCase().includes(search)
    );
  }

  rows.sort((a, b) => {
    const av = a?.[sortBy];
    const bv = b?.[sortBy];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "asc" ? av - bv : bv - av;
    }
    return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  res.status(200).json({
    data: rows.slice(start, start + limit),
    pagination: { page: safePage, limit, total, totalPages },
  });
});

const getPassoutCohorts = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);

  if (!collegeId) {
    throw new ApiError(400, "Select a college before loading passout cohorts");
  }

  await validateReportScope({ db, collegeId });

  const cohorts = await db.studentPassoutCohort.findMany({
    where: {
      collegeId,
      status: "COMPLETED",
    },
    orderBy: [{ passoutYear: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  res.status(200).json({ data: cohorts });
});

// Most recent escalations considered by the escalations inbox. Status is derived
// per escalation, so filtering and pagination happen over this window in memory.
const ESCALATION_WINDOW = 500;
const ESCALATION_STATUSES = new Set(["pending", "resolved", "withdrawn", "all"]);

// The test's anomalyReviews entry holds the latest decision on an anomaly
// (admin and super reviews replace each other). Relative to an escalation:
// - a super admin decision            -> resolved
// - an admin DISMISS after escalating -> withdrawn (the admin retracted it)
// - otherwise (still the escalation)  -> pending
// An admin re-escalating after a super decision replaces the entry again, so
// the anomaly correctly returns to pending.
const deriveEscalationStatus = (review) => {
  if (review?.reviewedBySuperAdminId) {
    return {
      status: "resolved",
      resolution: { action: review.action, reason: review.reason || null, reviewedAt: review.reviewedAt || null },
    };
  }
  if (review && review.action && review.action !== "ESCALATE") {
    return { status: "withdrawn", resolution: { action: review.action, reason: review.reason || null, reviewedAt: review.reviewedAt || null } };
  }
  return { status: "pending", resolution: null };
};

const getEscalatedAnomalies = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const rawStatus = String(req.query.status || "pending").toLowerCase();
  const statusFilter = ESCALATION_STATUSES.has(rawStatus) ? rawStatus : "pending";
  const collegeId = normalizeId(req.query.collegeId);
  const search = String(req.query.search || "").trim().toLowerCase();
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

  const rows = await db.auditLog.findMany({
    where: {
      action: "REPORT_ANOMALY_ESCALATED",
      ...(collegeId ? { collegeId } : {}),
    },
    include: {
      college: { select: { id: true, name: true, code: true } },
      admin: { select: { id: true, fullName: true, email: true } },
      test: { select: { id: true, title: true, subject: true } },
    },
    orderBy: { createdAt: "desc" },
    take: ESCALATION_WINDOW,
  });

  // Keep only the latest escalation per anomaly (rows are newest first).
  const seen = new Set();
  const escalations = [];
  for (const row of rows) {
    const testId = row.testId || row.test?.id || null;
    const anomalyId = row.afterState?.anomalyId || null;
    if (!testId || !anomalyId) continue;
    const key = `${testId}:${anomalyId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    escalations.push({ row, testId: String(testId), anomalyId: String(anomalyId) });
  }

  const testIds = [...new Set(escalations.map((item) => item.testId))];
  const tests = testIds.length
    ? await db.test.findMany({ where: { id: { in: testIds } }, select: { id: true, anomalyReviews: true } })
    : [];
  const reviewsByTest = new Map(
    tests.map((test) => [String(test.id), Array.isArray(test.anomalyReviews) ? test.anomalyReviews : []])
  );

  // Violation-backed anomalies carry the violation id; resolve the student it belongs to.
  const anomalyIds = escalations.map((item) => item.anomalyId);
  const violations = anomalyIds.length
    ? await db.violation.findMany({
        where: { id: { in: anomalyIds } },
        select: { id: true, type: true, userId: true, submissionId: true, timestamp: true, createdAt: true },
      })
    : [];
  const violationById = new Map(violations.map((violation) => [String(violation.id), violation]));
  const studentIds = [...new Set(violations.map((violation) => violation.userId).filter(Boolean).map(String))];
  const students = studentIds.length
    ? await db.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, fullName: true, studentId: true, enrollNumber: true, enrollmentNumber: true },
      })
    : [];
  const studentById = new Map(students.map((student) => [String(student.id), student]));

  const items = escalations.map(({ row, testId, anomalyId }) => {
    const review = (reviewsByTest.get(testId) || []).find((item) => String(item?.anomalyId) === anomalyId) || null;
    const violation = violationById.get(anomalyId) || null;
    const student = violation?.userId ? studentById.get(String(violation.userId)) : null;
    return {
      id: row.id,
      testId,
      anomalyId,
      anomalyType: row.afterState?.anomalyType || violation?.type || null,
      reason: row.afterState?.reason || null,
      escalatedAt: row.createdAt,
      college: row.college || null,
      admin: row.admin || null,
      test: row.test || { id: testId, title: null },
      student: student ? { id: student.id, name: student.fullName || "Student", rollNo: getStudentNumber(student) } : null,
      violation: violation
        ? { type: violation.type, occurredAt: violation.timestamp || violation.createdAt || null, submissionId: violation.submissionId || null }
        : null,
      ...deriveEscalationStatus(review),
    };
  });

  const summary = items.reduce(
    (acc, item) => ({ ...acc, [item.status]: acc[item.status] + 1 }),
    { pending: 0, resolved: 0, withdrawn: 0 }
  );

  let filtered = statusFilter === "all" ? items : items.filter((item) => item.status === statusFilter);
  if (search) {
    filtered = filtered.filter((item) =>
      [item.test?.title, item.college?.name, item.college?.code, item.admin?.fullName, item.student?.name, item.student?.rollNo, item.reason, item.anomalyType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  res.status(200).json({
    data: filtered.slice(start, start + limit),
    summary: { ...summary, total: items.length },
    pagination: { page: safePage, limit, total, totalPages },
    truncated: rows.length >= ESCALATION_WINDOW,
  });
});

const getSuperReportJobs = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);
  if (!collegeId) {
    throw new ApiError(400, "Select a college before viewing super admin report exports");
  }

  await validateReportScope({ db, collegeId });

  const jobs = await db.superReportJob.findMany({
    where: buildSuperReportCollegeWhere(collegeId),
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const data = jobs
    .map((job) => ({
      ...job,
      resultData: undefined,
      resultDataRef: undefined,
      downloadUrl: job.resultUrl || null,
      downloadExpiresAt: job?.filters?.resultUrlExpiresAt || null,
    }));

  res.status(200).json(data);
});

// The super queue records status transitions but not fine-grained progress, so
// progress is derived from the status. Same response shape as the admin
// getReportJobStatus so both portals poll a job the same way.
const SUPER_JOB_PROGRESS = { QUEUED: 15, PROCESSING: 60, COMPLETED: 100, FAILED: 0 };

const getSuperReportJobStatus = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.superReportJob.findUnique({ where: { id: reportJobId } });
  if (!job) {
    return res.status(404).json({ message: "Report job not found" });
  }

  const status = String(job.status || "QUEUED").toUpperCase();
  res.status(200).json({
    jobId: job.id,
    status: status.toLowerCase(),
    progress: SUPER_JOB_PROGRESS[status] ?? 0,
    download_url: job.resultUrl || null,
    expires_at: job?.filters?.resultUrlExpiresAt || null,
    error_message: job.errorMessage || null,
  });
});

// Super admin review of a report anomaly (typically one a college admin
// escalated). The super admin is the final reviewer, so the outcome is DISMISS or
// CONFIRM rather than another escalation.
const reviewSuperAnomaly = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId, anomalyId, anomalyType, action, reason } = req.body;

  const test = await db.test.findUnique({ where: { id: testId } });
  if (!test) {
    return res.status(404).json({ message: "Test not found" });
  }

  const existingReviews = Array.isArray(test.anomalyReviews) ? test.anomalyReviews : [];
  const beforeReview = existingReviews.find((item) => item?.anomalyId === anomalyId) || null;

  const nextReview = {
    anomalyId,
    anomalyType,
    action,
    reason,
    reviewedAt: new Date().toISOString(),
    reviewedBySuperAdminId: req.superAdmin.id,
  };

  await db.test.update({
    where: { id: test.id },
    data: {
      anomalyReviews: [...existingReviews.filter((item) => item?.anomalyId !== anomalyId), nextReview],
    },
  });

  await createAuditLog({
    action: action === "CONFIRM" ? "SUPER_REPORT_ANOMALY_CONFIRMED" : "SUPER_REPORT_ANOMALY_DISMISSED",
    targetType: "TEST_ANOMALY",
    targetId: `${test.id}:${anomalyId}`,
    collegeId: test.collegeId || null,
    superAdminId: req.superAdmin.id,
    testId: test.id,
    beforeState: beforeReview,
    afterState: nextReview,
  });

  // Keep every open super-admin escalations inbox in sync.
  emitToRole("SUPER_ADMIN", "report:anomaly_resolved", {
    testId: test.id,
    anomalyId,
    action,
    reviewedAt: nextReview.reviewedAt,
  });

  res.status(200).json({ message: "Anomaly review saved", review: nextReview });
});

const downloadSuperReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.superReportJob.findUnique({ where: { id: reportJobId } });
  if (!job) {
    return res.status(404).json({ message: "Report job not found" });
  }

  if (job.status !== "COMPLETED") {
    return res.status(409).json({ message: "Report is not ready" });
  }

  const expiresAt = job?.filters?.resultUrlExpiresAt ? new Date(job.filters.resultUrlExpiresAt) : null;
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && Date.now() > expiresAt.getTime()) {
    return res.status(403).json({
      message: "Report download link expired",
      code: "REPORT_URL_EXPIRED",
      expiresAt: expiresAt.toISOString(),
    });
  }

  // Generate human-readable report and convert to PDF
  const storedPayload = job.resultDataRef ? await readReportPayload(job.resultDataRef) : null;
  const rawReportData = storedPayload
    ? storedPayload
    : Array.isArray(job.resultData)
      ? job.resultData
      : job.resultData || { rows: [] };

  // Normalize the payload shape for the formatter. buildGlobalReportPayload
  // returns a raw array for STUDENT_WISE / TEST_WISE / BATCH_WISE, but
  // generateSuperAdminReportHTML reads reportData.rows. Wrapping a raw array in
  // { rows: [...] } ensures those report types render their real data instead of
  // an empty PDF. Object payloads (e.g. DEPARTMENT_WISE with meta/kpis) passthrough.
  const reportData = Array.isArray(rawReportData)
    ? { rows: rawReportData }
    : rawReportData;

  const htmlContent = generateSuperAdminReportHTML(
    {
      ...job,
      generatedAt: job.updatedAt,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    },
    reportData
  );

  // The report HTML carries its own page padding and branded footer, so keep
  // the Puppeteer page margins at zero to avoid overflow/blank pages.
  const pdfBuffer = await renderHtmlToPdfBuffer(htmlContent, {
    margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="super-admin-report-${reportJobId}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).send(pdfBuffer);
});

const regenerateSuperReportLink = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.superReportJob.findUnique({ where: { id: reportJobId } });
  if (!job) {
    return res.status(404).json({ message: "Report job not found" });
  }

  if (job.status !== "COMPLETED") {
    return res.status(409).json({ message: "Report is not ready" });
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const resultUrl = `/api/super-admin/reports/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

  const updated = await db.superReportJob.update({
    where: { id: reportJobId },
    data: {
      resultUrl,
      filters: {
        ...(job.filters || {}),
        resultUrlExpiresAt: expiresAt,
      },
    },
  });

  res.status(200).json({
    reportJobId: updated.id,
    resultUrl,
    expiresAt,
  });
});

module.exports = {
  generateSuperReport,
  getSuperReportAnalytics,
  buildSuperReportTestsPayload,
  getSuperReportTestsDashboard,
  getSuperReportTableDashboard,
  getPassoutCohorts,
  getSuperReportJobs,
  downloadSuperReport,
  regenerateSuperReportLink,
  getEscalatedAnomalies,
  getSuperReportJobStatus,
  reviewSuperAnomaly,
};
