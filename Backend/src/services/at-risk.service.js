/**
 * At-risk student detection.
 *
 * Deliberately rule-based, not a black box: every flagged student comes back
 * with the contributing reasons and the points each contributed, so an admin
 * can act on (and argue with) the result. Pure functions — unit-testable.
 */

const { linearSlope } = require("./cohort-trends.service");

const PASS_MARK = 40;

// Weights sum to 100 at worst case. Tuned so a single signal never alone
// produces a CRITICAL flag — risk needs corroboration.
const WEIGHTS = {
  FAILING_AVERAGE: 35,
  LOW_AVERAGE: 18,
  DECLINING: 22,
  LOW_PARTICIPATION: 23,
  VIOLATIONS: 20,
};

// Calibrated so ONE strong signal (declining / low participation / repeated
// violations / failing average) surfaces as at least MODERATE, while CRITICAL
// still requires several signals to corroborate. A weak signal on its own
// (e.g. an average merely near the pass mark) stays below the surfacing bar.
const RISK_LEVELS = [
  { level: "CRITICAL", min: 65 },
  { level: "HIGH", min: 45 },
  { level: "MODERATE", min: 20 },
  { level: "LOW", min: 0 },
];

const toFinite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const levelFor = (score) => (RISK_LEVELS.find((entry) => score >= entry.min) || RISK_LEVELS[RISK_LEVELS.length - 1]).level;

/**
 * @param students [{
 *   id, name, rollNo, department, batch,
 *   attempts: [{ scorePercent, date }],   // chronological
 *   assignedTests: number,
 *   violations: number,
 * }]
 */
const computeAtRisk = ({ students = [], passMark = PASS_MARK, minRiskScore = 20 } = {}) => {
  const assessed = students.map((student) => {
    const attempts = Array.isArray(student.attempts) ? [...student.attempts] : [];
    attempts.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

    const scores = attempts.map((attempt) => toFinite(attempt.scorePercent));
    const attemptCount = scores.length;
    const average = attemptCount ? scores.reduce((sum, value) => sum + value, 0) / attemptCount : 0;
    const assignedTests = Math.max(toFinite(student.assignedTests), attemptCount);
    const participation = assignedTests > 0 ? (attemptCount / assignedTests) * 100 : 0;
    const violations = toFinite(student.violations);
    const slope = linearSlope(scores);

    const reasons = [];
    let riskScore = 0;

    if (attemptCount > 0 && average < passMark) {
      riskScore += WEIGHTS.FAILING_AVERAGE;
      reasons.push({
        code: "FAILING_AVERAGE",
        label: "Average below pass mark",
        detail: `${average.toFixed(1)}% average across ${attemptCount} attempt${attemptCount === 1 ? "" : "s"}`,
        points: WEIGHTS.FAILING_AVERAGE,
      });
    } else if (attemptCount > 0 && average < passMark + 15) {
      riskScore += WEIGHTS.LOW_AVERAGE;
      reasons.push({
        code: "LOW_AVERAGE",
        label: "Average close to pass mark",
        detail: `${average.toFixed(1)}% average`,
        points: WEIGHTS.LOW_AVERAGE,
      });
    }

    if (attemptCount >= 3 && slope <= -1.5) {
      riskScore += WEIGHTS.DECLINING;
      reasons.push({
        code: "DECLINING",
        label: "Scores trending down",
        detail: `${slope.toFixed(1)} points per test`,
        points: WEIGHTS.DECLINING,
      });
    }

    if (assignedTests > 0 && participation < 60) {
      riskScore += WEIGHTS.LOW_PARTICIPATION;
      reasons.push({
        code: "LOW_PARTICIPATION",
        label: "Missing assigned tests",
        detail: `Attempted ${attemptCount} of ${assignedTests}`,
        points: WEIGHTS.LOW_PARTICIPATION,
      });
    }

    if (violations >= 3) {
      riskScore += WEIGHTS.VIOLATIONS;
      reasons.push({
        code: "VIOLATIONS",
        label: "Repeated proctoring flags",
        detail: `${violations} violations recorded`,
        points: WEIGHTS.VIOLATIONS,
      });
    }

    riskScore = Math.min(100, riskScore);

    return {
      studentId: student.id,
      name: student.name || "Student",
      rollNo: student.rollNo || "-",
      department: student.department || "-",
      batch: student.batch || "-",
      averageScore: Number(average.toFixed(2)),
      attempts: attemptCount,
      assignedTests,
      participation: Number(participation.toFixed(2)),
      violations,
      trendSlope: Number(slope.toFixed(3)),
      riskScore,
      riskLevel: levelFor(riskScore),
      reasons,
    };
  });

  const atRisk = assessed
    .filter((student) => student.riskScore >= minRiskScore)
    .sort((a, b) => b.riskScore - a.riskScore || a.averageScore - b.averageScore);

  return {
    students: atRisk,
    summary: {
      assessed: assessed.length,
      atRisk: atRisk.length,
      critical: atRisk.filter((student) => student.riskLevel === "CRITICAL").length,
      high: atRisk.filter((student) => student.riskLevel === "HIGH").length,
      moderate: atRisk.filter((student) => student.riskLevel === "MODERATE").length,
    },
  };
};

module.exports = {
  computeAtRisk,
  levelFor,
  WEIGHTS,
  PASS_MARK,
};
