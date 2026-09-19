const models = require("../../models");
const { asyncHandler } = require("../../utils/http");
const { getSubmissionScorePercent } = require("../../utils/score");
const { REPORTABLE_SUBMISSION_STATUSES } = require("../../services/report-scope.service");

const getAdminDashboard = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const now = new Date();

  const [
    totalStudents,
    totalTests,
    activeTests,
    upcomingTests,
    recentSubmissions,
    recentActivity,
    tests,
  ] = await Promise.all([
    db.student.count({ where: { collegeId, isActive: true } }),
    db.test.count({ where: { collegeId } }),
    db.test.count({
      where: {
        collegeId,
        startsAt: { lte: now },
        endsAt: { gte: now },
        isPublished: true,
      },
    }),
    db.test.count({
      where: {
        collegeId,
        startsAt: { gt: now },
      },
    }),
    db.submission.findMany({
      where: {
        collegeId,
        status: { in: REPORTABLE_SUBMISSION_STATUSES },
      },
      include: {
        user: {
          select: { fullName: true, studentId: true },
        },
        test: {
          select: { title: true, totalMarks: true },
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
      take: 10,
    }),
    db.auditLog.findMany({
      where: { collegeId },
      include: {
        admin: {
          select: { fullName: true, email: true },
        },
        test: {
          select: { id: true, title: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.test.findMany({
      where: { collegeId },
      include: {
        submissions: {
          where: { status: { in: REPORTABLE_SUBMISSION_STATUSES } },
          select: {
            id: true,
            score: true,
            submittedAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  ]);

  const participationTrendMap = new Map();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setMonth(now.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    participationTrendMap.set(key, 0);
  }

  tests.forEach((test) => {
    test.submissions.forEach((submission) => {
      if (!submission.submittedAt) return;
      const d = new Date(submission.submittedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (participationTrendMap.has(key)) {
        participationTrendMap.set(key, participationTrendMap.get(key) + 1);
      }
    });
  });

  const averageScorePerTest = tests.map((test) => {
    const count = test.submissions.length;
    const avgScore = count > 0
      ? test.submissions.reduce((acc, item) => acc + getSubmissionScorePercent({ ...item, test }), 0) / count
      : 0;
    return {
      testId: test.id,
      testName: test.title,
      averageScore: Number(avgScore.toFixed(2)),
      participants: count,
    };
  });

  res.status(200).json({
    cards: {
      totalStudents,
      totalTestsCreated: totalTests,
      activeTests,
      upcomingTests,
    },
    recentSubmissions,
    recentActivity,
    charts: {
      testParticipationTrend: Array.from(participationTrendMap.entries()).map(([month, count]) => ({ month, count })),
      averageScorePerTest,
    },
  });
});

module.exports = {
  getAdminDashboard,
};
