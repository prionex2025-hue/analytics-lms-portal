const REVIEW_MODES = Object.freeze({
  SHOW_ALL: "show_all",
  SHOW_SCORE_ONLY: "show_score_only",
  SHOW_AFTER_DEADLINE: "show_after_deadline",
});

const normalizeReviewMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (["show_all", "all", "full", "full_review", "immediate"].includes(normalized)) {
    return REVIEW_MODES.SHOW_ALL;
  }

  if (["show_score_only", "score_only", "score", "hidden", "none"].includes(normalized)) {
    return REVIEW_MODES.SHOW_SCORE_ONLY;
  }

  if (["show_after_deadline", "after_deadline", "after_test", "after_end", "deadline"].includes(normalized)) {
    return REVIEW_MODES.SHOW_AFTER_DEADLINE;
  }

  return REVIEW_MODES.SHOW_AFTER_DEADLINE;
};

const asTestObject = (test) => (test && typeof test === "object" ? test : {});

const resolveReviewMode = (test = {}) => {
  const safeTest = asTestObject(test);
  return normalizeReviewMode(
    safeTest.reviewMode ||
      safeTest.review_mode ||
      safeTest.resultReviewMode ||
      safeTest.result_review_mode ||
      safeTest.answerVisibility ||
      safeTest.answer_visibility
  );
};

const getReviewDeadline = (test = {}) => {
  const safeTest = asTestObject(test);
  return safeTest.endsAt || safeTest.endDate || safeTest.end_date || safeTest.ends_at || null;
};

const hasDeadlinePassed = (deadline) => {
  if (!deadline) {
    return false;
  }

  const deadlineMs = new Date(deadline).getTime();
  return Number.isFinite(deadlineMs) && Date.now() >= deadlineMs;
};

const isTestCompleted = (test = {}) => {
  const safeTest = asTestObject(test);
  const status = String(safeTest.status || safeTest.lifecycleStatus || safeTest.testStatus || "").trim().toUpperCase();

  // Explicitly completed/archived by an admin, or flagged with a completion marker.
  if (["COMPLETED", "COMPLETE", "ARCHIVED"].includes(status)) {
    return true;
  }
  if (safeTest.completedAt || safeTest.completed_at) {
    return true;
  }

  // Derived completion: the scheduled window has closed. This mirrors the
  // admin-side deriveLifecycleStatus(), which reports a test as COMPLETED once
  // endsAt < now even while the stored status is still LIVE/PUBLISHED. Without
  // this, a test that is effectively over is still treated as "live" by the
  // results page and its answers stay hidden indefinitely.
  return hasDeadlinePassed(getReviewDeadline(safeTest));
};

const canRevealCorrectAnswers = (test = {}) => {
  // Once the test is over (explicitly completed/archived, or its window has
  // closed), always reveal the result and correct answers.
  if (isTestCompleted(test)) {
    return true;
  }

  // While the test is still live, only reveal early when the instructor
  // explicitly opted to show everything immediately. Every other mode stays
  // hidden until the test is over (handled above).
  return resolveReviewMode(test) === REVIEW_MODES.SHOW_ALL;
};

const maskCorrectAnswer = (correctAnswer, test = {}) =>
  canRevealCorrectAnswers(test) ? correctAnswer : null;

module.exports = {
  REVIEW_MODES,
  canRevealCorrectAnswers,
  getReviewDeadline,
  isTestCompleted,
  maskCorrectAnswer,
  resolveReviewMode,
};
