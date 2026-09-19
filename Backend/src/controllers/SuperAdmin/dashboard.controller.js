const { getDb } = require("../../utils/db");
const { asyncHandler } = require("../../utils/http");
const { getSubmissionScorePercent } = require("../../utils/score");
const { REPORTABLE_SUBMISSION_STATUSES } = require("../../services/report-scope.service");

const getSuperAdminDashboard = asyncHandler(async (_req, res) => {
  const db = await getDb();
  const now = new Date();
  const activeWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const chartWindowStart = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);

  const [
    totalColleges,
    totalAdmins,
    totalStudents,
    totalTests,
    activeSessions,
    submissions,
    collegePerformance,
  ] = await Promise.all([
    db.college.count({ where: { isActive: true } }),
    db.admin.count({ where: { isActive: true } }),
    db.student.count({ where: { isActive: true } }),
    db.test.count(),
    db.testSession.findMany({
      where: {
        endedAt: null,
        lastHeartbeatAt: { gte: chartWindowStart },
      },
      select: {
        userId: true,
        lastHeartbeatAt: true,
      },
    }),
    db.submission.findMany({
      where: {
        status: { in: REPORTABLE_SUBMISSION_STATUSES },
        submittedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: {
        submittedAt: true,
        score: true,
        collegeId: true,
        test: { select: { totalMarks: true } },
      },
      orderBy: { submittedAt: "asc" },
    }),
    db.college.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        submissions: {
          where: { status: { in: REPORTABLE_SUBMISSION_STATUSES } },
          select: { score: true, test: { select: { totalMarks: true } } },
        },
      },
      take: 20,
    }),
  ]);

  const activeDailyMap = new Map();
  const participationMap = new Map();
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    activeDailyMap.set(key, new Set());
    participationMap.set(key, 0);
  }

  activeSessions.forEach((session) => {
    if (!session.userId || !session.lastHeartbeatAt) return;

    const heartbeatAt = new Date(session.lastHeartbeatAt);
    if (Number.isNaN(heartbeatAt.getTime())) return;

    const key = heartbeatAt.toISOString().slice(0, 10);
    const dayUsers = activeDailyMap.get(key);
    if (dayUsers) {
      dayUsers.add(String(session.userId));
    }
  });

  submissions.forEach((item) => {
    if (!item.submittedAt) return;
    const key = item.submittedAt.toISOString().slice(0, 10);
    if (participationMap.has(key)) {
      participationMap.set(key, participationMap.get(key) + 1);
    }
  });

  const activeUsers = new Set(
    activeSessions
      .filter((session) => session.userId && session.lastHeartbeatAt && new Date(session.lastHeartbeatAt) >= activeWindowStart)
      .map((session) => String(session.userId))
  ).size;

  const collegeWisePerformance = collegePerformance.map((college) => {
    const participantCount = college.submissions.length;
    const avgScore = participantCount > 0
      ? college.submissions.reduce((sum, row) => sum + getSubmissionScorePercent(row), 0) / participantCount
      : 0;

    return {
      collegeId: college.id,
      collegeName: college.name,
      participants: participantCount,
      avgScore: Number(avgScore.toFixed(2)),
    };
  });

  res.status(200).json({
    cards: {
      totalColleges,
      totalAdmins,
      totalStudents,
      totalTests,
      activeUsers,
    },
    charts: {
      dailyActiveUsers: Array.from(activeDailyMap.entries()).map(([day, users]) => ({ day, users: users.size })),
      testParticipationTrend: Array.from(participationMap.entries()).map(([day, count]) => ({ day, count })),
      collegeWisePerformance,
    },
  });
});

module.exports = {
  getSuperAdminDashboard,
};
