const mongoose = require("mongoose");
const { scorePercentExpression, toObjectIdIfValid, normalizeMongoId } = require("../utils/analytics-aggregation");
const { clampPercent } = require("../utils/score");
const { describeDistribution, PASS_THRESHOLD_PERCENT } = require("../utils/stats");
const { REPORTABLE_SUBMISSION_STATUSES } = require("./report-scope.service");

const toIdArray = (ids) => (Array.isArray(ids) ? ids : []).map((id) => toObjectIdIfValid(id));
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

const scoreBand = (score) => {
  if (score <= 20) return "0-20";
  if (score <= 40) return "21-40";
  if (score <= 60) return "41-60";
  if (score <= 80) return "61-80";
  return "81-100";
};

/**
 * Database-side aggregation for the scoped report analytics. Replaces loading
 * up to 20k submissions into Node: Mongo computes overall metrics, monthly
 * trend, subject and department comparatives, and per-student rollups in a
 * single `$facet`. Uses the production `scorePercentExpression`.
 */
async function aggregateReportSubmissions({ collegeId, testIds, studentIds, dateFrom, dateTo }) {
  const db = mongoose.connection.db;

  const match = { status: { $in: REPORTABLE_SUBMISSION_STATUSES } };
  if (collegeId) match.collegeId = toObjectIdIfValid(collegeId);
  // IMPORTANT: Only add $in filter when the array is non-empty.
  // MongoDB's { $in: [] } matches ZERO documents — passing an empty array
  // would wipe out all results even when submissions exist.
  if (Array.isArray(testIds) && testIds.length > 0) match.testId = { $in: toIdArray(testIds) };
  if (Array.isArray(studentIds) && studentIds.length > 0) match.userId = { $in: toIdArray(studentIds) };
  const submittedAt = {};
  if (dateFrom) submittedAt.$gte = dateFrom;
  if (dateTo) submittedAt.$lte = dateTo;
  if (Object.keys(submittedAt).length) match.submittedAt = submittedAt;

  const pipeline = [
    { $match: match },
    { $project: { userId: 1, testId: 1, score: 1, accuracy: 1, moduleState: 1, submittedAt: 1, updatedAt: 1, createdAt: 1 } },
    // Same score expression as withSubmissionScorePercent(). Each joined
    // document is reduced to the one field used below straight after its
    // lookup, so whole test / violation / student documents are not carried
    // through the rest of the pipeline. (Plain localField/foreignField joins:
    // sub-pipeline $lookups measured ~50% slower here.)
    { $lookup: { from: "test", localField: "testId", foreignField: "_id", as: "testDocs" } },
    { $addFields: { test: { totalMarks: { $first: "$testDocs.totalMarks" }, subject: { $first: "$testDocs.subject" } } } },
    { $project: { testDocs: 0 } },
    { $addFields: { scorePercent: scorePercentExpression } },
    { $lookup: { from: "violation", localField: "_id", foreignField: "submissionId", as: "violationDocs" } },
    { $addFields: { violationCount: { $size: "$violationDocs" } } },
    { $project: { violationDocs: 0 } },
    { $lookup: { from: "student", localField: "userId", foreignField: "_id", as: "studentDocs" } },
    { $addFields: { studentDoc: { departmentId: { $first: "$studentDocs.departmentId" } } } },
    { $project: { studentDocs: 0 } },
    {
      $addFields: {
        eventDate: { $ifNull: ["$submittedAt", { $ifNull: ["$updatedAt", "$createdAt"] }] },
        isPass: { $cond: [{ $gte: ["$scorePercent", PASS_THRESHOLD_PERCENT] }, 1, 0] },
      },
    },
    {
      $facet: {
        overall: [
          {
            $group: {
              _id: null,
              totalSubmissions: { $sum: 1 },
              avgScore: { $avg: "$scorePercent" },
              passing: { $sum: "$isPass" },
              violations: { $sum: "$violationCount" },
              attemptedUsers: { $addToSet: "$userId" },
            },
          },
          { $project: { _id: 0, totalSubmissions: 1, avgScore: 1, passing: 1, violations: 1, attemptedCount: { $size: "$attemptedUsers" } } },
        ],
        byMonth: [
          { $match: { eventDate: { $type: "date" } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$eventDate" } }, score: { $avg: "$scorePercent" } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, month: "$_id", score: 1 } },
        ],
        bySubject: [
          { $group: { _id: { $ifNull: ["$test.subject", "General"] }, score: { $avg: "$scorePercent" } } },
          { $project: { _id: 0, subject: "$_id", score: 1 } },
        ],
        byDepartment: [
          {
            $group: {
              _id: "$studentDoc.departmentId",
              submissions: { $sum: 1 },
              avgScore: { $avg: "$scorePercent" },
              passing: { $sum: "$isPass" },
              violations: { $sum: "$violationCount" },
              attemptedUsers: { $addToSet: "$userId" },
            },
          },
          { $project: { _id: 1, submissions: 1, avgScore: 1, passing: 1, violations: 1, attemptedCount: { $size: "$attemptedUsers" } } },
        ],
        byStudent: [
          {
            $group: {
              _id: "$userId",
              attempts: { $sum: 1 },
              avgScore: { $avg: "$scorePercent" },
              violations: { $sum: "$violationCount" },
            },
          },
        ],
        byModule: [
          { $match: { "moduleState.0": { $exists: true } } },
          { $unwind: "$moduleState" },
          {
            $group: {
              _id: { key: "$moduleState.key", name: "$moduleState.name", order: "$moduleState.order" },
              attempts: { $sum: 1 },
              averageScore: { $avg: "$moduleState.score" },
              averageMaxScore: { $avg: "$moduleState.maxScore" },
              averagePercentage: { $avg: "$moduleState.percentage" },
              averageTimeSeconds: { $avg: "$moduleState.timeTakenSeconds" },
              completed: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        { $toUpper: { $ifNull: ["$moduleState.status", ""] } },
                        ["MANUAL_SUBMIT", "AUTO_SUBMIT", "EXPIRED", "COMPLETED"],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { "_id.order": 1 } },
          {
            $project: {
              _id: 0,
              key: "$_id.key",
              name: "$_id.name",
              order: "$_id.order",
              attempts: 1,
              averageScore: 1,
              averageMaxScore: 1,
              averagePercentage: 1,
              averageTimeSeconds: 1,
              completionRate: { $multiply: [{ $divide: ["$completed", "$attempts"] }, 100] },
            },
          },
        ],
      },
    },
  ];

  const [facet] = await db.collection("submission").aggregate(pipeline, { allowDiskUse: true }).toArray();
  return facet || { overall: [], byMonth: [], bySubject: [], byDepartment: [], byStudent: [], byModule: [] };
}

/**
 * Pure mapper: turns the `$facet` output plus the (bounded) Prisma student /
 * test / department metadata into the exact response shape the report page
 * expects, adding `distributionStats` (median/quartiles/std-dev). Kept pure so
 * it can be unit-tested without a database.
 */
function buildAggregateReportResponse({ facet = {}, students = [], tests = [], departments = [], filters = {} }) {
  const toPercent = (value) => clampPercent(value);
  const overall = (facet.overall && facet.overall[0]) || {
    totalSubmissions: 0,
    avgScore: 0,
    passing: 0,
    violations: 0,
    attemptedCount: 0,
  };
  const byStudent = new Map((facet.byStudent || []).map((row) => [normalizeMongoId(row._id), row]));
  const byDepartment = new Map((facet.byDepartment || []).map((row) => [normalizeMongoId(row._id), row]));
  const totalTests = tests.length;

  const studentRows = students.map((student) => {
    const agg = byStudent.get(normalizeMongoId(student.id)) || { attempts: 0, avgScore: 0, violations: 0 };
    const attempts = Number(agg.attempts || 0);
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
      avgScore: attempts > 0 ? toPercent(agg.avgScore) : null,
      testsTaken: attempts,
      violations: Number(agg.violations || 0),
      participation: totalTests > 0 ? toPercent((attempts / totalTests) * 100) : null,
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
      if (a.rank == null && b.rank == null) return String(a.name || "").localeCompare(String(b.name || ""));
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    });

  const totalSubmissions = Number(overall.totalSubmissions || 0);
  const attemptedStudents = Number(overall.attemptedCount || 0);
  const avgScore = totalSubmissions > 0 ? toPercent(overall.avgScore) : null;
  const passRate = totalSubmissions ? toPercent((Number(overall.passing || 0) / totalSubmissions) * 100) : null;
  const participationRate = students.length ? toPercent((attemptedStudents / students.length) * 100) : null;
  const totalViolations = Number(overall.violations || 0);

  const scoreTrend = (facet.byMonth || []).map((row) => ({ month: row.month, score: toPercent(row.score) }));
  const subjectPerformance = (facet.bySubject || [])
    .map((row) => ({ subject: row.subject || "General", score: toPercent(row.score) }))
    .sort((a, b) => b.score - a.score);

  const distributionBase = { "0-20": 0, "21-40": 0, "41-60": 0, "61-80": 0, "81-100": 0 };
  rankedStudents.forEach((row) => {
    distributionBase[scoreBand(row.avgScore)] += 1;
  });
  const distributionStats = rankedStudents.length
    ? describeDistribution(rankedStudents.map((row) => row.avgScore))
    : null;

  const studentCountByDepartment = new Map();
  students.forEach((student) => {
    const key = normalizeMongoId(student.departmentId) || "unknown";
    studentCountByDepartment.set(key, (studentCountByDepartment.get(key) || 0) + 1);
  });

  const departmentRows = departments.map((department) => {
    const deptStudents = studentCountByDepartment.get(normalizeMongoId(department.id)) || 0;
    const agg = byDepartment.get(normalizeMongoId(department.id)) || {
      submissions: 0,
      avgScore: 0,
      passing: 0,
      violations: 0,
      attemptedCount: 0,
    };
    const submissions = Number(agg.submissions || 0);
    return {
      departmentId: department.id,
      department: department.name,
      collegeId: department.collegeId,
      college: department.college?.name || "-",
      students: deptStudents,
      submissions,
      avgScore: submissions > 0 ? toPercent(agg.avgScore || 0) : null,
      passRate: submissions ? toPercent((Number(agg.passing || 0) / submissions) * 100) : null,
      participation: deptStudents ? toPercent((Number(agg.attemptedCount || 0) / deptStudents) * 100) : null,
      violations: Number(agg.violations || 0),
    };
  });

  const modulePerformance = {
    modules: (facet.byModule || [])
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((row) => ({ key: row.key, name: row.name || row.key, order: row.order || 0 })),
    moduleStats: (facet.byModule || []).map((row) => ({
      key: row.key,
      name: row.name || row.key,
      order: row.order || 0,
      attempts: Number(row.attempts || 0),
      averageScore: Number((row.averageScore || 0).toFixed(2)),
      averageMaxScore: Number((row.averageMaxScore || 0).toFixed(2)),
      averagePercentage: Number((row.averagePercentage || 0).toFixed(2)),
      averageTimeSeconds: Number((row.averageTimeSeconds || 0).toFixed(0)),
      completionRate: Number((row.completionRate || 0).toFixed(2)),
    })),
    studentRows: [],
    attempts: (facet.byModule || []).reduce((sum, row) => sum + Number(row.attempts || 0), 0),
  };

  return {
    filters,
    metrics: {
      totalStudents: students.length,
      attemptedStudents,
      totalTests,
      totalSubmissions,
      avgScore,
      passRate,
      participationRate,
      violations: totalViolations,
    },
    scoreTrend,
    subjectPerformance,
    distribution: Object.entries(distributionBase).map(([range, count]) => ({ range, count })),
    distributionStats,
    departmentRows,
    tableRows,
    selectedStudent: null,
    attemptHistory: [],
    modulePerformance,
  };
}

/**
 * MODULE_TEST analytics. Pure function over reportable submissions that carry
 * `moduleState`. Produces module-wise average/max score, average percentage,
 * completion rate and average time taken, plus a per-student rollup for admin
 * tables (Quant/Reasoning/Verbal/Overall). OPEN_TEST submissions (no
 * moduleState) are ignored.
 */
function aggregateModulePerformance(submissions = [], { modules = [] } = {}) {
  const moduleDefs = Array.isArray(modules) && modules.length
    ? modules.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    : [];

  const withModules = (Array.isArray(submissions) ? submissions : []).filter(
    (submission) => Array.isArray(submission?.moduleState) && submission.moduleState.length > 0
  );

  // Derive the module set from the data when not supplied.
  const keys = moduleDefs.length
    ? moduleDefs.map((m) => ({ key: m.key, name: m.name, order: m.order }))
    : (() => {
        const seen = new Map();
        for (const submission of withModules) {
          for (const ms of submission.moduleState) {
            if (!seen.has(ms.key)) seen.set(ms.key, { key: ms.key, name: ms.name, order: ms.order });
          }
        }
        return [...seen.values()].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      })();

  const acc = new Map(keys.map((k) => [k.key, { ...k, scoreSum: 0, maxSum: 0, pctSum: 0, timeSum: 0, completed: 0, count: 0 }]));

  for (const submission of withModules) {
    for (const ms of submission.moduleState) {
      const bucket = acc.get(ms.key);
      if (!bucket) continue;
      bucket.count += 1;
      bucket.scoreSum += Number(ms.score || 0);
      bucket.maxSum += Number(ms.maxScore || 0);
      bucket.pctSum += Number(ms.percentage || 0);
      bucket.timeSum += Number(ms.timeTakenSeconds || 0);
      if (["MANUAL_SUBMIT", "AUTO_SUBMIT", "EXPIRED", "COMPLETED"].includes(String(ms.status || "").toUpperCase())) {
        bucket.completed += 1;
      }
    }
  }

  const moduleStats = [...acc.values()].map((bucket) => ({
    key: bucket.key,
    name: bucket.name,
    order: bucket.order,
    attempts: bucket.count,
    averageScore: bucket.count ? Number((bucket.scoreSum / bucket.count).toFixed(2)) : null,
    averageMaxScore: bucket.count ? Number((bucket.maxSum / bucket.count).toFixed(2)) : null,
    averagePercentage: bucket.count ? Number((bucket.pctSum / bucket.count).toFixed(2)) : null,
    averageTimeSeconds: bucket.count ? Math.round(bucket.timeSum / bucket.count) : null,
    completionRate: bucket.count ? Number(((bucket.completed / bucket.count) * 100).toFixed(2)) : null,
  }));

  const studentRows = withModules.map((submission) => {
    const byKey = new Map((submission.moduleState || []).map((ms) => [ms.key, ms]));
    const modules = keys.map((k) => {
      const ms = byKey.get(k.key) || {};
      return {
        key: k.key,
        name: k.name,
        score: Number(ms.score || 0),
        maxScore: Number(ms.maxScore || 0),
        percentage: Number(ms.percentage || 0),
        timeTakenSeconds: Number(ms.timeTakenSeconds || 0),
      };
    });

    // The module states are the authoritative denominator. `overallMaxScore` is
    // persisted at submit time, but older/backfilled submissions may predate it,
    // and a missing value must never render as "36/0".
    const moduleMaxScore = modules.reduce((sum, mod) => sum + mod.maxScore, 0);
    const moduleScore = modules.reduce((sum, mod) => sum + mod.score, 0);
    const storedMaxScore = Number(submission.overallMaxScore || 0);
    const overallMaxScore = storedMaxScore > 0 ? storedMaxScore : moduleMaxScore;
    const storedPercentage = Number(submission.overallPercentage);
    const overallPercentage = Number.isFinite(storedPercentage) && submission.overallPercentage != null
      ? storedPercentage
      : overallMaxScore > 0
        ? Number(((moduleScore / overallMaxScore) * 100).toFixed(2))
        : Number(submission.accuracy || 0);

    return {
      submissionId: submission.id,
      userId: submission.userId,
      overallScore: Number(submission.score ?? moduleScore),
      overallMaxScore,
      overallPercentage,
      totalActualTimeSeconds: Number(submission.totalActualTimeSeconds || submission.timeSpentSeconds || 0),
      modules,
    };
  });

  return { modules: keys, moduleStats, studentRows, attempts: withModules.length };
}

// Per-submission module columns for the reports deep-dive results table.
// Mirrors the per-module shape used by the student-wise PDF/CSV export so the
// on-screen student table renders the same breakdown as the downloadable ones.
function buildSubmissionModuleColumns(submission = {}, test = {}) {
  const state = Array.isArray(submission?.moduleState) ? submission.moduleState : [];
  if (state.length === 0) {
    return { isModuleTest: false, moduleScores: [] };
  }

  const moduleDefs = Array.isArray(test?.modules) && test.modules.length
    ? test.modules.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    : state.map((ms) => ({ key: ms.key, name: ms.name, order: ms.order, durationMins: ms.configuredDurationMins }));

  return {
    isModuleTest: true,
    moduleScores: moduleDefs.map((mod) => {
      const ms = state.find((item) => item.key === mod.key) || {};
      return {
        key: mod.key,
        name: ms.name || mod.name || mod.key,
        order: Number(mod.order || 0),
        score: Number(ms.score || 0),
        maxScore: Number(ms.maxScore || 0),
        percentage: Number(ms.percentage || 0),
        configuredDurationMins: ms.configuredDurationMins ?? mod.durationMins ?? null,
        timeTakenSeconds: Number(ms.timeTakenSeconds || 0),
        status: ms.status || null,
      };
    }),
  };
}

module.exports = {
  aggregateReportSubmissions,
  buildAggregateReportResponse,
  aggregateModulePerformance,
  buildSubmissionModuleColumns,
};
