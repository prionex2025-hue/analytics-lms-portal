// Anomaly types an admin or super admin can review from a report.
//
// The report payloads surface each proctoring violation as a reviewable event
// (anomalyId = violation id, anomalyType = violation type), alongside the
// statistical anomaly flags. The review schemas must accept both, otherwise every
// Dismiss/Escalate on a violation event fails validation.
const PROCTORING_VIOLATION_TYPES = [
  "TAB_SWITCH",
  "WINDOW_BLUR",
  "COPY_PASTE",
  "RIGHT_CLICK",
  "FULLSCREEN_EXIT",
  "SCREENSHOT_ATTEMPT",
  "DEVTOOLS_OPEN",
];

const STATISTICAL_ANOMALY_TYPES = [
  "UNUSUALLY_FAST_HIGH_SCORE",
  "HIGH_VIOLATIONS_HIGH_SCORE",
  "IDENTICAL_ANSWER_PATTERN",
];

const REVIEWABLE_ANOMALY_TYPES = [...STATISTICAL_ANOMALY_TYPES, ...PROCTORING_VIOLATION_TYPES];

module.exports = {
  PROCTORING_VIOLATION_TYPES,
  STATISTICAL_ANOMALY_TYPES,
  REVIEWABLE_ANOMALY_TYPES,
};
