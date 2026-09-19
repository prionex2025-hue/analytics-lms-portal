const models = require("../../models");
const { asyncHandler } = require("../../utils/http");
const { buildStudentAssignmentScope } = require("../../services/student-test-assignment.service");
const { getSubmissionScorePercent } = require("../../utils/score");
const { REPORTABLE_SUBMISSION_STATUSES } = require("../../services/report-scope.service");

const getSummary = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const userId = req.user.id;
  const now = new Date();

  const submissions = await db.submission.findMany({
    where: {
      userId,
      status: {
        in: REPORTABLE_SUBMISSION_STATUSES,
      },
    },
    include: {
      test: true,
    },
    orderBy: { submittedAt: "desc" },
  });

  const totalTestsCompleted = submissions.length;
  const averageAccuracy =
    submissions.length > 0
      ? Number(
          (
            submissions.reduce((acc, item) => acc + getSubmissionScorePercent(item), 0) / submissions.length
          ).toFixed(2)
        )
      : 0;

  const ongoingTests = await db.test.findMany({
    where: {
      ...buildStudentAssignmentScope(req.user),
      startsAt: { lte: now },
      endsAt: { gte: now },
      isPublished: true,
    },
    orderBy: { startsAt: "asc" },
    include: {
      submissions: {
        where: { userId },
        select: {
          id: true,
          status: true,
          startedAt: true,
          timeSpentSeconds: true,
        },
      },
    },
  });

  const upcomingTests = await db.test.findMany({
    where: {
      ...buildStudentAssignmentScope(req.user),
      startsAt: { gt: now },
      isPublished: true,
    },
    orderBy: { startsAt: "asc" },
    take: 10,
  });

  const events = await db.event.findMany({
    where: {
      startsAt: { gte: now },
      collegeId: req.user.collegeId,
    },
    orderBy: { startsAt: "asc" },
    take: 5,
  });

  const weeklyActivity = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    const count = submissions.filter((s) => {
      if (!s.submittedAt) return false;
      return s.submittedAt.toISOString().slice(0, 10) === key;
    }).length;
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      completed: count,
    };
  });

  res.status(200).json({
    cards: {
      totalTestsCompleted,
      averageAccuracy,
    },
    ongoingTests,
    upcomingTests,
    weeklyActivity,
    events,
  });
});

module.exports = {
  getSummary,
};
