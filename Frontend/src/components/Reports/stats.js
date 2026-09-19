import { clampPercent } from "@/components/Reports/utils";

// Single source of truth for score thresholds, shared by every report panel.
// Mirrors Backend/src/utils/stats.js.
export const PASS_THRESHOLD = 40;
export const HEALTHY_THRESHOLD = 50;
export const DISTINCTION_THRESHOLD = 75;

// "high" | "mid" | "low" — pages map this to their own label wording while
// sharing one set of thresholds and colour tones.
export const scoreTier = (score) => {
  const value = clampPercent(score);
  if (value >= DISTINCTION_THRESHOLD) return "high";
  if (value >= HEALTHY_THRESHOLD) return "mid";
  return "low";
};

const TIER_COLOR_CLASS = { high: "text-green-500", mid: "text-yellow-500", low: "text-red-500" };
const TIER_TONE = { high: "success", mid: "info", low: "warning" };

export const scoreColorClass = (score) => TIER_COLOR_CLASS[scoreTier(score)];
export const scoreTone = (score) => TIER_TONE[scoreTier(score)];

// Health badge used by department / batch registry rows.
export const healthBadge = (score) => {
  const tier = scoreTier(score);
  if (tier === "high") return { label: "Healthy", variant: "success" };
  if (tier === "mid") return { label: "Average", variant: "warning" };
  return { label: "Needs Review", variant: "danger" };
};

// ---------------------------------------------------------------- client stats
const toSortedNumbers = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

const round2 = (value) => Number((Number.isFinite(Number(value)) ? Number(value) : 0).toFixed(2));

export const quantileSorted = (sorted, q) => {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
};

export const mean = (values) => {
  const nums = toSortedNumbers(values);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
};

export const median = (values) => quantileSorted(toSortedNumbers(values), 0.5);

export const stdDev = (values) => {
  const nums = toSortedNumbers(values);
  if (nums.length < 2) return 0;
  const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  return Math.sqrt(nums.reduce((sum, value) => sum + (value - avg) ** 2, 0) / nums.length);
};

// Five-number summary for the distribution box-plot. Accepts either a raw
// number array or a precomputed stats object from the API (pass-through).
export const describeDistribution = (values) => {
  if (values && !Array.isArray(values) && typeof values === "object") return values;
  const nums = toSortedNumbers(values);
  if (!nums.length) {
    return { count: 0, mean: 0, median: 0, q1: 0, q3: 0, iqr: 0, stdDev: 0, min: 0, max: 0 };
  }
  const q1 = quantileSorted(nums, 0.25);
  const q3 = quantileSorted(nums, 0.75);
  return {
    count: nums.length,
    mean: round2(mean(nums)),
    median: round2(median(nums)),
    q1: round2(q1),
    q3: round2(q3),
    iqr: round2(q3 - q1),
    stdDev: round2(stdDev(nums)),
    min: round2(nums[0]),
    max: round2(nums[nums.length - 1]),
  };
};

