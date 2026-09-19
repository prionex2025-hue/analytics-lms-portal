/**
 * Exam-integrity analytics: what proctoring flags fired, when during the exam
 * they fired, who repeats them, and whether flagged attempts score differently.
 *
 * Pure functions over plain rows so the statistics are unit-testable.
 */

const VIOLATION_TYPES = [
  "TAB_SWITCH",
  "WINDOW_BLUR",
  "COPY_PASTE",
  "RIGHT_CLICK",
  "FULLSCREEN_EXIT",
  "SCREENSHOT_ATTEMPT",
  "DEVTOOLS_OPEN",
];

const toFinite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toTime = (value) => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const average = (values = []) => {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return 0;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
};

/**
 * Bucket violations by elapsed minutes since each attempt started, so the
 * timeline shows *where in the exam* integrity breaks down (e.g. a spike near
 * submission) rather than wall-clock time, which is meaningless across
 * staggered starts.
 */
const buildTimeline = ({ violations, submissionStartById, bucketMinutes = 5, durationMins = 60 }) => {
  const buckets = new Map();
  const span = Math.max(1, Math.ceil(durationMins / bucketMinutes));
  for (let index = 0; index < span; index += 1) {
    buckets.set(index, 0);
  }

  for (const violation of violations) {
    const startedAt = submissionStartById.get(String(violation.submissionId));
    const at = toTime(violation.timestamp ?? violation.createdAt);
    if (!startedAt || at == null) continue;
    const elapsedMinutes = (at - startedAt) / 60000;
    if (elapsedMinutes < 0) continue;
    const index = Math.min(span - 1, Math.floor(elapsedMinutes / bucketMinutes));
    buckets.set(index, (buckets.get(index) || 0) + 1);
  }

  return [...buckets.entries()].map(([index, count]) => ({
    bucket: index,
    fromMinute: index * bucketMinutes,
    toMinute: (index + 1) * bucketMinutes,
    label: `${index * bucketMinutes}-${(index + 1) * bucketMinutes}m`,
    count,
  }));
};

const computeIntegrityAnalytics = ({
  violations = [],
  submissions = [],
  bucketMinutes = 5,
  durationMins = 60,
  repeatThreshold = 3,
} = {}) => {
  const submissionStartById = new Map();
  const submissionById = new Map();
  for (const submission of submissions) {
    const key = String(submission.id);
    submissionById.set(key, submission);
    const startedAt = toTime(submission.startedAt);
    if (startedAt != null) submissionStartById.set(key, startedAt);
  }

  // Counts per type — always report all seven so a zero reads as "none", not "missing".
  const typeCounts = new Map(VIOLATION_TYPES.map((type) => [type, 0]));
  for (const violation of violations) {
    const type = String(violation.type || "").toUpperCase();
    if (!typeCounts.has(type)) typeCounts.set(type, 0);
    typeCounts.set(type, typeCounts.get(type) + 1);
  }
  const byType = [...typeCounts.entries()]
    .map(([type, count]) => ({
      type,
      count,
      share: violations.length ? Number(((count / violations.length) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Per-student tallies.
  const perStudent = new Map();
  for (const violation of violations) {
    const submission = submissionById.get(String(violation.submissionId));
    const studentId = String(violation.userId || submission?.userId || "");
    if (!studentId) continue;
    if (!perStudent.has(studentId)) {
      perStudent.set(studentId, {
        studentId,
        studentName: submission?.studentName || violation.studentName || "Student",
        count: 0,
        types: new Set(),
        submissionId: submission?.id || violation.submissionId || null,
        scorePercent: submission ? toFinite(submission.scorePercent) : null,
      });
    }
    const entry = perStudent.get(studentId);
    entry.count += 1;
    entry.types.add(String(violation.type || "").toUpperCase());
  }

  const repeatOffenders = [...perStudent.values()]
    .filter((entry) => entry.count >= repeatThreshold)
    .map((entry) => ({ ...entry, types: [...entry.types] }))
    .sort((a, b) => b.count - a.count);

  // Does flagging correlate with score? Grouped, not a correlation coefficient —
  // the reader needs "clean attempts average X, flagged average Y".
  const violationCountBySubmission = new Map();
  for (const violation of violations) {
    const key = String(violation.submissionId);
    violationCountBySubmission.set(key, (violationCountBySubmission.get(key) || 0) + 1);
  }
  const bands = { clean: [], low: [], high: [] };
  for (const submission of submissions) {
    const count = violationCountBySubmission.get(String(submission.id)) || 0;
    const score = toFinite(submission.scorePercent);
    if (count === 0) bands.clean.push(score);
    else if (count <= 2) bands.low.push(score);
    else bands.high.push(score);
  }

  const scoreByViolationBand = [
    { band: "CLEAN", label: "No violations", attempts: bands.clean.length, avgScore: Number(average(bands.clean).toFixed(2)) },
    { band: "LOW", label: "1-2 violations", attempts: bands.low.length, avgScore: Number(average(bands.low).toFixed(2)) },
    { band: "HIGH", label: "3+ violations", attempts: bands.high.length, avgScore: Number(average(bands.high).toFixed(2)) },
  ];

  const flaggedAttempts = submissions.length
    ? submissions.filter((submission) => (violationCountBySubmission.get(String(submission.id)) || 0) > 0).length
    : 0;

  return {
    summary: {
      totalViolations: violations.length,
      attempts: submissions.length,
      flaggedAttempts,
      cleanAttempts: submissions.length - flaggedAttempts,
      flaggedRate: submissions.length ? Number(((flaggedAttempts / submissions.length) * 100).toFixed(2)) : 0,
      repeatOffenders: repeatOffenders.length,
    },
    byType,
    timeline: buildTimeline({ violations, submissionStartById, bucketMinutes, durationMins }),
    repeatOffenders,
    scoreByViolationBand,
  };
};

module.exports = {
  computeIntegrityAnalytics,
  buildTimeline,
  VIOLATION_TYPES,
};
