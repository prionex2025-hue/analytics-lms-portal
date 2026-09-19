const mongoose = require("mongoose");
const { asyncHandler } = require("../../utils/http");
const { normalizeMongoId, withSubmissionScorePercent } = require("../../utils/analytics-aggregation");
const { REPORTABLE_SUBMISSION_STATUSES } = require("../../services/report-scope.service");
// Submissions that count toward analytics aggregations (submitted / graded).
const SUBMITTED_STATUSES = REPORTABLE_SUBMISSION_STATUSES;

const violationWeightStage = () => ({
  $addFields: {
    violationWeight: {
      $cond: [
        { $gt: [{ $convert: { input: "$count", to: "double", onError: 0, onNull: 0 } }, 0] },
        { $convert: { input: "$count", to: "double", onError: 0, onNull: 0 } },
        1,
      ],
    },
  },
});

/**
 * Super-admin analytics — database-side aggregations.
 * Produces per-college metrics without loading entire collections into memory.
 */
const getSuperAnalytics = asyncHandler(async (_req, res) => {
  const db = mongoose.connection.db;

  // Aggregate student counts per college
  const studentsAgg = db
    .collection("student")
    .aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$collegeId", studentCount: { $sum: 1 } } },
    ])
    .toArray();

  // Aggregate submissions with score percent (lookup test.totalMarks)
  const submissionsAgg = db
    .collection("submission")
    .aggregate([
      { $match: { status: { $in: REPORTABLE_SUBMISSION_STATUSES } } },
      ...withSubmissionScorePercent(),
      {
        $group: {
          _id: "$collegeId",
          totalSubmissions: { $sum: 1 },
          avgScorePercent: { $avg: "$scorePercent" },
          passingSubmissions: { $sum: { $cond: [{ $gte: ["$scorePercent", 40] }, 1, 0] } },
        },
      },
    ])
    .toArray();

  // New violation rows carry collegeId directly. Keep a lookup fallback for
  // older records written before the production-readiness migration.
  const violationsAgg = db
    .collection("violation")
    .aggregate([
      violationWeightStage(),
      {
        $facet: {
          direct: [
            { $match: { collegeId: { $exists: true, $ne: null } } },
            { $group: { _id: "$collegeId", totalViolations: { $sum: "$violationWeight" } } },
          ],
          legacy: [
            {
              $match: {
                $or: [
                  { collegeId: { $exists: false } },
                  { collegeId: null },
                ],
              },
            },
            {
              $lookup: {
                from: "submission",
                localField: "submissionId",
                foreignField: "_id",
                as: "submission",
              },
            },
            { $unwind: { path: "$submission", preserveNullAndEmptyArrays: false } },
            { $group: { _id: "$submission.collegeId", totalViolations: { $sum: "$violationWeight" } } },
          ],
        },
      },
      { $project: { rows: { $concatArrays: ["$direct", "$legacy"] } } },
      { $unwind: "$rows" },
      { $group: { _id: "$rows._id", totalViolations: { $sum: "$rows.totalViolations" } } },
    ])
    .toArray();

  const topStudentsAgg = db
    .collection("submission")
    .aggregate([
      { $match: { status: { $in: SUBMITTED_STATUSES } } },
      ...withSubmissionScorePercent(),
      {
        $group: {
          _id: "$userId",
          avgScore: { $avg: "$scorePercent" },
          attempts: { $sum: 1 },
          collegeId: { $first: "$collegeId" },
        },
      },
      { $sort: { avgScore: -1, attempts: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "student",
          localField: "_id",
          foreignField: "_id",
          as: "student",
        },
      },
      {
        $lookup: {
          from: "college",
          localField: "collegeId",
          foreignField: "_id",
          as: "college",
        },
      },
      {
        $project: {
          _id: 0,
          studentId: "$_id",
          studentName: { $ifNull: [{ $arrayElemAt: ["$student.fullName", 0] }, "-"] },
          collegeName: { $ifNull: [{ $arrayElemAt: ["$college.name", 0] }, "-"] },
          avgScore: { $round: ["$avgScore", 2] },
          attempts: 1,
        },
      },
    ])
    .toArray();

  const mostActiveTestsAgg = db
    .collection("submission")
    .aggregate([
      { $match: { status: { $in: SUBMITTED_STATUSES } } },
      {
        $group: {
          _id: "$testId",
          submissions: { $sum: 1 },
          collegeId: { $first: "$collegeId" },
        },
      },
      { $sort: { submissions: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "test",
          localField: "_id",
          foreignField: "_id",
          as: "test",
        },
      },
      {
        $project: {
          _id: 0,
          testId: "$_id",
          testName: { $ifNull: [{ $arrayElemAt: ["$test.title", 0] }, "-"] },
          collegeId: 1,
          submissions: 1,
        },
      },
    ])
    .toArray();

  const violationStatisticsAgg = db
    .collection("violation")
    .aggregate([
      violationWeightStage(),
      {
        $group: {
          _id: { $ifNull: ["$type", "UNKNOWN"] },
          count: { $sum: "$violationWeight" },
        },
      },
      { $sort: { count: -1 } },
      {
        $project: {
          _id: 0,
          type: "$_id",
          count: 1,
        },
      },
    ])
    .toArray();

  const platformTrendAgg = db
    .collection("submission")
    .aggregate([
      { $match: { status: { $in: SUBMITTED_STATUSES } } },
      ...withSubmissionScorePercent(),
      { $addFields: { eventDate: { $ifNull: ["$submittedAt", "$createdAt"] } } },
      { $match: { eventDate: { $type: "date" } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$eventDate" } },
          score: { $avg: "$scorePercent" },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 12 },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          month: "$_id",
          score: { $round: ["$score", 2] },
        },
      },
    ])
    .toArray();

  // Fetch active colleges for stable ordering
  const collegesPromise = db.collection("college").find({ isActive: true }, { projection: { id: 1, name: 1, code: 1 } }).toArray();

  const [
    studentsByCollege,
    submissionsByCollege,
    violationsByCollege,
    topStudents,
    mostActiveTests,
    violationStatistics,
    platformTrend,
    collegesRaw,
  ] = await Promise.all([
    studentsAgg,
    submissionsAgg,
    violationsAgg,
    topStudentsAgg,
    mostActiveTestsAgg,
    violationStatisticsAgg,
    platformTrendAgg,
    collegesPromise,
  ]);

  const studentsMap = new Map((studentsByCollege || []).map((r) => [normalizeMongoId(r._id), r.studentCount || 0]));
  const submissionsMap = new Map((submissionsByCollege || []).map((r) => [normalizeMongoId(r._id), r]));
  const violationsMap = new Map((violationsByCollege || []).map((r) => [normalizeMongoId(r._id), r.totalViolations || 0]));

  const result = (collegesRaw || []).map((c) => {
    const id = c.id || c._id || null;
    const key = normalizeMongoId(id);
    const subs = submissionsMap.get(key) || { totalSubmissions: 0, avgScorePercent: 0, passingSubmissions: 0 };
    return {
      collegeId: key || id,
      collegeName: c.name || "-",
      studentCount: studentsMap.get(key) || 0,
      totalSubmissions: subs.totalSubmissions || 0,
      averageScorePercent: Number(Number(subs.avgScorePercent || 0).toFixed(2)),
      passingSubmissions: subs.passingSubmissions || 0,
      totalViolations: violationsMap.get(key) || 0,
    };
  });

  const collegeComparative = result
    .map((college) => ({
      collegeId: college.collegeId,
      collegeName: college.collegeName,
      students: college.studentCount,
      avgScore: college.averageScorePercent,
      passRate: college.totalSubmissions > 0
        ? Number(((college.passingSubmissions / college.totalSubmissions) * 100).toFixed(2))
        : 0,
      participation: college.studentCount > 0
        ? Number((college.totalSubmissions / college.studentCount).toFixed(2))
        : 0,
      violations: college.totalViolations,
      departments: [],
      trend: platformTrend || [],
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  res.json({
    colleges: result,
    collegeComparative,
    topPerformingColleges: collegeComparative.slice(0, 10),
    topStudents: topStudents || [],
    mostActiveTests: mostActiveTests || [],
    collegeViolations: result.map((college) => ({
      college: college.collegeName,
      collegeName: college.collegeName,
      violations: college.totalViolations,
    })),
    platformTrend: platformTrend || [],
    violationStatistics: violationStatistics || [],
  });
});

module.exports = { getSuperAnalytics };
