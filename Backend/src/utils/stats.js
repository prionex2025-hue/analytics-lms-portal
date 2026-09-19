const { toFiniteNumber } = require("./score");

// Centralised score thresholds so the API and UI agree on what "pass" /
// "healthy" / "distinction" mean. Mirrors Frontend/src/components/Reports/stats.js.
const PASS_THRESHOLD_PERCENT = 40;
const HEALTHY_THRESHOLD_PERCENT = 50;
const DISTINCTION_THRESHOLD_PERCENT = 75;

const toSortedNumbers = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => toFiniteNumber(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

const round2 = (value) => Number(toFiniteNumber(value).toFixed(2));

const mean = (values) => {
  const nums = toSortedNumbers(values);
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
};

// Linear-interpolation quantile over an already-sorted array (0 <= q <= 1).
const quantileSorted = (sorted, q) => {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
};

const median = (values) => quantileSorted(toSortedNumbers(values), 0.5);

// Population standard deviation (matches Mongo's $stdDevPop).
const stdDev = (values) => {
  const nums = toSortedNumbers(values);
  if (nums.length < 2) return 0;
  const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  const variance = nums.reduce((sum, value) => sum + (value - avg) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
};

// Five-number summary + mean/std-dev used by the distribution box-plot.
const describeDistribution = (values) => {
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

module.exports = {
  PASS_THRESHOLD_PERCENT,
  HEALTHY_THRESHOLD_PERCENT,
  DISTINCTION_THRESHOLD_PERCENT,
  mean,
  median,
  quantileSorted,
  stdDev,
  describeDistribution,
  round2,
};
