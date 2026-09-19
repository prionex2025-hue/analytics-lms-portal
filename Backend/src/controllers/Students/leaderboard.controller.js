const models = require("../../models");
const { redisClient, isRedisAvailable } = require("../../config/redis");
const { asyncHandler } = require("../../utils/http");
const { getPagination } = require("../../utils/pagination");
const { getSubmissionScorePercent } = require("../../utils/score");
const { REPORTABLE_SUBMISSION_STATUSES } = require("../../services/report-scope.service");
const { dedupeByEvaluationRule } = require("../../services/attempt-evaluation.service");

const normalizeIdList = (values = []) =>
  [...new Set(values.filter(Boolean).map((value) => String(value)))];
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

const getLeaderboard = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const view = String(req.query.view || "overall").trim().toLowerCase();
  const testId = String(req.query.testId || req.query.test_id || "").trim();
  const collegeId = req.user.collegeId;
  const departmentId = req.user.departmentId;
  const userBatchIds = normalizeIdList(req.user.batchIds || []);
  const requestedBatchId = req.query.batchId ? String(req.query.batchId).trim() : "";
  const batchId = requestedBatchId && userBatchIds.includes(requestedBatchId)
    ? requestedBatchId
    : (userBatchIds.length > 0 ? userBatchIds[0] : req.user.batchId);
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 50, maxLimit: 100 });

  if (view === "per_test" && !testId) {
    return res.status(200).json({
      data: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0,
      },
    });
  }

  let scopedView = view;
  let scopedDepartmentId = departmentId || null;
  let scopedBatchIds = normalizeIdList(batchId ? [batchId] : []);

  if (testId) {
    const test = await db.test.findUnique({
      where: { id: testId },
      include: {
        batchAssignments: {
          select: { batchId: true },
        },
      },
    });

    if (!test || String(test.collegeId || "") !== String(collegeId || "")) {
      return res.status(200).json({
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      });
    }

    const assignmentMethod = String(test.assignmentMethod || "").trim().toLowerCase();
    const testBatchIds = normalizeIdList([
      test.batchId,
      ...(Array.isArray(test.batchAssignments)
        ? test.batchAssignments.map((item) => item?.batchId)
        : []),
    ]);
    const testDepartmentIds = normalizeIdList([
      test.departmentId,
      ...(Array.isArray(test.assignedTo) ? test.assignedTo : []),
    ]);

    const shouldScopeByBatch = assignmentMethod === "batch_wise"
      || (!assignmentMethod && testBatchIds.length > 0);
    const shouldScopeByDepartment = assignmentMethod === "department_wise"
      || (!assignmentMethod && testDepartmentIds.length > 0);

    if (shouldScopeByBatch) {
      scopedView = "batch_wise";
      scopedBatchIds = testBatchIds.length > 0
        ? userBatchIds.filter((id) => testBatchIds.includes(id))
        : userBatchIds;
      if (scopedBatchIds.length === 0) {
        return res.status(200).json({
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
          },
        });
      }
    } else if (shouldScopeByDepartment) {
      scopedView = "department_wise";
      scopedDepartmentId = req.user?.departmentId || departmentId || null;
      if (!scopedDepartmentId || (testDepartmentIds.length > 0 && !testDepartmentIds.includes(String(scopedDepartmentId)))) {
        return res.status(200).json({
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
          },
        });
      }
    } else {
      scopedView = "overall";
      scopedDepartmentId = departmentId || null;
      scopedBatchIds = normalizeIdList(batchId ? [batchId] : []);
    }
  }

  const cacheKey = `leaderboard:${scopedView}:${collegeId}:${scopedDepartmentId || "all"}:${(scopedBatchIds.join("-") || "all")}:${testId || "all"}:${page}:${limit}`;
  if (isRedisAvailable()) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }
  }

  const userWhere = { collegeId };
  if (scopedView === "department_wise") {
    if (!scopedDepartmentId) {
      return res.status(200).json({
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      });
    }
    userWhere.departmentId = scopedDepartmentId;
  }
  if (scopedView === "batch_wise") {
    if (!scopedBatchIds.length) {
      return res.status(200).json({
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      });
    }
    userWhere.batchIds = { in: scopedBatchIds };
  }

  const where = {
    status: { in: REPORTABLE_SUBMISSION_STATUSES },
    user: userWhere,
    test: { collegeId },
  };

  if (testId) {
    where.testId = testId;
  }

  const submissions = await db.submission.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          studentId: true,
          enrollNumber: true,
          enrollmentNumber: true,
        },
      },
      test: {
        select: {
          id: true,
          title: true,
          subject: true,
          totalMarks: true,
          evaluationRule: true,
        },
      },
    },
    orderBy: [{ submittedAt: "desc" }],
  });

  // Collapse multiple attempts to one official row per (student, test) using the
  // test's recorded evaluationRule (BEST_ATTEMPT / LAST_ATTEMPT). Without this a
  // student who is allowed several attempts appears once per attempt.
  const rows = dedupeByEvaluationRule(submissions.filter((entry) => entry?.user && entry?.test))
    .map((entry) => ({
      ...entry,
      scorePercent: getSubmissionScorePercent(entry),
    }))
    .sort((a, b) => {
      if (b.scorePercent !== a.scorePercent) return b.scorePercent - a.scorePercent;
      return Number(a.timeSpentSeconds || 0) - Number(b.timeSpentSeconds || 0);
    });
  const pagedRows = rows.slice(skip, skip + limit);

  const payload = {
    data: pagedRows.map((entry, index) => ({
      rank: (page - 1) * limit + index + 1,
      id: entry.id,
      userId: entry.user.id,
      studentName: entry.user.fullName,
      studentId: getStudentNumber(entry.user),
      testId: entry.test.id,
      testName: entry.test.title,
      subject: entry.test.subject,
      score: entry.scorePercent,
      rawScore: Number(entry.score || 0),
      totalMarks: Number(entry.test?.totalMarks || 0),
      percentage: entry.scorePercent,
      accuracy: entry.scorePercent,
      timeTakenSeconds: entry.timeSpentSeconds,
    })),
    pagination: {
      page,
      limit,
      total: rows.length,
      totalPages: Math.ceil(rows.length / limit),
    },
  };

  if (isRedisAvailable()) {
    await redisClient.set(cacheKey, JSON.stringify(payload), "EX", 120);
  }

  res.status(200).json(payload);
});

module.exports = { getLeaderboard };
