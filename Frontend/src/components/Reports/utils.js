// The report APIs answer with `null` — not 0 — for a metric they have no data
// for, so every formatter has to tell "no data" apart from a real zero.
export const NO_DATA_LABEL = "—";

export const clampPercent = (value) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
};

/** clampPercent that keeps a missing metric (`null`) missing instead of making it 0. */
export const percentOrNull = (value) => {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
};

/**
 * Comparable stand-in for a percentage that may be missing (`null` = no data),
 * so rankings never treat "no data" as a real 0. Missing values always rank
 * last; the two comparators below pick the direction.
 */
export const percentRank = (value) => {
  if (value == null) return -Infinity;
  const number = Number(value);
  return Number.isFinite(number) ? number : -Infinity;
};

/** Best first, with metrics that have no data last. */
export const comparePercentDesc = (a, b) => {
  const av = percentRank(a);
  const bv = percentRank(b);
  return av === bv ? 0 : bv - av;
};

/** Worst first, with metrics that have no data last. */
export const comparePercentAsc = (a, b) => {
  const av = percentRank(a);
  const bv = percentRank(b);
  return av === bv ? 0 : av - bv;
};

/** Map a report/export API error to a human-readable message for the UI. */
export const toExportErrorMessage = (error) => {
  if (error?.code === "REPORT_URL_EXPIRED") {
    return "The download link expired. Your report link will be renewed — please try again.";
  }
  if (error?.code === "CROSS_DEPARTMENT_REPORT_JOB_ACCESS") {
    return "You are not allowed to access this report.";
  }
  if (error?.status === 429) {
    return "Too many export requests. Please wait a moment and try again.";
  }
  return String(error?.message || "").trim() || "Export failed. Please try again.";
};

/**
 * Categorical palette — 8 fixed slots, assigned in order, NEVER cycled.
 * Validated (dataviz six checks) in both modes against this app's surfaces.
 * Status colours are deliberately absent: they are reserved for state.
 */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

export const CATEGORICAL_SLOT_LIMIT = CHART_COLORS.length;

/** Ordinal ramp for ordered bins (score bands, tiers): one hue, light -> dark. */
export const ORDINAL_COLORS = [
  "var(--ordinal-1)",
  "var(--ordinal-2)",
  "var(--ordinal-3)",
  "var(--ordinal-4)",
  "var(--ordinal-5)",
];

/** Diverging pair (polarity vs a baseline) + neutral midpoint. */
export const DIVERGING = {
  negative: "var(--diverging-neg)",
  mid: "var(--diverging-mid)",
  positive: "var(--diverging-pos)",
};

/** Reserved status scale. Always paired with an icon + label, never colour alone. */
export const STATUS_COLORS = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
};

export const DE_EMPHASIS = "var(--chart-axis)";

/**
 * Stable categorical colour for an entity.
 *
 * Colour must follow the ENTITY, not its current row index — otherwise filtering
 * a series out repaints the survivors and a reader who learned "CSE is blue" is
 * misled. Pass the ordered list of entity ids once; every lookup then resolves to
 * the same slot regardless of what is currently visible.
 *
 * Beyond 8 entities we do NOT generate or cycle hues (a 9th hue is
 * indistinguishable under CVD). The tail collapses to the de-emphasis grey and
 * callers should fold it into an explicit "Other" bucket or facet instead.
 */
export const createSeriesColorScale = (entityIds = []) => {
  const order = new Map();
  entityIds.filter((id) => id != null).forEach((id) => {
    const key = String(id);
    if (!order.has(key)) order.set(key, order.size);
  });

  return (entityId) => {
    const slot = order.get(String(entityId));
    if (slot == null || slot >= CATEGORICAL_SLOT_LIMIT) return DE_EMPHASIS;
    return CHART_COLORS[slot];
  };
};

/** Ordinal bin colour by position in the ordered sequence. */
export const ordinalColor = (index, total = ORDINAL_COLORS.length) => {
  if (total <= 1) return ORDINAL_COLORS[ORDINAL_COLORS.length - 1];
  const ratio = Math.max(0, Math.min(1, index / (total - 1)));
  const step = Math.round(ratio * (ORDINAL_COLORS.length - 1));
  return ORDINAL_COLORS[step];
};

/** Status token for a pass/fail style score. Returns a role, not a raw hue. */
export const scoreStatusRole = (score) => {
  const value = clampPercent(score);
  if (value >= 75) return "good";
  if (value >= 50) return "warning";
  if (value >= 40) return "serious";
  return "critical";
};

export const formatPercent = (value) => {
  if (value == null) return NO_DATA_LABEL;
  const number = clampPercent(value);
  return `${number.toFixed(1)}%`;
};

export const formatDateLabel = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || "-");
  return date.toLocaleDateString();
};

// `options.keepAll` names params whose "all" value is a real choice rather than
// "unset" (e.g. academicStatus=all), so they survive serialisation.
export const toQueryString = (params = {}, options = {}) => {
  const keepAll = Array.isArray(options.keepAll) ? options.keepAll : [];
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    if (value === "all" && !keepAll.includes(key)) return;
    query.set(key, String(value));
  });
  const value = query.toString();
  return value ? `?${value}` : "";
};
