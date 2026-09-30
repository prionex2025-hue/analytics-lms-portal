const models = require("../../models");
const { enqueueReportJob } = require("../../services/admin-report-queue.service");
const { generateAdminReportHTML } = require("../../services/report-formatter.service");
const { renderHtmlToPdfBuffer } = require("../../services/report-pdf.service");
const { readReportPayload } = require("../../services/report-payload-store.service");
const { createAuditLog } = require("../../services/audit.service");
const { emitToRole } = require("../../realtime/socket");
const { ApiError, asyncHandler } = require("../../utils/http");
const { clampPercent, getSubmissionScorePercent, getTestTotalMarks } = require("../../utils/score");
const { describeDistribution } = require("../../utils/stats");
const { isQuestionCorrect } = require("../../services/test.service");
const { computeItemAnalysis } = require("../../services/item-analysis.service");
const { computeIntegrityAnalytics } = require("../../services/integrity-analysis.service");
const { computeCohortTrends } = require("../../services/cohort-trends.service");
const { computeAtRisk } = require("../../services/at-risk.service");
const { toCsv, buildFileName } = require("../../services/csv-export.service");
const { buildXlsxBuffer, buildXlsxFileName } = require("../../services/xlsx-export.service");
const {
  resolveExportDatasetConfig,
  buildAtRiskStudentInput,
  buildTestResultRows,
  parseExportTestIds,
} = require("../../services/report-export-datasets.service");
const { collectSubmissions } = require("../../services/submission-batch.service");
const { getScopedDepartmentId } = require("../../utils/admin-scope");
const {
  aggregateModulePerformance,
  buildSubmissionModuleColumns,
} = require("../../services/report-analytics-aggregation.service");
const {
  ASSESSMENT_FORMATS,
  normalizeAssessmentFormat,
} = require("../../services/test-config.service");
const {
  buildAdminTestVisibilityWhere,
  resolveAdminTestScope,
} = require("../../utils/admin-test-access");
const {
  REPORTABLE_SUBMISSION_STATUSES,
  buildStudentLifecycleWhere,
  buildReportScopeMetadata,
  normalizeStudentScope,
  normalizePassoutYear,
  normalizeOptionalId,
} = require("../../services/report-scope.service");

const MAX_ANALYTICS_SUBMISSIONS = 20000;
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

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const resolveSubmissionStudentId = (submission) => submission?.userId || submission?.studentId || submission?.user?.id || null;
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

const normalizeId = (value) => String(value || "").trim();

const normalizeIdList = (values = []) =>
  [...new Set(values.map((value) => normalizeId(value)).filter(Boolean))];

const getStudentBatchIds = (student = {}) =>
  normalizeIdList([student.batchId, ...(Array.isArray(student.batchIds) ? student.batchIds : [])]);

const getTestBatchIds = (test = {}) =>
  normalizeIdList([
    test.batchId,
    ...(Array.isArray(test.batchAssignments) ? test.batchAssignments.map((assignment) => assignment.batchId) : []),
  ]);

const normalizeYearList = (values = []) =>
  Array.isArray(values)
    ? [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 4))]
    : [];

const isStudentAssignedToTest = (student = {}, test = null) => {
  if (!test?.id) return true;

  const assignmentMethod = String(test.assignmentMethod || "").trim().toLowerCase();
  const studentDepartmentId = normalizeId(student.departmentId);
  const studentBatchIds = getStudentBatchIds(student);
  const testYears = normalizeYearList(test.years);

  if (testYears.length > 0 && !testYears.includes(Number(student.year))) {
    return false;
  }

  if (assignmentMethod === "everyone") {
    return true;
  }

  if (assignmentMethod === "department_wise") {
    const departmentIds = normalizeIdList([test.departmentId, ...(Array.isArray(test.assignedTo) ? test.assignedTo : [])]);
    return departmentIds.length > 0 && departmentIds.includes(studentDepartmentId);
  }

  if (assignmentMethod === "batch_wise") {
    const batchIds = getTestBatchIds(test);
    return batchIds.length > 0 && studentBatchIds.some((batchId) => batchIds.includes(batchId));
  }

  const legacyDepartmentIds = normalizeIdList([test.departmentId, ...(Array.isArray(test.assignedTo) ? test.assignedTo : [])]);
  const legacyBatchIds = getTestBatchIds(test);
  return (
    (legacyDepartmentIds.length > 0 && legacyDepartmentIds.includes(studentDepartmentId))
    || (legacyBatchIds.length > 0 && studentBatchIds.some((batchId) => legacyBatchIds.includes(batchId)))
    || (legacyDepartmentIds.length === 0 && legacyBatchIds.length === 0)
  );
};

const normalizeStudentYear = (value) => {
  if (value == null || value === "") return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1 && year <= 4 ? year : null;
};

const buildEmptyAnalyticsPayload = (mode = "department") => ({
  mode,
  metrics: {
    avgScore: 0,
    passRate: 0,
    participationRate: 0,
    violations: 0,
  },
  scoreTrend: [],
  topicPerformance: [],
  departmentComparative: [],
  batchComparative: [],
  distribution: [
    { range: "0-20", count: 0 },
    { range: "21-40", count: 0 },
    { range: "41-60", count: 0 },
    { range: "61-80", count: 0 },
    { range: "81-100", count: 0 },
  ],
  distributionStats: { count: 0, mean: 0, median: 0, q1: 0, q3: 0, iqr: 0, stdDev: 0, min: 0, max: 0 },
  tableRows: [],
  attemptHistory: [],
  selectedStudent: null,
  notAttended: {
    count: 0,
    students: [],
    testId: null,
    testName: null,
  },
  anomalyAlerts: [],
});

const buildAdminReportScope = async ({ db, req, filters = {}, testSelect = { id: true } }) => {
  let scope;
  try {
    scope = await resolveAdminTestScope({ db, req, filters });
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.statusCode)) {
      return { ok: false, reason: error.code || "SCOPE_OUT_OF_RANGE" };
    }
    throw error;
  }

  const testWhere = buildAdminTestVisibilityWhere({
    collegeId: scope.collegeId,
    departmentId: scope.departmentId,
    batchId: scope.batchId,
    batchIds: scope.batchIds,
    testId: filters.testId || null,
  });

  const tests = await db.test.findMany({
    where: testWhere,
    select: testSelect,
  });

  return {
    ok: true,
    tests,
    testIds: normalizeIdList(tests.map((test) => test.id)),
    departmentId: scope.departmentId,
    batchId: scope.batchId,
    batchIds: scope.batchIds,
  };
};

const getReportJobDepartmentId = (job = {}) => job?.filters?.departmentId || null;

// Department admins may only read/download their own report jobs. College
// level (departmentId-less) jobs span multiple departments, so they are also
// out of scope for a department-scoped admin. Super admins and college admins
// are unaffected.
const assertReportJobDepartmentScope = (req, job = {}) => {
  const adminDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  if (!adminDepartmentId) {
    return;
  }
  const jobDepartmentId = getReportJobDepartmentId(job);
  if (!jobDepartmentId || String(jobDepartmentId) !== String(adminDepartmentId)) {
    throw new ApiError(403, "Report job is outside the admin department scope", null, "CROSS_DEPARTMENT_REPORT_JOB_ACCESS");
  }
};

const getReportJobStatus = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.reportJob.findFirst({
    where: {
      id: reportJobId,
      collegeId: req.collegeId,
    },
  });

  if (!job) {
    return res.status(404).json({ message: "Report job not found" });
  }

  assertReportJobDepartmentScope(req, job);

  const expiresAt = job?.filters?.resultUrlExpiresAt || null;
  const progress = Number(job?.filters?.progress || 0);

  res.status(200).json({
    jobId: job.id,
    status: String(job.status || "QUEUED").toLowerCase(),
    progress,
    download_url: job.resultUrl || null,
    expires_at: expiresAt,
  });
});

const buildReportAnalyticsPayload = async (req, queryOverrides = {}) => {
  const reportReq = {
    ...req,
    query: {
      ...(req.query || {}),
      ...queryOverrides,
    },
  };
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const mode = reportReq.query.mode;
  const testId = reportReq.query.testId;
  const departmentId = reportReq.query.departmentId;
  const batchId = reportReq.query.batchId;
  const studentId = reportReq.query.studentId;
  const year = normalizeStudentYear(reportReq.query.year);
  const reportScopeFilters = {
    studentScope: normalizeStudentScope(reportReq.query.studentScope),
    passoutYear: normalizePassoutYear(reportReq.query.passoutYear),
    passoutCohortId: normalizeOptionalId(reportReq.query.passoutCohortId),
  };
  const studentLifecycleWhere = buildStudentLifecycleWhere(reportScopeFilters);
  const dateFrom = reportReq.query.dateFrom;
  const dateTo = reportReq.query.dateTo;
  const dateFromValue = toValidDate(dateFrom);
  const dateToValue = toValidDate(dateTo);

  const scope = await buildAdminReportScope({
    db,
    req: reportReq,
    filters: { testId, departmentId, batchId },
    testSelect: {
      id: true,
      title: true,
      subject: true,
      totalMarks: true,
      years: true,
      assignmentMethod: true,
      assignedTo: true,
      departmentId: true,
      batchId: true,
      batchAssignments: { select: { batchId: true } },
      assessmentFormat: true,
      modules: true,
    },
  });

  if (!scope.ok || scope.testIds.length === 0) {
    return buildEmptyAnalyticsPayload(mode);
  }

  const tests = Array.isArray(scope.tests) ? scope.tests : [];
  const testIds = scope.testIds;
  const scopedDepartmentId = scope.departmentId;
  const scopedBatchId = scope.batchId;

  const studentWhere = {
    collegeId,
    ...studentLifecycleWhere,
    ...(scopedDepartmentId ? { departmentId: scopedDepartmentId } : {}),
    ...(scopedBatchId
      ? {
          OR: [
            { batchId: scopedBatchId },
            { batchIds: { in: [scopedBatchId] } },
          ],
        }
      : {}),
    ...(studentId ? { id: studentId } : {}),
    ...(year ? { year } : {}),
  };
  const students = await db.student.findMany({
    where: studentWhere,
    include: {
      department: { select: { id: true, name: true } },
      batch: { select: { id: true, name: true } },
    },
  });
  const hasSelectedTest = Boolean(testId);
  const selectedTest = hasSelectedTest
    ? tests.find((test) => normalizeId(test.id) === normalizeId(testId)) || tests[0]
    : null;
  const reportStudents = hasSelectedTest
    ? students.filter((student) => isStudentAssignedToTest(student, selectedTest))
    : students;
  const scopedStudentIds = reportStudents.map((student) => String(student.id));
  const submissionStudentFilter = studentId
    ? (scopedStudentIds.includes(String(studentId)) ? { userId: studentId } : { userId: { in: [] } })
    : { userId: { in: scopedStudentIds } };

  const submissionWhere = {
    collegeId,
    ...(testIds.length ? { testId: { in: testIds } } : {}),
    ...submissionStudentFilter,
    status: { in: REPORTABLE_SUBMISSION_STATUSES },
    ...(dateFromValue || dateToValue
      ? {
          submittedAt: {
            ...(dateFromValue ? { gte: dateFromValue } : {}),
            ...(dateToValue ? { lte: dateToValue } : {}),
          },
        }
      : {}),
  };

  const submissionCount = await db.submission.count({ where: submissionWhere });
  if (submissionCount > MAX_ANALYTICS_SUBMISSIONS && !studentId) {
    throw new ApiError(
      413,
      "Report scope is too large. Select a test, student, or date range before loading analytics.",
      { submissionCount, maxSubmissions: MAX_ANALYTICS_SUBMISSIONS },
      "REPORT_SCOPE_TOO_LARGE"
    );
  }

  const submissions = await db.submission.findMany({
    where: submissionWhere,
    include: {
      user: { select: { id: true, fullName: true, studentId: true, enrollNumber: true, enrollmentNumber: true, year: true, departmentId: true, batchId: true, batchIds: true } },
      test: { select: { id: true, title: true, subject: true, totalMarks: true } },
      violations: {
        select: {
          id: true,
          type: true,
          createdAt: true,
          metadata: true,
        },
      },
    },
    orderBy: { submittedAt: "asc" },
  });

  const scopedSubmissions = submissions.filter((item) => {
    if (scopedDepartmentId && item.user?.departmentId !== scopedDepartmentId) return false;
    if (year && Number(item.user?.year) !== year) return false;
    if (
      scopedBatchId &&
      item.user?.batchId !== scopedBatchId &&
      !(Array.isArray(item.user?.batchIds) && item.user.batchIds.some((id) => String(id) === String(scopedBatchId)))
    ) return false;

    const eventDate = toValidDate(item.submittedAt || item.updatedAt || item.createdAt);
    if (dateFromValue && (!eventDate || eventDate < dateFromValue)) return false;
    if (dateToValue && (!eventDate || eventDate > dateToValue)) return false;

    return true;
  });

  const departments = await db.department.findMany({ where: { collegeId }, select: { id: true, name: true } });
  const batches = await db.batch.findMany({ where: { collegeId }, select: { id: true, name: true, year: true } });

  const submissionsByStudent = new Map();
  scopedSubmissions.forEach((item) => {
    const key = resolveSubmissionStudentId(item);
    if (!key) return;
    const list = submissionsByStudent.get(key) || [];
    list.push(item);
    submissionsByStudent.set(key, list);
  });

  const studentRows = reportStudents.map((student) => {
    const rows = submissionsByStudent.get(student.id) || [];
    const average = rows.length ? rows.reduce((sum, row) => sum + getScorePercent(row), 0) / rows.length : 0;
    const violations = rows.reduce((sum, row) => sum + Number(row.violationCount || row.violations?.length || 0), 0);
    const violationEvents = rows
      .flatMap((row) =>
        (row.violations || []).map((violation) => ({
          id: violation.id,
          type: violation.type,
          anomalyId: violation.id,
          anomalyType: violation.type,
          createdAt: violation.createdAt,
          metadata: violation.metadata || null,
          testId: row.testId,
          testName: row.test?.title || "Test",
          submissionId: row.id,
        }))
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      studentId: student.id,
      name: student.fullName,
      rollNo: getStudentNumber(student),
      departmentId: student.departmentId,
      departmentName: student.department?.name || "-",
      batchId: student.batchId,
      batchIds: getStudentBatchIds(student),
      batchName: student.batch?.name || "-",
      year: student.year || null,
      avgScore: toPercent(average),
      testsTaken: rows.length,
      violations,
      violationEvents,
      participation: tests.length > 0 ? toPercent((rows.length / tests.length) * 100) : 0,
    };
  });

  const notAttendedRows = hasSelectedTest ? studentRows.filter((row) => row.testsTaken === 0) : [];
  const notAttendedStudents = notAttendedRows.map((row) => ({
    studentId: row.studentId,
    name: row.name,
    rollNo: row.rollNo,
    department: row.departmentName,
    batch: row.batchName,
  }));

  const attendedRows = studentRows.filter((row) => row.testsTaken > 0);
  const ranked = [...attendedRows].sort((a, b) => b.avgScore - a.avgScore).map((item, index) => ({ ...item, rank: index + 1 }));
  const avgScore = ranked.length ? ranked.reduce((sum, row) => sum + row.avgScore, 0) / ranked.length : 0;
  const passRate = scopedSubmissions.length
    ? (scopedSubmissions.filter((row) => getScorePercent(row) >= 40).length / scopedSubmissions.length) * 100
    : 0;
  const participatingStudents = attendedRows.length;
  const participationRate = studentRows.length ? (participatingStudents / studentRows.length) * 100 : 0;
  const totalViolations = ranked.reduce((sum, item) => sum + item.violations, 0);

  const trendMap = new Map();
  scopedSubmissions.forEach((row) => {
    const key = deriveMonthKey(row.submittedAt || row.updatedAt || row.createdAt);
    const existing = trendMap.get(key) || { total: 0, count: 0 };
    existing.total += getScorePercent(row);
    existing.count += 1;
    trendMap.set(key, existing);
  });

  const scoreTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, stat]) => ({ month, score: toPercent(stat.total / Math.max(1, stat.count)) }));

  const topicMap = new Map();
  scopedSubmissions.forEach((row) => {
    const topic = row.test?.subject || "General";
    const existing = topicMap.get(topic) || { total: 0, count: 0 };
    existing.total += getScorePercent(row);
    existing.count += 1;
    topicMap.set(topic, existing);
  });

  const topicPerformance = Array.from(topicMap.entries()).map(([topic, stat]) => ({
    topic,
    score: toPercent(stat.total / Math.max(1, stat.count)),
  }));

  const departmentComparative = departments.map((department) => {
    const rows = studentRows.filter((row) => row.departmentId === department.id);
    const attendedDepartmentRows = rows.filter((row) => row.testsTaken > 0);
    const deptAvg = attendedDepartmentRows.length ? attendedDepartmentRows.reduce((sum, row) => sum + row.avgScore, 0) / attendedDepartmentRows.length : 0;
    const deptParticipation = rows.length ? (attendedDepartmentRows.length / rows.length) * 100 : 0;
    const deptPassRate = attendedDepartmentRows.length ? (attendedDepartmentRows.filter((row) => row.avgScore >= 40).length / attendedDepartmentRows.length) * 100 : 0;
    return {
      departmentId: department.id,
      departmentName: department.name,
      avgScore: toPercent(deptAvg),
      passRate: toPercent(deptPassRate),
      participationRate: toPercent(deptParticipation),
    };
  });

  const batchComparative = batches.map((batch) => {
    const rows = studentRows.filter((row) => row.batchId === batch.id || row.batchIds.includes(batch.id));
    const attendedBatchRows = rows.filter((row) => row.testsTaken > 0);
    const value = attendedBatchRows.length ? attendedBatchRows.reduce((sum, row) => sum + row.avgScore, 0) / attendedBatchRows.length : 0;
    const pass = attendedBatchRows.length ? (attendedBatchRows.filter((row) => row.avgScore >= 40).length / attendedBatchRows.length) * 100 : 0;
    const participation = rows.length ? (attendedBatchRows.length / rows.length) * 100 : 0;
    return {
      batchId: batch.id,
      batchName: batch.name,
      avgScore: toPercent(value),
      passRate: toPercent(pass),
      participationRate: toPercent(participation),
    };
  });

  const distributionBase = {
    "0-20": 0,
    "21-40": 0,
    "41-60": 0,
    "61-80": 0,
    "81-100": 0,
  };
  ranked.forEach((row) => {
    distributionBase[scoreBand(row.avgScore)] += 1;
  });

  const selectedStudent = ranked.find((row) => row.studentId === studentId) || null;
  const attemptHistory = scopedSubmissions
    .filter((row) => {
      const rowStudentId = resolveSubmissionStudentId(row);
      return !studentId || rowStudentId === studentId;
    })
    .map((row) => ({
      id: row.id,
      testId: row.testId,
      testName: row.test?.title || "Test",
      scorePercent: getScorePercent(row),
      timeTaken: Number(row.timeSpentSeconds || 0),
      date: row.submittedAt || row.updatedAt || row.createdAt,
      status: row.status,
      violationsCount: Number(row.violationCount || row.violations?.length || 0),
      violationEvents: (row.violations || []).map((violation) => ({
        id: violation.id,
        type: violation.type,
        anomalyId: violation.id,
        anomalyType: violation.type,
        testId: row.testId,
        createdAt: violation.createdAt,
        metadata: violation.metadata || null,
        testName: row.test?.title || "Test",
        submissionId: row.id,
      })),
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    mode,
    filters: buildReportScopeMetadata(reportScopeFilters),
    metrics: {
      avgScore: toPercent(avgScore),
      passRate: toPercent(passRate),
      participationRate: toPercent(participationRate),
      violations: totalViolations,
      // Volume counters mirroring the super-admin metrics shape so the same
      // StatCard row renders from either portal's analytics payload.
      totalStudents: studentRows.length,
      attemptedStudents: participatingStudents,
      totalTests: tests.length,
      totalSubmissions: scopedSubmissions.length,
    },
    scoreTrend,
    topicPerformance,
    departmentComparative,
    batchComparative,
    distribution: Object.entries(distributionBase).map(([range, count]) => ({ range, count })),
    distributionStats: describeDistribution(ranked.map((row) => row.avgScore)),
    tableRows: ranked,
    attemptHistory,
    selectedStudent,
    notAttended: {
      count: hasSelectedTest ? notAttendedStudents.length : 0,
      students: hasSelectedTest ? notAttendedStudents : [],
      testId: hasSelectedTest ? testId : null,
      testName: selectedTest?.title || null,
    },
    // MODULE_TEST-only: per-module stats/nullable summary + per-submission rows
    // keyed by submissionId. Rendered as module columns in the deep-dive
    // student results table and as summary cards. null for OPEN_TEST scopes.
    modulePerformance: (() => {
      const moduleAssessmentTest = hasSelectedTest
        ? selectedTest
        : testIds.length === 1
          ? tests[0]
          : null;
      return moduleAssessmentTest &&
        normalizeAssessmentFormat(moduleAssessmentTest.assessmentFormat) === ASSESSMENT_FORMATS.MODULE_TEST
        ? aggregateModulePerformance(scopedSubmissions, { modules: moduleAssessmentTest.modules })
        : null;
    })(),
    // Retained for response-shape stability; the identical-answer-pattern /
    // fast-high-score heuristics were unused by any client and forced loading
    // every submission's answer array. Integrity signals now live in the
    // dedicated /reports/integrity endpoint.
    anomalyAlerts: [],
  };
};

const getReportAnalytics = asyncHandler(async (req, res) => {
  const payload = await buildReportAnalyticsPayload(req);
  res.status(200).json(payload);
});

// Query strings can be parsed into nested objects (?testId[not]=x). These
// values end up in DB filters, so accept only plain scalars.
const toScalarQueryValue = (value) => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
};

const resolveDateFilters = (query = {}) => {
  const dateFromInput = query.dateFrom;
  const dateToInput = query.dateTo;
  const validDateFrom = toValidDate(dateFromInput);
  const validDateTo = toValidDate(dateToInput);

  const result = {
    testId: toScalarQueryValue(query.testId),
    departmentId: toScalarQueryValue(query.departmentId),
    batchId: toScalarQueryValue(query.batchId),
    studentId: toScalarQueryValue(query.studentId),
    year: normalizeStudentYear(query.year) || undefined,
    studentScope: normalizeStudentScope(query.studentScope),
    passoutYear: normalizePassoutYear(query.passoutYear) || undefined,
    passoutCohortId: normalizeOptionalId(query.passoutCohortId) || undefined,
    dateFrom: validDateFrom ? validDateFrom.toISOString() : undefined,
    dateTo: validDateTo ? validDateTo.toISOString() : undefined,
    mode: toScalarQueryValue(query.mode) || "department",
  };

  if (!result.dateFrom && !result.dateTo && query.dateRange && query.dateRange !== "custom") {
    const now = Date.now();
    const days = query.dateRange === "7d" ? 7 : query.dateRange === "90d" ? 90 : 30;
    result.dateFrom = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    result.dateTo = new Date(now).toISOString();
  }

  return result;
};

// Short-lived in-process memo: /summary and /charts both need the full
// analytics payload for the same scope, and report generation reuses it too.
// Sharing the in-flight promise collapses those into ONE computation per node
// per window. The Redis response cache remains the cross-node/HTTP layer; this
// only removes duplicate heavy work behind it. 15s staleness matches the
// admin-reports response-cache TTL semantics.
const ANALYTICS_MEMO_TTL_MS = 15_000;
const analyticsMemo = new Map();

const buildAnalyticsMemoKey = (req, overrides = {}) => {
  const query = { ...(req.query || {}), ...overrides };
  const sortedQuery = Object.keys(query)
    .sort()
    .reduce((accumulator, key) => {
      accumulator[key] = query[key];
      return accumulator;
    }, {});
  return JSON.stringify({
    collegeId: req.collegeId || null,
    adminId: req.admin?.id || null,
    departmentId: req.admin?.departmentId || null,
    role: req.admin?.role || null,
    query: sortedQuery,
  });
};

const fetchAnalyticsPayload = (req, filters = {}) => {
  const key = buildAnalyticsMemoKey(req, filters);
  const now = Date.now();
  const cached = analyticsMemo.get(key);
  if (cached && now - cached.at < ANALYTICS_MEMO_TTL_MS) {
    return cached.promise;
  }

  const promise = buildReportAnalyticsPayload(req, filters).catch((error) => {
    // Never memoise a failure.
    analyticsMemo.delete(key);
    throw error;
  });
  analyticsMemo.set(key, { at: now, promise });

  if (analyticsMemo.size > 500) {
    for (const [entryKey, entry] of analyticsMemo) {
      if (now - entry.at > ANALYTICS_MEMO_TTL_MS) analyticsMemo.delete(entryKey);
    }
  }

  return promise;
};

const getReportSummaryDashboard = asyncHandler(async (req, res) => {
  const filters = resolveDateFilters(req.query || {});
  const analytics = await fetchAnalyticsPayload(req, filters);
  const tableRows = Array.isArray(analytics?.tableRows) ? analytics.tableRows : [];
  const attempted = tableRows.filter((item) => Number(item.testsTaken || 0) > 0);
  const scores = tableRows.map((item) => Number(item.avgScore || 0));
  const highestScore = scores.length ? Math.max(...scores) : 0;
  const lowestScore = scores.length ? Math.min(...scores) : 0;

  res.status(200).json({
    summary: {
      totalStudentsAttempted: attempted.length,
      averageScore: Number(analytics?.metrics?.avgScore || 0),
      highestScore: Number(highestScore || 0),
      lowestScore: Number(lowestScore || 0),
      completionRate: Number(analytics?.metrics?.participationRate || 0),
    },
    sparkline: Array.isArray(analytics?.scoreTrend) ? analytics.scoreTrend : [],
    leaderboard: tableRows.slice(0, 10).map((item) => ({
      studentId: item.studentId,
      rank: item.rank,
      name: item.name,
      batch: item.batchName,
      score: item.avgScore,
    })),
  });
});

const getReportChartsDashboard = asyncHandler(async (req, res) => {
  const filters = resolveDateFilters(req.query || {});
  const analytics = await fetchAnalyticsPayload(req, filters);
  const topPerformers = (analytics?.tableRows || []).slice(0, 10).map((item) => ({
    studentId: item.studentId,
    studentName: item.name,
    score: Number(item.avgScore || 0),
  }));

  res.status(200).json({
    scoreDistribution: analytics?.distribution || [],
    performanceTrend: (analytics?.scoreTrend || []).map((item) => ({
      date: item.month,
      averageScore: Number(item.score || 0),
    })),
    departmentPerformance: (analytics?.departmentComparative || []).map((item) => ({
      department: item.departmentName,
      avgScore: Number(item.avgScore || 0),
      passRate: Number(item.passRate || 0),
      participationRate: Number(item.participationRate || 0),
    })),
    topPerformers,
  });
});

const getReportTableDashboard = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const filters = resolveDateFilters(req.query || {});
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const sortBy = String(req.query.sortBy || "date");
  const sortDir = String(req.query.sortDir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const search = String(req.query.search || req.query.studentSearch || "").trim().toLowerCase();

  const scope = await buildAdminReportScope({
    db,
    req,
    filters: {
      testId: filters.testId,
      departmentId: filters.departmentId,
      batchId: filters.batchId,
    },
  });

  if (!scope.ok || scope.testIds.length === 0) {
    return res.status(200).json({
      data: [],
      pagination: {
        page: 1,
        limit,
        total: 0,
        totalPages: 1,
      },
    });
  }

  const scopedDepartmentId = scope.departmentId;
  const scopedBatchId = scope.batchId;
  const studentLifecycleWhere = buildStudentLifecycleWhere(filters);
  const tableStudentWhere = {
    collegeId: req.collegeId,
    ...studentLifecycleWhere,
    ...(filters.studentId ? { id: filters.studentId } : {}),
    ...(scopedDepartmentId ? { departmentId: scopedDepartmentId } : {}),
    ...(filters.year ? { year: filters.year } : {}),
    ...(scopedBatchId
      ? {
          OR: [
            { batchId: scopedBatchId },
            { batchIds: { in: [scopedBatchId] } },
          ],
        }
      : {}),
  };
  const tableStudents = await db.student.findMany({ where: tableStudentWhere, select: { id: true } });
  const tableStudentIds = tableStudents.map((student) => String(student.id));
  const submissionStudentFilter = filters.studentId
    ? (tableStudentIds.includes(String(filters.studentId)) ? { userId: filters.studentId } : { userId: { in: [] } })
    : { userId: { in: tableStudentIds } };

  const submissions = await db.submission.findMany({
    where: {
      collegeId: req.collegeId,
      status: { in: REPORTABLE_SUBMISSION_STATUSES },
      ...(scope.testIds.length ? { testId: { in: scope.testIds } } : {}),
      ...submissionStudentFilter,
      ...(filters.dateFrom || filters.dateTo
        ? {
            submittedAt: {
              ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
            },
          }
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
        select: {
          title: true,
          totalMarks: true,
          assessmentFormat: true,
          modules: true,
          questions: {
            select: {
              id: true,
              marks: true,
            },
          },
        },
      },
      violations: {
        select: { id: true, type: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { violations: true },
      },
    },
    orderBy: { submittedAt: "desc" },
  });

  const attemptsPerStudent = submissions.reduce((acc, submission) => {
    const key = resolveSubmissionStudentId(submission);
    if (!key) return acc;
    acc[key] = Number(acc[key] || 0) + 1;
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
      studentId: resolveSubmissionStudentId(submission),
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
      attemptCount: Number(attemptsPerStudent[resolveSubmissionStudentId(submission)] || 0),
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
    rows = rows.filter((row) => {
      const text = `${row.studentName} ${row.studentRollNo} ${row.department} ${row.batch} ${row.testName}`.toLowerCase();
      return text.includes(search);
    });
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
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
    },
  });
});

// Derived lifecycle status for a test, mirroring the admin tests controller's
// deriveLifecycleStatus(): a test reads as COMPLETED once its window closes even
// if the stored status is still LIVE/PUBLISHED.
const deriveTestListStatus = (test = {}) => {
  const raw = String(test.status || "").trim().toUpperCase();
  if (raw === "DRAFT" || raw === "ARCHIVED") {
    return raw;
  }
  const now = Date.now();
  const startsAt = test.startsAt ? new Date(test.startsAt).getTime() : null;
  const endsAt = test.endsAt ? new Date(test.endsAt).getTime() : null;
  if (startsAt && startsAt > now) return "SCHEDULED";
  if (endsAt && endsAt < now) return "COMPLETED";
  return "LIVE";
};

// Paginated, per-test aggregate list powering the Reports "Tests" tab.
// Scoped submissions are collected in batches (collectSubmissions, up to its
// memory-safety ceiling with honest truncation) and grouped in memory, so the
// list is a single request per page rather than N per-test analytics calls.
const buildReportTestsPayload = async (req) => {
  const m = await models.init();
  const db = m.dbClient;
  const filters = resolveDateFilters(req.query || {});
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const sortBy = String(req.query.sortBy || "startsAt");
  const sortDir = String(req.query.sortDir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const search = String(req.query.search || "").trim().toLowerCase();
  const statusFilter = String(req.query.status || "").trim().toUpperCase();

  const scope = await buildAdminReportScope({
    db,
    req,
    filters: {
      departmentId: filters.departmentId,
      batchId: filters.batchId,
    },
    testSelect: {
      id: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      totalMarks: true,
      departmentId: true,
      batchId: true,
      department: { select: { name: true } },
      batch: { select: { name: true } },
      questions: { select: { marks: true } },
    },
  });

  if (!scope.ok || scope.testIds.length === 0) {
    return { data: [], pagination: { page: 1, limit, total: 0, totalPages: 1 } };
  }

  // In-scope student count is the participation denominator, mirroring the
  // Overview participationRate (participatingStudents / studentsInScope).
  const studentLifecycleWhere = buildStudentLifecycleWhere(filters);
  const scopedStudentWhere = {
    collegeId: req.collegeId,
    ...studentLifecycleWhere,
    ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
    ...(filters.year ? { year: filters.year } : {}),
    ...(scope.batchId
      ? { OR: [{ batchId: scope.batchId }, { batchIds: { in: [scope.batchId] } }] }
      : {}),
  };
  const scopedStudents = await db.student.findMany({ where: scopedStudentWhere, select: { id: true } });
  const inScopeStudentCount = scopedStudents.length;

  const { rows: submissions, truncated } = await collectSubmissions({
    db,
    where: {
      collegeId: req.collegeId,
      status: { in: REPORTABLE_SUBMISSION_STATUSES },
      testId: { in: scope.testIds },
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
      testId: true,
      userId: true,
      score: true,
      accuracy: true,
      _count: { select: { violations: true } },
    },
  });

  const testTotalMarks = new Map(scope.tests.map((test) => [String(test.id), getTestTotalMarks(test)]));
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
    if (scorePercent >= 40) current.passCount += 1;
    current.violations += Number(submission._count?.violations || 0);
    if (submission.userId) current.students.add(String(submission.userId));
    byTest.set(testKey, current);
  }

  let rows = scope.tests.map((test) => {
    const agg = byTest.get(String(test.id)) || { count: 0, scoreSum: 0, passCount: 0, violations: 0, students: new Set() };
    const submissionCount = agg.count;
    return {
      testId: test.id,
      id: test.id,
      title: test.title || "Untitled test",
      status: deriveTestListStatus(test),
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

  // Status filter runs on the DERIVED lifecycle status, so "COMPLETED" also
  // matches tests whose stored status is still LIVE but whose window closed.
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

const getReportTestsDashboard = asyncHandler(async (req, res) => {
  res.status(200).json(await buildReportTestsPayload(req));
});

// Loads the scoped submissions for one test plus their answers, shared by the
// item-analysis and integrity endpoints.
const loadTestAttemptData = async ({ db, req, testId }) => {
  const scope = await buildAdminReportScope({
    db,
    req,
    filters: { testId },
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

  if (!scope.ok || !scope.testIds.includes(String(testId))) {
    return { ok: false };
  }

  const test = scope.tests.find((item) => String(item.id) === String(testId));
  if (!test) return { ok: false };

  const { rows: submissions, truncated } = await collectSubmissions({
    db,
    where: {
      collegeId: req.collegeId,
      testId,
      status: { in: REPORTABLE_SUBMISSION_STATUSES },
    },
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

const getReportItemAnalysis = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const testId = String(req.query.testId || "").trim();

  if (!testId) {
    throw new ApiError(400, "testId is required for item analysis", null, "TEST_ID_REQUIRED");
  }

  const data = await loadTestAttemptData({ db, req, testId });
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

  // Resolve correctness here (persisted isCorrect can be null on older rows) so
  // the statistics service stays pure.
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

const getReportIntegrity = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const testId = String(req.query.testId || "").trim();

  if (!testId) {
    throw new ApiError(400, "testId is required for integrity analytics", null, "TEST_ID_REQUIRED");
  }

  const data = await loadTestAttemptData({ db, req, testId });
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

// Loads scoped submissions joined to their student, shared by the trends and
// at-risk endpoints.
// onlyTestIds narrows the scope to a selection (the multi-test "results" export).
const loadScopedAttempts = async ({ db, req, filters, onlyTestIds = null }) => {
  const scope = await buildAdminReportScope({
    db,
    req,
    filters: { departmentId: filters.departmentId, batchId: filters.batchId },
    testSelect: { id: true, title: true, totalMarks: true, endsAt: true, questions: { select: { marks: true } } },
  });

  if (!scope.ok || scope.testIds.length === 0) return { ok: false };
  if (Array.isArray(onlyTestIds) && onlyTestIds.length > 0) {
    const wanted = new Set(onlyTestIds.map(String));
    scope.tests = scope.tests.filter((test) => wanted.has(String(test.id)));
    scope.testIds = scope.testIds.filter((id) => wanted.has(String(id)));
    if (scope.testIds.length === 0) return { ok: false };
  }

  const studentWhere = {
    collegeId: req.collegeId,
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
          collegeId: req.collegeId,
          status: { in: REPORTABLE_SUBMISSION_STATUSES },
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
    totalMarks: testTotals.get(String(submission.testId)) || 0,
    date: submission.submittedAt || submission.createdAt,
    violations: Number(submission._count?.violations || 0),
  }));

  return { ok: true, scope, students, attempts, truncated };
};

const getReportTrends = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const filters = resolveDateFilters(req.query || {});
  const groupBy = String(req.query.groupBy || "department").toLowerCase() === "batch" ? "batch" : "department";
  const indexToBase = String(req.query.indexed || "") === "true";

  const data = await loadScopedAttempts({ db, req, filters });
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

const getReportAtRisk = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const filters = resolveDateFilters(req.query || {});

  const data = await loadScopedAttempts({ db, req, filters });
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

/**
 * Assembles the export rows for a dataset. Reuses the same scoping and
 * computation as the JSON endpoints so an export can never show data the
 * requester cannot see in the UI. Shared by the CSV and XLSX handlers so the
 * two formats can never diverge.
 */
const buildExportDataset = async (req) => {
  const m = await models.init();
  const db = m.dbClient;
  const { dataset, config } = resolveExportDatasetConfig(req.query.dataset);

  const filters = resolveDateFilters(req.query || {});
  let rows = [];

  if (dataset === "at-risk") {
    const data = await loadScopedAttempts({ db, req, filters });
    if (data.ok) {
      rows = computeAtRisk({ students: buildAtRiskStudentInput(data) }).students;
    }
  } else if (dataset === "item-analysis") {
    const testId = String(req.query.testId || "").trim();
    if (!testId) {
      throw new ApiError(400, "testId is required to export item analysis", null, "TEST_ID_REQUIRED");
    }
    const data = await loadTestAttemptData({ db, req, testId });
    if (data.ok) {
      const questions = Array.isArray(data.test.questions) ? data.test.questions : [];
      const questionById = new Map(questions.map((question) => [String(question.id), question]));
      const answerRows = data.submissions.length
        ? await db.answer.findMany({
            where: { submissionId: { in: data.submissions.map((submission) => submission.id) } },
            select: {
              submissionId: true, questionId: true, selectedOption: true, selectedOptions: true,
              selectedBoolean: true, selectedText: true, answerBoolean: true, answerText: true,
              isCorrect: true, markedForReview: true, timeSpentSeconds: true,
            },
          })
        : [];
      const answers = answerRows.map((answer) => {
        const question = questionById.get(String(answer.questionId));
        const resolved = typeof answer.isCorrect === "boolean"
          ? answer.isCorrect
          : question ? Boolean(isQuestionCorrect(question, answer)) : false;
        return { ...answer, isCorrect: resolved };
      });
      rows = computeItemAnalysis({ questions, submissions: data.attempts, answers }).items;
    }
  } else if (dataset === "results") {
    const testIds = parseExportTestIds(req.query.testIds);
    const data = await loadScopedAttempts({ db, req, filters, onlyTestIds: testIds });
    rows = data.ok ? buildTestResultRows(data) : [];
  } else if (dataset === "tests") {
    // Same builder the Tests tab uses, so the export can never diverge from it.
    const payload = await buildReportTestsPayload({ ...req, query: { ...req.query, page: 1, limit: 100 } });
    rows = Array.isArray(payload?.data) ? payload.data : [];
  }

  return { config, rows };
};

const exportReportCsv = asyncHandler(async (req, res) => {
  const { config, rows } = await buildExportDataset(req);
  const csv = toCsv(config.columns, rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${buildFileName(config.prefix)}"`);
  res.status(200).send(csv);
});

const exportReportXlsx = asyncHandler(async (req, res) => {
  const { config, rows } = await buildExportDataset(req);
  const buffer = await buildXlsxBuffer({ sheetName: config.prefix, columns: config.columns, rows });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${buildXlsxFileName(config.prefix)}"`);
  res.status(200).send(Buffer.from(buffer));
});

const getReportStudentDetailDashboard = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const studentId = req.params.studentId;
  const filters = resolveDateFilters({ ...req.query, studentId });
  const scope = await buildAdminReportScope({
    db,
    req,
    filters: {
      testId: filters.testId,
      departmentId: filters.departmentId,
      batchId: filters.batchId,
    },
  });

  if (!scope.ok || scope.testIds.length === 0) {
    return res.status(200).json({
      student: null,
      tests: [],
      accuracyGraph: [],
      timePerQuestion: [],
    });
  }

  const analytics = await fetchAnalyticsPayload(req, {
    ...filters,
    departmentId: scope.departmentId,
    batchId: scope.batchId,
  });
  const studentLifecycleWhere = buildStudentLifecycleWhere(filters);

  const student = await db.student.findFirst({
    where: {
      id: studentId,
      collegeId: req.collegeId,
      ...studentLifecycleWhere,
      ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
      ...(filters.year ? { year: filters.year } : {}),
      ...(scope.batchId
        ? {
            OR: [
              { batchId: scope.batchId },
              { batchIds: { in: [scope.batchId] } },
            ],
          }
        : {}),
    },
    include: {
      department: { select: { name: true } },
      batch: { select: { name: true } },
      submissions: {
        where: {
          status: { in: REPORTABLE_SUBMISSION_STATUSES },
          ...(scope.testIds.length ? { testId: { in: scope.testIds } } : {}),
          ...(filters.dateFrom || filters.dateTo
            ? {
                createdAt: {
                  ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
                  ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
                },
              }
            : {}),
        },
        include: {
          test: {
            select: {
              title: true,
              totalMarks: true,
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
            },
          },
          answers: {
            select: {
              questionId: true,
              selectedOption: true,
              selectedOptions: true,
              selectedBoolean: true,
              selectedText: true,
              answerBoolean: true,
              answerText: true,
            },
          },
          violations: {
            select: {
              id: true,
              type: true,
              createdAt: true,
              metadata: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { submittedAt: "desc" },
      },
    },
  });

  if (!student) {
    return res.status(404).json({ message: "Student not found" });
  }

  const tests = (student.submissions || []).map((submission) => {
    const questions = Array.isArray(submission.test?.questions) ? submission.test.questions : [];
    const answers = Array.isArray(submission.answers) ? submission.answers : [];
    const totalQuestions = questions.length || answers.length;
    const answeredQuestionIds = new Set(answers.map((answer) => String(answer.questionId || "")).filter(Boolean));
    const correct = questions.reduce((sum, question) => {
      const answer = answers.find((item) => String(item.questionId) === String(question.id));
      return sum + (isQuestionCorrect(question, answer) ? 1 : 0);
    }, 0);
    const incorrect = questions.length > 0
      ? questions.reduce((sum, question) => {
          const answered = answeredQuestionIds.has(String(question.id));
          return sum + (answered && !isQuestionCorrect(question, answers.find((item) => String(item.questionId) === String(question.id))) ? 1 : 0);
        }, 0)
      : Math.max(0, answers.length - correct);
    const totalMarks = questions.length
      ? questions.reduce((sum, question) => sum + Number(question.marks || 0), 0)
      : Number(submission.test?.totalMarks || 0);
    const obtainedMarks = Number(submission.score || 0);
    const accuracy = getScorePercent(submission);

    return {
      id: submission.id,
      testId: submission.testId,
      testName: submission.test?.title || "Test",
      score: accuracy,
      scorePercent: accuracy,
      accuracy,
      obtainedMarks,
      totalMarks,
      timeTaken: Number(submission.timeSpentSeconds || 0),
      status: submission.status,
      date: (submission.submittedAt || submission.updatedAt || submission.createdAt || new Date()).toISOString(),
      violationsCount: Number(submission.violationCount || submission.violations?.length || 0),
      violationEvents: (submission.violations || []).map((violation) => ({
        id: violation.id,
        type: violation.type,
        anomalyId: violation.id,
        anomalyType: violation.type,
        testId: submission.testId,
        testName: submission.test?.title || "Test",
        createdAt: violation.createdAt,
        metadata: violation.metadata || null,
        submissionId: submission.id,
      })),
      questionAnalysis: {
        correct,
        incorrect,
        total: totalQuestions,
      },
      // MODULE_TEST per-module breakdown (empty for OPEN_TEST).
      assessmentFormat: submission.test?.assessmentFormat || "OPEN_TEST",
      modules: Array.isArray(submission.moduleState)
        ? submission.moduleState.map((ms) => ({
            key: ms.key,
            name: ms.name,
            order: ms.order,
            score: Number(ms.score || 0),
            maxScore: Number(ms.maxScore || 0),
            percentage: Number(ms.percentage || 0),
            configuredDurationMins: ms.configuredDurationMins ?? null,
            timeTakenSeconds: Number(ms.timeTakenSeconds || 0),
            status: ms.status || null,
          }))
        : [],
    };
  });

  const accuracyGraph = tests.map((item) => ({
    date: new Date(item.date).toLocaleDateString(),
    accuracy: Number(item.accuracy || 0),
  }));

  const timePerQuestion = [];
  const baseAttempt = student.submissions?.[0];
  if (baseAttempt && Array.isArray(baseAttempt.answers) && baseAttempt.answers.length > 0) {
    const perQuestion = Number(baseAttempt.timeSpentSeconds || 0) / baseAttempt.answers.length;
    baseAttempt.answers.slice(0, 12).forEach((answer, index) => {
      timePerQuestion.push({
        question: `Q${index + 1}`,
        seconds: Number(perQuestion.toFixed(1)),
      });
    });
  }

  const selected = analytics?.selectedStudent || null;

  res.status(200).json({
    student: {
      id: student.id,
      name: student.fullName,
      studentId: getStudentNumber(student),
      year: student.year || null,
      department: student.department?.name || "-",
      batch: student.batch?.name || "-",
      rank: selected?.rank || null,
    },
    tests,
    accuracyGraph,
    timePerQuestion,
  });
});

const ENTITY_SCOPED_CHECKS = {
  STUDENT_WISE: { key: "studentId", model: "student", message: "Student not found for this college" },
  TEST_WISE: { key: "testId", model: "test", message: "Test not found for this college" },
  DEPARTMENT_WISE: { key: "departmentId", model: "department", message: "Department not found for this college" },
  BATCH_WISE: { key: "batchId", model: "batch", message: "Batch not found for this college" },
};

// Every test a report was asked to cover (testIds and/or the legacy testId).
const collectSelectedTestIds = (filters = {}) => [
  ...new Set(
    [...(Array.isArray(filters.testIds) ? filters.testIds : []), filters.testId]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ),
];

const normalizeFilters = (filters = {}) => {
  // One selected test stays a plain single-test report (testId); several become
  // a multi-test report (testIds).
  const selectedTestIds = collectSelectedTestIds(filters);
  const normalized = {
    studentId: filters.studentId || undefined,
    testId: selectedTestIds.length === 1 ? selectedTestIds[0] : undefined,
    testIds: selectedTestIds.length > 1 ? selectedTestIds : undefined,
    departmentId: filters.departmentId || undefined,
    batchId: filters.batchId || undefined,
    year: normalizeStudentYear(filters.year) || undefined,
    studentScope: normalizeStudentScope(filters.studentScope),
    passoutYear: normalizePassoutYear(filters.passoutYear) || undefined,
    passoutCohortId: normalizeOptionalId(filters.passoutCohortId) || undefined,
    semester: filters.semester || undefined,
    academicYear: filters.academicYear || undefined,
    remarks: filters.remarks || undefined,
    logoUrl: filters.logoUrl || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  };

  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value != null));
};

const resolveReportDownloadBasePath = (req, jobFilters = {}) => {
  const fromJob = typeof jobFilters.reportBasePath === "string" ? jobFilters.reportBasePath : "";
  if (fromJob.startsWith("/api/college-admin/reports") || fromJob.startsWith("/api/admin/reports")) {
    return fromJob;
  }

  if (String(req.baseUrl || "").startsWith("/api/college-admin/reports")) {
    return "/api/college-admin/reports";
  }

  return "/api/admin/reports";
};

const validateScopedFilters = async ({ db, type, filters, collegeId }) => {
  const rule = ENTITY_SCOPED_CHECKS[type];
  if (rule && filters?.[rule.key]) {
    const exists = await db[rule.model].findFirst({
      where: {
        id: filters[rule.key],
        collegeId,
      },
      select: { id: true },
    });

    if (!exists) {
      return { ok: false, status: 404, message: rule.message };
    }
  }

  if (Array.isArray(filters?.testIds) && filters.testIds.length > 0) {
    const found = await db.test.findMany({
      where: { id: { in: filters.testIds }, collegeId },
      select: { id: true },
    });
    if (found.length !== filters.testIds.length) {
      return { ok: false, status: 404, message: "One or more selected tests were not found for this college" };
    }
  }

  if (filters?.dateFrom && filters?.dateTo) {
    const from = new Date(filters.dateFrom);
    const to = new Date(filters.dateTo);
    if (from > to) {
      return { ok: false, status: 422, message: "dateFrom cannot be later than dateTo" };
    }
  }

  return { ok: true };
};

const generateReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const filters = normalizeFilters(req.body.filters || {});
  const reportBasePath = resolveReportDownloadBasePath(req, filters);
  const adminDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });

  if (adminDepartmentId) {
    if (filters.departmentId && String(filters.departmentId) !== String(adminDepartmentId)) {
      return res.status(403).json({ message: "Cross-department report access denied" });
    }

    filters.departmentId = adminDepartmentId;

    if (filters.batchId) {
      const batch = await db.batch.findFirst({
        where: { id: filters.batchId, collegeId: req.collegeId, departmentId: adminDepartmentId },
        select: { id: true },
      });

      if (!batch) {
        return res.status(403).json({ message: "Batch is outside the admin department scope" });
      }
    }

    if (filters.studentId) {
      const student = await db.student.findFirst({
        where: { id: filters.studentId, collegeId: req.collegeId, departmentId: adminDepartmentId },
        select: { id: true },
      });

      if (!student) {
        return res.status(403).json({ message: "Student is outside the admin department scope" });
      }
    }

    if (filters.testId) {
      const scope = await buildAdminReportScope({
        db,
        req,
        filters: { testId: filters.testId, departmentId: adminDepartmentId, batchId: filters.batchId },
        testSelect: { id: true },
      });

      if (!scope.ok || scope.testIds.length === 0) {
        return res.status(403).json({ message: "Test is not accessible for this department" });
      }
    }

    if (Array.isArray(filters.testIds) && filters.testIds.length > 0) {
      const scope = await buildAdminReportScope({
        db,
        req,
        filters: { departmentId: adminDepartmentId, batchId: filters.batchId },
        testSelect: { id: true },
      });
      const visible = new Set(scope.ok ? scope.testIds.map(String) : []);
      if (!filters.testIds.every((id) => visible.has(String(id)))) {
        return res.status(403).json({ message: "One or more selected tests are not accessible for this department" });
      }
    }
  }

  const validation = await validateScopedFilters({
    db,
    type: req.body.type,
    filters,
    collegeId: req.collegeId,
  });

  if (!validation.ok) {
    return res.status(validation.status).json({ message: validation.message });
  }

  const job = await db.reportJob.create({
    data: {
      type: req.body.type,
      filters: {
        ...filters,
        reportBasePath,
      },
      collegeId: req.collegeId,
      adminId: req.admin.id,
    },
  });

  await enqueueReportJob(job.id);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    message: "Report generation queued",
  });
});

const getReportJobs = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const jobs = await db.reportJob.findMany({
    where: {
      collegeId: req.collegeId,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const adminDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const visibleJobs = adminDepartmentId
    ? jobs.filter((job) => String(getReportJobDepartmentId(job)) === String(adminDepartmentId))
    : jobs;

  const safeJobs = visibleJobs.map((job) => {
    const filters = { ...(job.filters || {}) };
    const downloadExpiresAt = filters.resultUrlExpiresAt || null;
    delete filters.generatedData;
    delete filters.generatedDataRef;

    return {
      ...job,
      filters,
      downloadUrl: job.resultUrl || null,
      downloadExpiresAt,
    };
  });

  res.status(200).json(safeJobs);
});

const downloadReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.reportJob.findFirst({
    where: {
      id: reportJobId,
      collegeId: req.collegeId,
    },
  });

  if (!job) {
    return res.status(404).json({ message: "Report job not found" });
  }

  assertReportJobDepartmentScope(req, job);

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

const rawReportData = job.filters?.generatedDataRef
    ? await readReportPayload(job.filters.generatedDataRef)
    : job.filters?.generatedData || { rows: [] };

  // Normalize the payload shape for the formatter. The admin report payload
  // builder (admin-department-report.service.js) returns an object with rows for
  // some types, but other report paths may supply a raw array. generateAdminReportHTML
  // reads reportData.rows, so wrap a raw array in { rows: [...] } to ensure the
  // PDF renders the real data instead of an empty result.
  const reportData = Array.isArray(rawReportData)
    ? { rows: rawReportData }
    : rawReportData;

  const htmlContent = generateAdminReportHTML(
    {
      ...job,
      generatedAt: job.updatedAt,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    },
    reportData
  );

  // The report HTML renders its own branded per-page footer, so we keep the
  // Puppeteer margins tight and do not add a second header/footer band.
  const pdfBuffer = await renderHtmlToPdfBuffer(htmlContent, {
    margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="report-${reportJobId}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).send(pdfBuffer);
});

const getPassoutCohorts = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;

  const cohorts = await db.studentPassoutCohort.findMany({
    where: {
      collegeId: req.collegeId,
      status: "COMPLETED",
    },
    orderBy: [{ passoutYear: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  res.status(200).json({ data: cohorts });
});

const regenerateReportLink = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.reportJob.findFirst({
    where: {
      id: reportJobId,
      collegeId: req.collegeId,
    },
  });

  if (!job) {
    return res.status(404).json({ message: "Report job not found" });
  }

  assertReportJobDepartmentScope(req, job);

  if (job.status !== "COMPLETED") {
    return res.status(409).json({ message: "Report is not ready" });
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const reportBasePath = resolveReportDownloadBasePath(req, job.filters || {});
  const resultUrl = `${reportBasePath}/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

  const updated = await db.reportJob.update({
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

const reviewAnomaly = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId, anomalyId, anomalyType, action, reason } = req.body;

  const test = await db.test.findFirst({
    where: {
      id: testId,
      collegeId: req.collegeId,
    },
  });

  if (!test) {
    return res.status(404).json({ message: "Test not found for this college" });
  }

  const existingReviews = Array.isArray(test.anomalyReviews) ? test.anomalyReviews : [];
  const beforeReview = existingReviews.find((item) => item?.anomalyId === anomalyId) || null;

  const nextReview = {
    anomalyId,
    anomalyType,
    action,
    reason,
    reviewedAt: new Date().toISOString(),
    reviewedByAdminId: req.admin.id,
  };

  const nextReviews = [
    ...existingReviews.filter((item) => item?.anomalyId !== anomalyId),
    nextReview,
  ];

  await db.test.update({
    where: { id: test.id },
    data: {
      anomalyReviews: nextReviews,
    },
  });

  await createAuditLog({
    action: action === "ESCALATE" ? "REPORT_ANOMALY_ESCALATED" : "REPORT_ANOMALY_DISMISSED",
    targetType: "TEST_ANOMALY",
    targetId: `${test.id}:${anomalyId}`,
    collegeId: req.collegeId,
    adminId: req.admin.id,
    testId: test.id,
    beforeState: beforeReview,
    afterState: nextReview,
  });

  if (action === "ESCALATE") {
    emitToRole("SUPER_ADMIN", "report:anomaly_escalated", {
      collegeId: req.collegeId,
      adminId: req.admin.id,
      adminName: req.admin.fullName,
      testId: test.id,
      anomalyId,
      anomalyType,
      reason,
      escalatedAt: nextReview.reviewedAt,
    });
  }

  res.status(200).json({
    message: "Anomaly review saved",
    review: nextReview,
  });
});

module.exports = {
  generateReport,
  getReportJobs,
  getPassoutCohorts,
  getReportJobStatus,
  getReportAnalytics,
  getReportSummaryDashboard,
  getReportChartsDashboard,
  getReportTableDashboard,
  getReportTestsDashboard,
  getReportItemAnalysis,
  getReportIntegrity,
  getReportTrends,
  getReportAtRisk,
  exportReportCsv,
  exportReportXlsx,
  getReportStudentDetailDashboard,
  downloadReport,
  regenerateReportLink,
  reviewAnomaly,
};
