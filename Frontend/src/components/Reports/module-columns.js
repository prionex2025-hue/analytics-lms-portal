// MODULE_TEST helpers shared by the admin-level report pages.

const MODULE_SHORT_LABEL = { QUANT: "Quant", REASONING: "Reasoning", VERBAL: "Verbal" };
export const moduleShortLabel = (key) => MODULE_SHORT_LABEL[key] || key;

const toNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

// Module columns come from the analytics payload's server module definitions
// (test-type driven and pagination-independent), falling back to the first
// result row's moduleScores for legacy responses.
export const moduleColumnDefs = (rows, modulePerformance = {}) =>
  Array.isArray(modulePerformance?.modules) && modulePerformance.modules.length
    ? modulePerformance.modules
    : Array.isArray(rows) && rows[0]?.moduleScores?.length
      ? rows[0].moduleScores
      : [];

const moduleScoreFor = (row, mod) =>
  (Array.isArray(row?.moduleScores) ? row.moduleScores : []).find((item) => item.key === mod.key) || null;

/** Raw marks a student scored in one module, e.g. "18/25". Null when absent. */
export const moduleMarksFor = (row, mod) => {
  const score = moduleScoreFor(row, mod);
  if (!score) return null;
  return `${toNumber(score.score)}/${toNumber(score.maxScore)}`;
};

/** Overall marks across all modules (sum of per-module score / maxScore). */
export const overallModuleMarks = (row) => {
  const scores = Array.isArray(row?.moduleScores) ? row.moduleScores : [];
  if (scores.length === 0) return null;
  const obtained = scores.reduce((sum, item) => sum + toNumber(item.score), 0);
  const max = scores.reduce((sum, item) => sum + toNumber(item.maxScore), 0);
  return { obtained: Math.round(obtained * 100) / 100, max: Math.round(max * 100) / 100 };
};
