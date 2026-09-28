const { ApiError } = require("../utils/http");
const { MAX_REPORT_TESTS } = require("../constants/report-limits");

const PASS_THRESHOLD_PERCENT = 40;

// Spreadsheet export datasets shared by the admin/college-admin and super-admin
// report exports. Both portals build their rows with their own scoping, then
// render them through these column definitions, so a CSV/XLSX export has the
// same columns no matter which portal produced it.
const REPORT_EXPORT_DATASETS = {
  "at-risk": {
    prefix: "at-risk-students",
    columns: [
      { key: "name", label: "Student" },
      { key: "rollNo", label: "Roll No" },
      { key: "department", label: "Department" },
      { key: "batch", label: "Batch" },
      { key: "riskLevel", label: "Risk level" },
      { key: "riskScore", label: "Risk score" },
      { key: "averageScore", label: "Average %" },
      { key: "attempts", label: "Attempts" },
      { key: "assignedTests", label: "Assigned tests" },
      { key: "participation", label: "Participation %" },
      { key: "violations", label: "Violations" },
      { key: "reasons", label: "Reasons", format: (_value, row) => (row.reasons || []).map((reason) => reason.label).join("; ") },
    ],
  },
  tests: {
    prefix: "test-performance",
    columns: [
      { key: "title", label: "Test" },
      { key: "status", label: "Status" },
      { key: "department", label: "Department" },
      { key: "batch", label: "Batch" },
      { key: "submissionCount", label: "Submissions" },
      { key: "attemptedStudents", label: "Students attempted" },
      { key: "avgScore", label: "Avg %" },
      { key: "passRate", label: "Pass rate %" },
      { key: "participation", label: "Participation %" },
      { key: "violations", label: "Violations" },
    ],
  },
  // Selected tests only: one row per student per test (best attempt).
  results: {
    prefix: "test-results",
    columns: [
      { key: "test", label: "Test" },
      { key: "name", label: "Student" },
      { key: "rollNo", label: "Roll No" },
      { key: "department", label: "Department" },
      { key: "batch", label: "Batch" },
      { key: "scorePercent", label: "Score %" },
      { key: "marks", label: "Marks" },
      { key: "result", label: "Result" },
      { key: "violations", label: "Violations" },
      { key: "submittedAt", label: "Submitted", format: (value) => (value ? new Date(value).toISOString().slice(0, 10) : "") },
    ],
  },
  "item-analysis": {
    prefix: "item-analysis",
    columns: [
      { key: "order", label: "Q" },
      { key: "prompt", label: "Prompt" },
      { key: "attempts", label: "Attempts" },
      { key: "correct", label: "Correct" },
      { key: "difficulty", label: "Difficulty", format: (value) => Number(value || 0).toFixed(4) },
      { key: "difficultyLabel", label: "Difficulty band" },
      { key: "discrimination", label: "Discrimination", format: (value) => Number(value || 0).toFixed(4) },
      { key: "discriminationLabel", label: "Discrimination band" },
      { key: "medianTimeSeconds", label: "Median time (s)" },
      { key: "markedForReviewRate", label: "Marked for review %" },
      { key: "topDistractor", label: "Top distractor" },
      { key: "flagReasons", label: "Flags", format: (value) => (value || []).join("; ") },
    ],
  },
};

const resolveExportDatasetConfig = (rawDataset) => {
  const dataset = String(rawDataset || "").trim();
  const config = REPORT_EXPORT_DATASETS[dataset];
  if (!config) {
    throw new ApiError(422, `Unsupported export dataset: ${dataset || "(none)"}`, { supported: Object.keys(REPORT_EXPORT_DATASETS) }, "UNSUPPORTED_DATASET");
  }
  return { dataset, config };
};

const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

// Shapes scoped students + attempts into the input computeAtRisk expects. The
// admin and super loaders return the same { scope, students, attempts } shape.
const buildAtRiskStudentInput = ({ scope, students = [], attempts = [] }) => {
  const attemptsByStudent = new Map();
  for (const attempt of attempts) {
    const key = String(attempt.userId);
    if (!attemptsByStudent.has(key)) attemptsByStudent.set(key, []);
    attemptsByStudent.get(key).push(attempt);
  }

  return students.map((student) => {
    const studentAttempts = attemptsByStudent.get(String(student.id)) || [];
    return {
      id: student.id,
      name: student.fullName || "Student",
      rollNo: getStudentNumber(student),
      department: student.department?.name || "-",
      batch: student.batch?.name || "-",
      assignedTests: scope?.testIds?.length || 0,
      violations: studentAttempts.reduce((sum, attempt) => sum + attempt.violations, 0),
      attempts: studentAttempts.map((attempt) => ({ scorePercent: attempt.scorePercent, date: attempt.date })),
    };
  });
};

/** Parses the comma-separated testIds query param of the "results" export. */
const parseExportTestIds = (raw) => {
  const ids = [...new Set(String(raw || "").split(",").map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new ApiError(400, "Select at least one test to export results", null, "TEST_IDS_REQUIRED");
  }
  if (ids.length > MAX_REPORT_TESTS) {
    throw new ApiError(422, `Select at most ${MAX_REPORT_TESTS} tests`, null, "TOO_MANY_TESTS");
  }
  return ids;
};

/**
 * Rows for the "results" export from the scoped loaders' { scope, students,
 * attempts } shape: the best attempt per student per test, ordered by test then
 * score (highest first).
 */
const buildTestResultRows = ({ scope, students = [], attempts = [] }) => {
  const testById = new Map((scope?.tests || []).map((test) => [String(test.id), test]));
  const studentById = new Map(students.map((student) => [String(student.id), student]));
  const best = new Map();
  for (const attempt of attempts) {
    const key = `${attempt.userId}:${attempt.testId}`;
    const current = best.get(key);
    if (!current || attempt.scorePercent > current.scorePercent) best.set(key, attempt);
  }

  const testOrder = [...testById.keys()];
  return [...best.values()]
    .map((attempt) => {
      const test = testById.get(String(attempt.testId)) || {};
      const student = studentById.get(String(attempt.userId)) || {};
      const scorePercent = Math.round(Number(attempt.scorePercent || 0) * 10) / 10;
      const totalMarks = Number(attempt.totalMarks || 0);
      return {
        testId: String(attempt.testId),
        test: test.title || "Untitled test",
        name: student.fullName || "Student",
        rollNo: getStudentNumber(student),
        department: student.department?.name || "-",
        batch: student.batch?.name || "-",
        scorePercent,
        marks: totalMarks > 0 ? `${Number(attempt.score || 0)}/${totalMarks}` : "",
        result: scorePercent >= PASS_THRESHOLD_PERCENT ? "PASS" : "FAIL",
        violations: attempt.violations || 0,
        submittedAt: attempt.date || null,
      };
    })
    .sort((a, b) => testOrder.indexOf(a.testId) - testOrder.indexOf(b.testId) || b.scorePercent - a.scorePercent);
};

module.exports = {
  parseExportTestIds,
  buildTestResultRows,
  REPORT_EXPORT_DATASETS,
  resolveExportDatasetConfig,
  buildAtRiskStudentInput,
};
