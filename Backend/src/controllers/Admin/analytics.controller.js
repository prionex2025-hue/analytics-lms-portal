const mongoose = require("mongoose");
const { asyncHandler } = require("../../utils/http");
const { toObjectIdIfValid, withSubmissionScorePercent } = require("../../utils/analytics-aggregation");
const { getScopedDepartmentId } = require("../../utils/admin-scope");
const { REPORTABLE_SUBMISSION_STATUSES } = require("../../services/report-scope.service");

const getCollegeAnalytics = asyncHandler(async (req, res) => {
  const db = mongoose.connection.db;
  const collegeId = toObjectIdIfValid(req.collegeId);
  const scopedDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const departmentId = scopedDepartmentId ? toObjectIdIfValid(String(scopedDepartmentId)) : null;

  const submissionMatch = {
    collegeId,
    status: { $in: REPORTABLE_SUBMISSION_STATUSES },
    ...(departmentId ? { departmentId } : {}),
  };
  const studentMatch = {
    collegeId,
    isActive: true,
    ...(departmentId ? { departmentId } : {}),
  };
  const testMatch = departmentId
    ? {
      collegeId,
      $or: [
        { assignmentMethod: "everyone" },
        { assignmentMethod: "department_wise", departmentId },
        { assignmentMethod: "department_wise", assignedTo: departmentId },
        { assignmentMethod: null, departmentId },
        { assignmentMethod: null, assignedTo: departmentId },
      ],
    }
    : { collegeId };

  const [
    totalStudents,
    totalAdmins,
    totalDepartments,
    totalTests,
    totalSubmissions,
    uniqueParticipants,
    averageScorePayload,
    departmentPerformance,
    placementReadinessRaw,
    topPerformers,
    testParticipation,
    scoreTrendRaw,
    modulePerformanceRaw,
  ] = await Promise.all([
    db.collection("student").countDocuments(studentMatch),
    db.collection("admin").countDocuments({
      collegeId,
      role: { $in: ["ADMIN", "COLLEGE_ADMIN"] },
      isActive: true,
      ...(departmentId ? { departmentId } : {}),
    }),
    db.collection("department").countDocuments(
      departmentId ? { collegeId, id: departmentId } : { collegeId }
    ),
    db.collection("test").countDocuments(testMatch),
    db.collection("submission").countDocuments(submissionMatch),
    db.collection("submission").distinct("userId", submissionMatch),
    db.collection("submission").aggregate([
      { $match: submissionMatch },
      ...withSubmissionScorePercent(),
      { $group: { _id: null, averageScore: { $avg: "$scorePercent" } } },
    ]).toArray(),
    db.collection("submission").aggregate([
      { $match: submissionMatch },
      ...withSubmissionScorePercent(),
      {
        $lookup: {
          from: "student",
          localField: "userId",
          foreignField: "_id",
          as: "student",
        },
      },
      { $unwind: "$student" },
      {
        $group: {
          _id: "$student.departmentId",
          avgScore: { $avg: "$scorePercent" },
          passCount: {
            $sum: {
              $cond: [{ $gte: ["$scorePercent", 40] }, 1, 0],
            },
          },
          submissions: { $sum: 1 },
          participants: { $addToSet: "$userId" },
        },
      },
      {
        $lookup: {
          from: "department",
          localField: "_id",
          foreignField: "_id",
          as: "department",
        },
      },
      {
        $project: {
          _id: 0,
          departmentId: "$_id",
          departmentName: { $ifNull: [{ $arrayElemAt: ["$department.name", 0] }, "Unassigned"] },
          avgScore: { $round: ["$avgScore", 2] },
          passRate: {
            $round: [
              {
                $multiply: [
                  {
                    $cond: [{ $gt: ["$submissions", 0] }, { $divide: ["$passCount", "$submissions"] }, 0],
                  },
                  100,
                ],
              },
              2,
            ],
          },
          submissions: "$submissions",
          participants: { $size: "$participants" },
        },
      },
      { $sort: { avgScore: -1 } },
    ]).toArray(),
    db.collection("submission").aggregate([
      { $match: submissionMatch },
      ...withSubmissionScorePercent(),
      {
        $group: {
          _id: "$userId",
          avgScore: { $avg: "$scorePercent" },
        },
      },
      {
        $project: {
          readinessBand: {
            $switch: {
              branches: [
                { case: { $gte: ["$avgScore", 80] }, then: "Ready" },
                { case: { $gte: ["$avgScore", 60] }, then: "Needs Coaching" },
              ],
              default: "At Risk",
            },
          },
        },
      },
      {
        $group: {
          _id: "$readinessBand",
          count: { $sum: 1 },
        },
      },
      {
        $addFields: {
          sortOrder: {
            $switch: {
              branches: [
                { case: { $eq: ["$_id", "Ready"] }, then: 1 },
                { case: { $eq: ["$_id", "Needs Coaching"] }, then: 2 },
              ],
              default: 3,
            },
          },
        },
      },
      { $sort: { sortOrder: 1 } },
      {
        $project: {
          _id: 0,
          band: "$_id",
          count: 1,
        },
      },
    ]).toArray(),
    db.collection("submission").aggregate([
      { $match: submissionMatch },
      ...withSubmissionScorePercent(),
      {
        $lookup: {
          from: "student",
          localField: "userId",
          foreignField: "_id",
          as: "student",
        },
      },
      { $unwind: "$student" },
      {
        $group: {
          _id: "$userId",
          fullName: { $first: "$student.fullName" },
          departmentId: { $first: "$student.departmentId" },
          averageScore: { $avg: "$scorePercent" },
          attempts: { $sum: 1 },
        },
      },
      { $sort: { averageScore: -1, attempts: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "department",
          localField: "departmentId",
          foreignField: "_id",
          as: "department",
        },
      },
      {
        $project: {
          _id: 0,
          studentId: "$_id",
          fullName: "$fullName",
          departmentName: { $ifNull: [{ $arrayElemAt: ["$department.name", 0] }, "Unassigned"] },
          averageScore: { $round: ["$averageScore", 2] },
          attempts: 1,
        },
      },
    ]).toArray(),
    db.collection("submission").aggregate([
      { $match: submissionMatch },
      ...withSubmissionScorePercent(),
      {
        $group: {
          _id: "$testId",
          participants: { $addToSet: "$userId" },
          submissions: { $sum: 1 },
          averageScore: { $avg: "$scorePercent" },
        },
      },
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
          title: { $ifNull: [{ $arrayElemAt: ["$test.title", 0] }, "Untitled Test"] },
          participants: { $size: "$participants" },
          submissions: "$submissions",
          averageScore: { $round: ["$averageScore", 2] },
        },
      },
      { $sort: { participants: -1, averageScore: -1 } },
      { $limit: 10 },
    ]).toArray(),
    db.collection("submission").aggregate([
      { $match: submissionMatch },
      ...withSubmissionScorePercent(),
      {
        $addFields: {
          eventDate: { $ifNull: ["$submittedAt", "$createdAt"] },
        },
      },
      {
        $match: {
          eventDate: { $type: "date" },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$eventDate" } },
          averageScore: { $avg: "$scorePercent" },
          submissions: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 12 },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          month: "$_id",
          averageScore: { $round: ["$averageScore", 2] },
          submissions: 1,
        },
      },
    ]).toArray(),
    // MODULE_TEST: per-module performance across all module submissions.
    db.collection("submission").aggregate([
      { $match: submissionMatch },
      { $match: { "moduleState.0": { $exists: true } } },
      { $unwind: "$moduleState" },
      {
        $group: {
          _id: { key: "$moduleState.key", name: "$moduleState.name" },
          participants: { $addToSet: "$userId" },
          submissions: { $sum: 1 },
          averagePercentage: { $avg: "$moduleState.percentage" },
          averageScore: { $avg: "$moduleState.score" },
          averageTimeSeconds: { $avg: "$moduleState.timeTakenSeconds" },
        },
      },
      {
        $project: {
          _id: 0,
          key: "$_id.key",
          name: "$_id.name",
          participants: { $size: "$participants" },
          submissions: 1,
          averagePercentage: { $round: ["$averagePercentage", 2] },
          averageScore: { $round: ["$averageScore", 2] },
          averageTimeSeconds: { $round: ["$averageTimeSeconds", 2] },
        },
      },
      { $sort: { averagePercentage: -1 } },
    ]).toArray(),
  ]);

  const averageScore = Number(averageScorePayload?.[0]?.averageScore || 0);
  const participationRate = totalStudents > 0
    ? Number((((uniqueParticipants || []).length / totalStudents) * 100).toFixed(2))
    : 0;

  res.status(200).json({
    overview: {
      totalStudents,
      totalAdmins,
      totalDepartments,
      totalTests,
      totalSubmissions,
      averageScore: Number(averageScore.toFixed(2)),
      participationRate,
    },
    departmentPerformance,
    placementReadiness: placementReadinessRaw,
    topPerformers,
    testParticipation,
    scoreTrend: scoreTrendRaw,
    modulePerformance: modulePerformanceRaw,
  });
});

module.exports = {
  getCollegeAnalytics,
};
