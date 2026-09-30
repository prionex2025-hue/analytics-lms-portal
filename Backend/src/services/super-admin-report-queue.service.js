const models = require("../models");
const { logger } = require("../utils/logger");
const env = require("../config/env");
const { redisClient, getRedisQueueConnection } = require("../config/redis");
const { emitToRole } = require("../realtime/socket");

const workerEnabled = env.worker.enabled;
const { saveReportPayload } = require("./report-payload-store.service");
const { getSubmissionScorePercent } = require("../utils/score");
const { REPORTABLE_SUBMISSION_STATUSES, buildStudentLifecycleWhere } = require("./report-scope.service");
const {
  aggregateInstitutionReport,
  buildInstitutionReportPayload,
  buildQuestionAnalytics,
  isStudentAssignedToTest,
  buildReportId,
  REPORT_SUBMISSION_INCLUDE,
  REPORT_INCOMPLETE_INCLUDE,
} = require("./admin-department-report.service");
const { aggregateModulePerformance } = require("./report-analytics-aggregation.service");

let Queue = null;
let Worker = null;
try {
  ({ Queue, Worker } = require("bullmq"));
} catch (_error) {
  Queue = null;
  Worker = null;
}

let superReportQueue = null;
let superReportWorker = null;
const queueConnection = getRedisQueueConnection();
const DEFAULT_RECOVERY_LIMIT = 25;
const STALE_PROCESSING_MS = 15 * 60 * 1000;

const getDbClient = async () => {
  const m = await models.init();
  return m.dbClient;
};

const getScorePercent = getSubmissionScorePercent;
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";
const SUBMITTED_STATUSES = REPORTABLE_SUBMISSION_STATUSES;

const normalizeStudentYear = (value) => {
  if (value == null || value === "") return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1 && year <= 4 ? year : null;
};

const getDepartmentBatchIds = async (db, filters = {}) => {
  if (!filters.departmentId) return [];
  const batches = await db.batch.findMany({
    where: {
      departmentId: filters.departmentId,
      ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
    },
    select: { id: true },
  });
  return batches.map((batch) => batch.id);
};

const buildSubmissionDateFilter = (filters = {}) => {
  const range = {};
  if (filters.dateFrom) {
    range.gte = new Date(filters.dateFrom);
  }
  if (filters.dateTo) {
    range.lte = new Date(filters.dateTo);
  }
  return Object.keys(range).length > 0 ? range : null;
};

const buildSubmittedSubmissionWhere = (filters = {}, extra = {}) => {
  const dateFilter = buildSubmissionDateFilter(filters);
  return {
    status: { in: SUBMITTED_STATUSES },
    ...(dateFilter ? { submittedAt: dateFilter } : {}),
    ...extra,
  };
};

const buildTestWhere = (filters = {}, departmentBatchIds = []) => ({
  ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
  ...(filters.testId ? { id: filters.testId } : {}),
  ...(filters.departmentId
    ? {
        OR: [
          { departmentId: filters.departmentId },
          { assignedTo: { in: [filters.departmentId] } },
          ...(departmentBatchIds.length > 0
            ? [
                { batchId: { in: departmentBatchIds } },
                { batchAssignments: { some: { batchId: { in: departmentBatchIds } } } },
              ]
            : []),
        ],
      }
    : {}),
});

const buildDepartmentAcademicPayload = async (db, filters = {}, job = {}) => {
  const studentLifecycleWhere = buildStudentLifecycleWhere(filters);
  const scopedYear = normalizeStudentYear(filters.year);

  // The test identifies its own college, so a super-admin can select just a test
  // (no college/department) and still get the full single-test report. Fetch the
  // test first, then derive the college scope from it when not pinned.
  const test = await db.test.findFirst({
    where: {
      id: filters.testId,
      ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
    },
    select: {
      id: true, title: true, subject: true, totalMarks: true, durationMins: true, startsAt: true, endsAt: true, collegeId: true,
      assessmentFormat: true, modules: true,
      assignmentMethod: true, assignedTo: true, departmentId: true, batchId: true, years: true,
      batchAssignments: { select: { batchId: true } },
    },
  });

  const collegeId = filters.collegeId || test?.collegeId || null;
  const departmentId = filters.departmentId || null;
  const submissionUserWhere = {
    ...studentLifecycleWhere,
    ...(departmentId ? { departmentId } : {}),
    ...(scopedYear ? { year: scopedYear } : {}),
  };

  const [college, departments, students, submissions, incompleteSubmissions] = await Promise.all([
    collegeId ? db.college.findUnique({ where: { id: collegeId }, select: { id: true, name: true } }) : null,
    // One department when scoped, otherwise every department in the college so the
    // department comparison charts have real names.
    db.department.findMany({
      where: { ...(collegeId ? { collegeId } : {}), ...(departmentId ? { id: departmentId } : {}) },
      select: { id: true, name: true },
    }),
    db.student.findMany({
      where: {
        ...(collegeId ? { collegeId } : {}),
        ...studentLifecycleWhere,
        ...(departmentId ? { departmentId } : {}),
        ...(scopedYear ? { year: scopedYear } : {}),
      },
      include: {
        batch: { select: { name: true, year: true, academicYear: true } },
      },
    }),
    db.submission.findMany({
      where: buildSubmittedSubmissionWhere(filters, {
        ...(collegeId ? { collegeId } : {}),
        ...(filters.testId ? { testId: filters.testId } : {}),
        ...(Object.keys(submissionUserWhere).length ? { user: submissionUserWhere } : {}),
      }),
      include: REPORT_SUBMISSION_INCLUDE,
    }),
    db.submission.findMany({
      where: {
        ...(collegeId ? { collegeId } : {}),
        ...(filters.testId ? { testId: filters.testId } : {}),
        status: { in: ["IN_PROGRESS"] },
        ...(Object.keys(submissionUserWhere).length ? { user: submissionUserWhere } : {}),
      },
      include: REPORT_INCOMPLETE_INCLUDE,
    }),
  ]);

  const departmentNameById = new Map(departments.map((dept) => [String(dept.id), dept.name]));
  const questionAnalytics = test ? await buildQuestionAnalytics({ db, test, submissions }) : null;
  // A batch-assigned test registers only its batch(es), not the whole college scope.
  const scopedStudents = test ? students.filter((student) => isStudentAssignedToTest(student, test)) : students;

  const meta = {
    departmentName: departmentId ? departmentNameById.get(departmentId) || "-" : "All Departments",
    collegeName: college?.name || "-",
    testTitle: test?.title || "Selected Test",
    subject: test?.subject || "Placement Assessment",
    semester: filters.semester || "-",
    academicYear: filters.academicYear || "-",
    logoUrl: filters.logoUrl || "",
    hasSelectedTest: Boolean(filters.testId),
    reportId: buildReportId(job),
    generatedBy: "Analytics Edify LMS",
    durationMins: test?.durationMins || null,
    testDate: test?.startsAt || test?.endsAt || null,
    departmentsCount: departments.length,
    remarks: filters.remarks || "",
    assessmentFormat: test?.assessmentFormat ? String(test.assessmentFormat).toUpperCase() : undefined,
    isModuleTest: Boolean(test) && String(test.assessmentFormat || "").toUpperCase() === "MODULE_TEST" || undefined,
  };

  const report = aggregateInstitutionReport({ meta, students: scopedStudents, submissions, incompleteSubmissions, departmentNameById, questionAnalytics });

  // MODULE_TEST: mirror the module-aware branch of the College Admin pipeline so
  // a test-selected report (without a pinned college) also carries module data.
  if (test && String(test.assessmentFormat || "").toUpperCase() === "MODULE_TEST") {
    const modulePerformance = aggregateModulePerformance(submissions, { modules: test.modules });
    const submissionById = new Map(submissions.map((submission) => [String(submission.userId), submission]));
    modulePerformance.studentRows = modulePerformance.studentRows.map((row) => {
      const submission = submissionById.get(String(row.userId)) || {};
      const user = submission.user || {};
      return {
        ...row,
        name: user.fullName || user.email || user.enrollNumber || user.studentId || row.userId,
        rollNo: getStudentNumber(user),
        department: departmentNameById.get(String(user.departmentId)) || user.departmentId || "-",
        year: user.year != null ? String(user.year) : "-",
        status: submission.status || undefined,
      };
    });
    report.modulePerformance = modulePerformance;
  }

  return report;
};

if (Queue && redisClient && queueConnection) {
  // Producer: created on every replica so any instance can enqueue jobs.
  superReportQueue = new Queue("super-admin-report-jobs", {
    connection: queueConnection,
  });

  // Consumer: only worker-enabled replicas process jobs.
  if (workerEnabled) {
    superReportWorker = new Worker(
      "super-admin-report-jobs",
      async (job) => {
        await processSuperReportSynchronously(job.data.reportJobId);
      },
      {
        connection: queueConnection,
        concurrency: 8,
      }
    );

    superReportWorker.on("failed", (job, error) => {
      // Internal error text (driver/Puppeteer messages, paths) stays in the logs.
      logger.error("report.super_report_failed", { reportJobId: job?.data?.reportJobId, reason: error?.message });
      emitToRole("SUPER_ADMIN", "super-report:status", {
        reportJobId: job?.data?.reportJobId,
        status: "FAILED",
        errorMessage: "Report generation failed. Please retry.",
      });
    });
  }
}

// A college-scoped Super Admin report reuses the College Admin report pipeline
// verbatim (buildInstitutionReportPayload) so the two PDFs are identical for the
// same college / department / batch. Scope is resolved here from the job filters;
// the shared core does the rest.
const buildScopedInstitutionPayload = async (db, job) => {
  const filters = job.filters || {};
  const college = filters.collegeId
    ? await db.college.findUnique({ where: { id: filters.collegeId }, select: { name: true } })
    : null;
  return buildInstitutionReportPayload({
    db,
    job,
    collegeId: filters.collegeId,
    departmentId: filters.departmentId ? String(filters.departmentId) : null,
    batchId: filters.batchId ? String(filters.batchId) : null,
    collegeName: college?.name || "-",
    departmentFallbackName: "-",
  });
};

const buildGlobalReportPayload = async (db, job) => {
  const filters = job.filters || {};

  // Every report generated from the Super Admin Reports page is college-scoped
  // (the UI requires a college before exporting). Such reports reuse the College
  // Admin pipeline verbatim (buildInstitutionReportPayload) so the two PDFs are
  // identical for the same college / department / batch / test — INCLUDING when a
  // specific test is selected. This MUST be checked before the test-only branch
  // below: otherwise a test-selected report would fall into buildDepartmentAcademicPayload,
  // a divergent path that ignores batchId and re-implements the scoping, producing
  // different totals/rankings than College Admin for the same selection.
  if (filters.collegeId) {
    return buildScopedInstitutionPayload(db, job);
  }

  // Fallback for a test selected WITHOUT a college. This is not reachable from the
  // Reports page (which always pins a college, enforced in generateSuperReport),
  // but the test still identifies its own college, so derive the single-test
  // Institution report from it rather than emitting an empty list.
  if (filters.testId) {
    return buildDepartmentAcademicPayload(db, filters, job);
  }

  const scopedYear = normalizeStudentYear(filters.year);
  const studentLifecycleWhere = buildStudentLifecycleWhere(filters);
  const departmentBatchIds = await getDepartmentBatchIds(db, filters);
  const scopedTests = filters.departmentId
    ? await db.test.findMany({
        where: buildTestWhere(filters, departmentBatchIds),
        select: { id: true },
      })
    : [];
  const scopedTestIds = scopedTests.map((test) => test.id);
  const scopedTestFilter = {
    ...(filters.testId ? { testId: filters.testId } : {}),
    ...(filters.departmentId ? { testId: { in: scopedTestIds } } : {}),
  };

  if (job.type === "STUDENT_WISE") {
    const studentWiseUserWhere = {
      ...studentLifecycleWhere,
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(scopedYear ? { year: scopedYear } : {}),
    };
    const rows = await db.submission.findMany({
      where: buildSubmittedSubmissionWhere(filters, {
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
        ...scopedTestFilter,
        ...(filters.studentId ? { userId: filters.studentId } : {}),
        ...(Object.keys(studentWiseUserWhere).length ? { user: studentWiseUserWhere } : {}),
      }),
      include: {
        user: { select: { fullName: true, studentId: true, enrollNumber: true, enrollmentNumber: true, collegeId: true, department: { select: { name: true } } } },
        test: { select: { title: true, subject: true, totalMarks: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    return rows.map((row) => ({
      studentName: row.user.fullName,
      studentId: getStudentNumber(row.user),
      collegeId: row.user.collegeId,
      department: row.user.department?.name || "-",
      testName: row.test.title,
      subject: row.test.subject,
      score: getScorePercent(row),
      accuracy: getScorePercent(row),
      status: row.status,
      submittedAt: row.submittedAt,
    }));
  }

  if (job.type === "TEST_WISE") {
    const testWiseUserWhere = {
      ...studentLifecycleWhere,
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(scopedYear ? { year: scopedYear } : {}),
    };
    const tests = await db.test.findMany({
      where: buildTestWhere(filters, departmentBatchIds),
      include: {
        submissions: {
          where: buildSubmittedSubmissionWhere(filters, {
            ...(filters.studentId ? { userId: filters.studentId } : {}),
            ...(Object.keys(testWiseUserWhere).length ? { user: testWiseUserWhere } : {}),
          }),
        },
      },
      take: 500,
    });

    return tests.map((test) => {
      const participants = test.submissions.length;
      const avgScore = participants > 0 ? test.submissions.reduce((sum, item) => sum + getScorePercent({ ...item, test }), 0) / participants : 0;
      return {
        testId: test.id,
        testName: test.title,
        collegeId: test.collegeId,
        participants,
        avgScore: Number(avgScore.toFixed(2)),
      };
    });
  }

  if (job.type === "DEPARTMENT_WISE") {
    if (filters.testId && filters.departmentId && filters.collegeId) {
      return buildDepartmentAcademicPayload(db, filters, job);
    }

    const departments = await db.department.findMany({
      where: {
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
        ...(filters.departmentId ? { id: filters.departmentId } : {}),
      },
      include: {
        students: {
          where: {
            ...(filters.studentId ? { id: filters.studentId } : {}),
            ...studentLifecycleWhere,
            ...(scopedYear ? { year: scopedYear } : {}),
          },
          include: {
            submissions: {
              where: buildSubmittedSubmissionWhere(filters, scopedTestFilter),
              include: {
                test: { select: { totalMarks: true } },
              },
            },
          },
        },
      },
    });

    return departments.map((department) => {
      const submissions = department.students
        .flatMap((student) => student.submissions)
        .filter((submission) => !filters.testId || submission.testId === filters.testId)
        .filter((submission) => !filters.departmentId || scopedTestIds.includes(submission.testId));
      const avgScore = submissions.length > 0 ? submissions.reduce((sum, item) => sum + getScorePercent(item), 0) / submissions.length : 0;
      return {
        departmentId: department.id,
        departmentName: department.name,
        collegeId: department.collegeId,
        students: department.students.length,
        avgScore: Number(avgScore.toFixed(2)),
      };
    });
  }

  const batches = await db.batch.findMany({
    where: {
      ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    },
    include: {
      students: {
        where: {
          ...(filters.studentId ? { id: filters.studentId } : {}),
          ...studentLifecycleWhere,
          ...(scopedYear ? { year: scopedYear } : {}),
        },
        include: {
          submissions: {
            where: buildSubmittedSubmissionWhere(filters, scopedTestFilter),
            include: {
              test: { select: { totalMarks: true } },
            },
          },
        },
      },
    },
  });

  return batches.map((batch) => {
    const submissions = batch.students
      .flatMap((student) => student.submissions)
      .filter((submission) => !filters.testId || submission.testId === filters.testId)
      .filter((submission) => !filters.departmentId || scopedTestIds.includes(submission.testId));
    const avgScore = submissions.length > 0 ? submissions.reduce((sum, item) => sum + getScorePercent(item), 0) / submissions.length : 0;
    return {
      batchId: batch.id,
      batchName: batch.name,
      collegeId: batch.collegeId,
      students: batch.students.length,
      avgScore: Number(avgScore.toFixed(2)),
    };
  });
};

const processSuperReportSynchronously = async (reportJobId) => {
  const db = await getDbClient();
  await db.superReportJob.update({
    where: { id: reportJobId },
    data: { status: "PROCESSING" },
  });

  emitToRole("SUPER_ADMIN", "super-report:status", {
    reportJobId,
    status: "PROCESSING",
  });

  try {
    const reportJob = await db.superReportJob.findUnique({ where: { id: reportJobId } });
    const payload = await buildGlobalReportPayload(db, reportJob);
    const payloadRef = await saveReportPayload({ scope: "super-report", jobId: reportJobId, payload });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const resultUrl = `/api/super-admin/reports/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

    await db.superReportJob.update({
      where: { id: reportJobId },
      data: {
        status: "COMPLETED",
        resultUrl,
        resultDataRef: payloadRef,
        filters: {
          ...(reportJob.filters || {}),
          resultUrlExpiresAt: expiresAt,
        },
      },
    });

    emitToRole("SUPER_ADMIN", "super-report:status", {
      reportJobId,
      status: "COMPLETED",
    });
  } catch (error) {
    logger.error("report.super_report_failed", { reportJobId, reason: error?.message });
    await db.superReportJob.update({
      where: { id: reportJobId },
      data: {
        status: "FAILED",
        errorMessage: "Report generation failed. Please retry.",
      },
    });

    emitToRole("SUPER_ADMIN", "super-report:status", {
      reportJobId,
      status: "FAILED",
      errorMessage: "Report generation failed. Please retry.",
    });
  }
};

const enqueueSuperReportJob = async (reportJobId) => {
  if (!superReportQueue) {
    await processSuperReportSynchronously(reportJobId);
    return;
  }

  try {
    await superReportQueue.add("generate", { reportJobId }, { jobId: reportJobId, removeOnComplete: true, removeOnFail: false });
  } catch (_error) {
    await processSuperReportSynchronously(reportJobId);
  }
};

const recoverPendingSuperReportJobs = async ({ limit = DEFAULT_RECOVERY_LIMIT, staleAfterMs = STALE_PROCESSING_MS } = {}) => {
  const db = await getDbClient();
  const staleCutoff = new Date(Date.now() - staleAfterMs);
  const reset = await db.superReportJob.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: staleCutoff },
    },
    data: {
      status: "QUEUED",
      errorMessage: null,
    },
  });

  const queuedJobs = await db.superReportJob.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const job of queuedJobs) {
    await enqueueSuperReportJob(job.id);
  }

  return {
    resetProcessing: reset.count || 0,
    requeued: queuedJobs.length,
  };
};

const closeSuperReportQueue = async () => {
  await Promise.allSettled([superReportWorker?.close(), superReportQueue?.close()]);
};

module.exports = {
  buildGlobalReportPayload,
  closeSuperReportQueue,
  enqueueSuperReportJob,
  processSuperReportSynchronously,
  recoverPendingSuperReportJobs,
};
