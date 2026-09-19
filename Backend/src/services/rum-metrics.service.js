const { redisClient, isRedisAvailable } = require("../config/redis");

const MAX_ENTRIES = 3000;
const ROLLING_WINDOW_MS = 15 * 60 * 1000;
const RUM_METRICS_KEY = "rum_metrics:rolling";
const memoryMetrics = [];
const redisIsAvailable = () => typeof isRedisAvailable === "function" && isRedisAvailable();

const safeString = (value, max = 120) => String(value || "").slice(0, max);

const sanitizeMetric = (metric = {}) => ({
  ts: Date.now(),
  name: safeString(metric.name, 32),
  value: Math.max(0, Number(metric.value) || 0),
  path: safeString(metric.path, 120),
  role: safeString(metric.role || "unknown", 32),
});

const pruneMemory = () => {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  while (memoryMetrics.length > 0 && (memoryMetrics[0].ts < cutoff || memoryMetrics.length > MAX_ENTRIES)) {
    memoryMetrics.shift();
  }
};

const recordRumMetric = (metric) => {
  const safeMetric = sanitizeMetric(metric);

  if (!safeMetric.name || !safeMetric.path) {
    return;
  }

  if (redisIsAvailable()) {
    const cutoff = safeMetric.ts - ROLLING_WINDOW_MS;
    redisClient
      .pipeline()
      .zadd(RUM_METRICS_KEY, safeMetric.ts, JSON.stringify(safeMetric))
      .zremrangebyscore(RUM_METRICS_KEY, 0, cutoff)
      .zremrangebyrank(RUM_METRICS_KEY, 0, -MAX_ENTRIES - 1)
      .expire(RUM_METRICS_KEY, Math.ceil(ROLLING_WINDOW_MS / 1000) * 2)
      .exec()
      .catch(() => {
        memoryMetrics.push(safeMetric);
        pruneMemory();
      });
    return;
  }

  memoryMetrics.push(safeMetric);
  pruneMemory();
};

const parseMetric = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    return {
      ts: Number(parsed.ts) || 0,
      name: safeString(parsed.name, 32),
      value: Math.max(0, Number(parsed.value) || 0),
      path: safeString(parsed.path, 120),
      role: safeString(parsed.role || "unknown", 32),
    };
  } catch {
    return null;
  }
};

const percentile = (values, percent) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(4));
};

const readMetrics = async () => {
  const since = Date.now() - ROLLING_WINDOW_MS;
  if (redisIsAvailable()) {
    const rows = await redisClient.zrangebyscore(RUM_METRICS_KEY, since, "+inf").catch(() => null);
    if (rows) {
      return rows.map(parseMetric).filter(Boolean);
    }
  }

  pruneMemory();
  return memoryMetrics.filter((item) => item.ts >= since);
};

const getRumMetricsSnapshot = async () => {
  const metrics = await readMetrics();
  const valuesFor = (name) => metrics.filter((item) => item.name === name).map((item) => item.value);

  return {
    count: metrics.length,
    lcpP75Ms: percentile(valuesFor("LCP"), 75),
    clsP75: percentile(valuesFor("CLS"), 75),
    fidP75Ms: percentile(valuesFor("FID"), 75),
  };
};

module.exports = {
  getRumMetricsSnapshot,
  recordRumMetric,
};
