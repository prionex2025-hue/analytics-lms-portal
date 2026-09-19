const { redisClient, isRedisAvailable } = require("../config/redis");

const MAX_ENTRIES = 5000;
const ROLLING_WINDOW_MS = 5 * 60 * 1000;
const API_METRICS_KEY = "api_metrics:rolling";

const memoryMetrics = [];

const pruneMemory = () => {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  while (memoryMetrics.length > 0 && (memoryMetrics[0].ts < cutoff || memoryMetrics.length > MAX_ENTRIES)) {
    memoryMetrics.shift();
  }
};

const serializeMetric = ({ ts, durationMs, statusCode }) => JSON.stringify({
  ts,
  durationMs: Number(durationMs) || 0,
  statusCode: Number(statusCode) || 0,
});

const recordApiMetric = ({ durationMs, statusCode }) => {
  const metric = {
    ts: Date.now(),
    durationMs: Number(durationMs) || 0,
    statusCode: Number(statusCode) || 0,
  };

  if (isRedisAvailable()) {
    const cutoff = metric.ts - ROLLING_WINDOW_MS;
    redisClient
      .pipeline()
      .zadd(API_METRICS_KEY, metric.ts, serializeMetric(metric))
      .zremrangebyscore(API_METRICS_KEY, 0, cutoff)
      .zremrangebyrank(API_METRICS_KEY, 0, -MAX_ENTRIES - 1)
      .expire(API_METRICS_KEY, Math.ceil(ROLLING_WINDOW_MS / 1000) * 2)
      .exec()
      .catch(() => {
        memoryMetrics.push(metric);
        pruneMemory();
      });
    return;
  }

  memoryMetrics.push(metric);
  pruneMemory();
};

const parseMetric = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    return {
      ts: Number(parsed.ts) || 0,
      durationMs: Number(parsed.durationMs) || 0,
      statusCode: Number(parsed.statusCode) || 0,
    };
  } catch {
    return null;
  }
};

const readRedisMetrics = async (since) => {
  if (!isRedisAvailable()) return null;

  try {
    const items = await redisClient.zrangebyscore(API_METRICS_KEY, since, "+inf");
    return items.map(parseMetric).filter(Boolean);
  } catch {
    return null;
  }
};

const summarize = (metrics) => {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;

  const recentMinute = metrics.filter((item) => item.ts >= oneMinuteAgo);
  const avgResponseMs = metrics.length > 0
    ? metrics.reduce((sum, item) => sum + item.durationMs, 0) / metrics.length
    : 0;
  const errors = metrics.filter((item) => item.statusCode >= 500).length;
  const errorRatePercent = metrics.length > 0 ? (errors / metrics.length) * 100 : 0;

  return {
    avgResponseMs: Number(avgResponseMs.toFixed(2)),
    errorRatePercent: Number(errorRatePercent.toFixed(2)),
    requestsPerMinute: recentMinute.length,
  };
};

const getApiMetricsSnapshot = async () => {
  const since = Date.now() - ROLLING_WINDOW_MS;
  const redisMetrics = await readRedisMetrics(since);
  if (redisMetrics) {
    return summarize(redisMetrics);
  }

  pruneMemory();
  return summarize(memoryMetrics.filter((item) => item.ts >= since));
};

module.exports = {
  recordApiMetric,
  getApiMetricsSnapshot,
};
