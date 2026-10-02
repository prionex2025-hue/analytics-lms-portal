const {
  PASS_THRESHOLD_PERCENT,
  HEALTHY_THRESHOLD_PERCENT,
  DISTINCTION_THRESHOLD_PERCENT,
  mean,
  median,
  describeDistribution,
} = require("../utils/stats");

/**
 * Authoritative reporting metrics.
 *
 * The core rule this module enforces: a metric that requires observations is
 * `null` when there are none. It is never coerced to 0, because "no data" and
 * "zero" are different facts and reporting them as the same is the single most
 * damaging mistake a reports module can make.
 */

const EVALUATION_RULE = {
  BEST_ATTEMPT: "BEST_ATTEMPT",
  LATEST_ATTEMPT: "LATEST_ATTEMPT",
  FIRST_ATTEMPT: "FIRST_ATTEMPT",
  AVERAGE: "AVERAGE",
};

const toFiniteArray = (values) =>
  (Array.isArray(values) ? values : []).map((value) => Number(value)).filter((value) => Number.isFinite(value));

const round2 = (value) => (Number.isFinite(value) ? Number(value.toFixed(2)) : null);

/** Average of observations, or null when there are none. */
const averageOf = (values) => {
  const nums = toFiniteArray(values);
  if (!nums.length) return null;
  return round2(mean(nums));
};

/** Share of observations at/above a threshold, or null when there are none. */
const shareAtOrAboveOf = (values, threshold = PASS_THRESHOLD_PERCENT) => {
  const nums = toFiniteArray(values);
  if (!nums.length) return null;
  return round2((nums.filter((value) => value >= threshold).length / nums.length) * 100);
};

/** Share of observations at/above the pass mark, or null when none. */
const passRateOf = (values, threshold = PASS_THRESHOLD_PERCENT) => shareAtOrAboveOf(values, threshold);

/**
 * Participation needs both a numerator and a meaningful denominator. When no
 * tests were assigned there is nothing to participate in, so the rate is null.
 */
const participationRateOf = ({ attempted, assigned }) => {
  const attemptedCount = Number(attempted);
  const assignedCount = Number(assigned);
  if (!Number.isFinite(assignedCount) || assignedCount <= 0) return null;
  if (!Number.isFinite(attemptedCount)) return null;
  return round2((Math.max(0, attemptedCount) / assignedCount) * 100);
};

const emptyScoreStats = () => ({
  sampleSize: 0,
  average: null,
  median: null,
  passRate: null,
  highest: null,
  lowest: null,
  stdDev: null,
  distribution: null,
});

/** Distribution-aware summary. Every field is null when there are no scores. */
const scoreStatsOf = (values) => {
  const nums = toFiniteArray(values);
  if (!nums.length) return emptyScoreStats();
  const distribution = describeDistribution(nums);
  return {
    sampleSize: nums.length,
    average: averageOf(nums),
    median: round2(median(nums)),
    passRate: passRateOf(nums),
    highest: round2(Math.max(...nums)),
    lowest: round2(Math.min(...nums)),
    stdDev: round2(distribution.stdDev),
    distribution,
  };
};

const normalizeEvaluationRule = (rule) => {
  const normalized = String(rule || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return Object.values(EVALUATION_RULE).includes(normalized) ? normalized : EVALUATION_RULE.BEST_ATTEMPT;
};

/**
 * Reduce a student's attempts to a single representative score according to the
 * test's evaluation rule. This is the one place attempt-selection happens for
 * reports, so analytics, exports and PDFs can no longer disagree.
 *
 * @param attempts [{ scorePercent, date }]
 */
const resolveAttemptScore = (attempts, rule = EVALUATION_RULE.BEST_ATTEMPT) => {
  const scored = (Array.isArray(attempts) ? attempts : [])
    .map((attempt) => ({
      scorePercent: Number(attempt?.scorePercent),
      date: attempt?.date ? new Date(attempt.date).getTime() : 0,
    }))
    .filter((attempt) => Number.isFinite(attempt.scorePercent))
    .sort((a, b) => a.date - b.date || a.scorePercent - b.scorePercent);

  if (!scored.length) return null;

  switch (normalizeEvaluationRule(rule)) {
    case EVALUATION_RULE.LATEST_ATTEMPT:
      return round2(scored[scored.length - 1].scorePercent);
    case EVALUATION_RULE.FIRST_ATTEMPT:
      return round2(scored[0].scorePercent);
    case EVALUATION_RULE.AVERAGE:
      return round2(scored.reduce((sum, attempt) => sum + attempt.scorePercent, 0) / scored.length);
    case EVALUATION_RULE.BEST_ATTEMPT:
    default:
      return round2(Math.max(...scored.map((attempt) => attempt.scorePercent)));
  }
};

const classifyScoreBand = (scorePercent) => {
  if (scorePercent == null) return "NO_DATA";
  const score = Number(scorePercent);
  if (!Number.isFinite(score)) return "NO_DATA";
  if (score >= DISTINCTION_THRESHOLD_PERCENT) return "DISTINCTION";
  if (score >= HEALTHY_THRESHOLD_PERCENT) return "HEALTHY";
  if (score >= PASS_THRESHOLD_PERCENT) return "PASS";
  return "FAIL";
};

module.exports = {
  EVALUATION_RULE,
  PASS_THRESHOLD_PERCENT,
  HEALTHY_THRESHOLD_PERCENT,
  DISTINCTION_THRESHOLD_PERCENT,
  averageOf,
  passRateOf,
  shareAtOrAboveOf,
  participationRateOf,
  scoreStatsOf,
  normalizeEvaluationRule,
  resolveAttemptScore,
  classifyScoreBand,
  round2,
};
