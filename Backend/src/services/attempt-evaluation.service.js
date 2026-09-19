/**
 * Applies a test's recorded `evaluationRule` (set at test creation) when a
 * single "official" attempt must be chosen from a student's multiple attempts.
 *
 * - BEST_ATTEMPT (default): highest raw score, tie-broken by the later attempt.
 * - LAST_ATTEMPT: the most recently submitted attempt.
 *
 * Used by the leaderboard and the student's per-test report so that, when a
 * test allows more than one attempt, results honour what the admin configured
 * instead of silently always taking the latest attempt (and, on the
 * leaderboard, listing every attempt as a separate row).
 */
const normalizeEvaluationRule = (rule) =>
  String(rule || "").trim().toUpperCase() === "LAST_ATTEMPT" ? "LAST_ATTEMPT" : "BEST_ATTEMPT";

const submissionTime = (submission) => {
  const time = new Date(submission?.submittedAt || submission?.updatedAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

const submissionScore = (submission) => {
  const score = Number(submission?.score);
  return Number.isFinite(score) ? score : 0;
};

const attemptNumberOf = (submission) => {
  const value = Number(submission?.attemptNumber);
  return Number.isFinite(value) ? value : 0;
};

// True when attempt `a` should be preferred over `b` under `rule`.
const prefersAttempt = (a, b, rule) => {
  const normalized = normalizeEvaluationRule(rule);
  if (normalized === "LAST_ATTEMPT") {
    if (submissionTime(a) !== submissionTime(b)) return submissionTime(a) > submissionTime(b);
    return attemptNumberOf(a) >= attemptNumberOf(b);
  }
  // BEST_ATTEMPT — highest raw score, then the later attempt as a tie-breaker.
  if (submissionScore(a) !== submissionScore(b)) return submissionScore(a) > submissionScore(b);
  if (submissionTime(a) !== submissionTime(b)) return submissionTime(a) > submissionTime(b);
  return attemptNumberOf(a) >= attemptNumberOf(b);
};

// Order-by clause for a `findFirst` that should return the evaluated attempt.
const evaluationOrderBy = (rule) =>
  normalizeEvaluationRule(rule) === "LAST_ATTEMPT"
    ? [{ submittedAt: "desc" }]
    : [{ score: "desc" }, { submittedAt: "desc" }];

// Keep exactly one submission per (userId, testId), chosen by that test's rule.
// `ruleFor(submission)` resolves the rule; defaults to `submission.test.evaluationRule`.
const dedupeByEvaluationRule = (submissions = [], ruleFor) => {
  const resolveRule =
    typeof ruleFor === "function" ? ruleFor : (submission) => submission?.test?.evaluationRule;

  const chosen = new Map();
  for (const submission of Array.isArray(submissions) ? submissions : []) {
    if (!submission) continue;
    const userKey = submission.userId ?? submission.user?.id;
    const testKey = submission.testId ?? submission.test?.id;
    if (userKey == null || testKey == null) continue;
    const key = `${userKey}::${testKey}`;
    const rule = normalizeEvaluationRule(resolveRule(submission));
    const current = chosen.get(key);
    if (!current || prefersAttempt(submission, current, rule)) {
      chosen.set(key, submission);
    }
  }
  return [...chosen.values()];
};

module.exports = {
  normalizeEvaluationRule,
  prefersAttempt,
  evaluationOrderBy,
  dedupeByEvaluationRule,
};
