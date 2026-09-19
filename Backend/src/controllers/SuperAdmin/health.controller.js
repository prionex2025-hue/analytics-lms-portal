const env = require("../../config/env");
const { getRedisHealthSnapshot } = require("../../config/redis");
const { getIO } = require("../../realtime/socket");
const { getApiMetricsSnapshot } = require("../../services/api-metrics.service");
const { getOperationalHealthSnapshot } = require("../../services/operational-health.service");
const { getRateLimitMetricsSnapshot } = require("../../services/rate-limit-metrics.service");
const { getDb } = require("../../utils/db");
const { asyncHandler } = require("../../utils/http");

const getMongoHealth = async () => {
  const start = Date.now();
  try {
    const db = await getDb();
    await db.college.count();
    const latency = Date.now() - start;
    return {
      status: latency > 1000 ? "degraded" : "ok",
      avg_response_ms: latency,
    };
  } catch (_error) {
    return {
      status: "down",
      avg_response_ms: -1,
    };
  }
};

const getRedisHealth = async () => {
  const redis = await getRedisHealthSnapshot();
  return {
    status: redis.status,
    hit_rate: redis.available ? 0.9 : 0,
    latency_ms: redis.latencyMs,
    configured: redis.configured,
    error: redis.error,
  };
};

const getJobQueueHealth = async () => {
  const db = await getDb();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [reportPending, superReportPending, reportFailed, superReportFailed, oldestReport, oldestSuperReport] = await Promise.all([
    db.reportJob.count({ where: { status: { in: ["QUEUED", "PROCESSING"] } } }),
    db.superReportJob.count({ where: { status: { in: ["QUEUED", "PROCESSING"] } } }),
    db.reportJob.count({ where: { status: "FAILED", updatedAt: { gte: oneHourAgo } } }),
    db.superReportJob.count({ where: { status: "FAILED", updatedAt: { gte: oneHourAgo } } }),
    db.reportJob.findFirst({ where: { status: { in: ["QUEUED", "PROCESSING"] } }, orderBy: { createdAt: "asc" } }),
    db.superReportJob.findFirst({ where: { status: { in: ["QUEUED", "PROCESSING"] } }, orderBy: { createdAt: "asc" } }),
  ]);

  const nowMs = Date.now();
  const oldestCandidates = [oldestReport?.createdAt, oldestSuperReport?.createdAt]
    .filter(Boolean)
    .map((date) => new Date(date).getTime());
  const oldestPendingAgeMs = oldestCandidates.length > 0 ? nowMs - Math.min(...oldestCandidates) : 0;

  const pending = reportPending + superReportPending;
  const failedLastHour = reportFailed + superReportFailed;

  return {
    status: failedLastHour > 0 || oldestPendingAgeMs > 5 * 60 * 1000 ? "degraded" : "ok",
    pending,
    failed_last_hour: failedLastHour,
    oldest_pending_age_ms: oldestPendingAgeMs,
  };
};

const getSystemHealth = asyncHandler(async (_req, res) => {
  const [mongodb, redis, job_queue, operational] = await Promise.all([
    getMongoHealth(),
    getRedisHealth(),
    getJobQueueHealth(),
    getOperationalHealthSnapshot(),
  ]);

  const io = getIO();
  const apiSnapshot = await getApiMetricsSnapshot();

  res.status(200).json({
    mongodb,
    redis,
    job_queue,
    socket_server: {
      connected_clients: io?.engine?.clientsCount || 0,
    },
    storage: operational.application_disk,
    uploads: operational.uploads,
    backups: operational.backups,
    api: {
      avg_response_ms: apiSnapshot.avgResponseMs,
      error_rate_percent: apiSnapshot.errorRatePercent,
      requests_per_minute: apiSnapshot.requestsPerMinute,
    },
    checked_at: new Date().toISOString(),
  });
});

const getRateLimitMetrics = asyncHandler(async (req, res) => {
  const top = Number(req.query?.top || req.query?.limit || 0);
  const fallbackTop = env.rateLimit.metricsTopNDefault;
  const safeTop = Number.isFinite(top) && top > 0 ? Math.min(Math.floor(top), 100) : fallbackTop;

  const snapshot = await getRateLimitMetricsSnapshot({ limit: safeTop });

  res.status(200).json({
    ...snapshot,
    topN: safeTop,
  });
});

module.exports = {
  getSystemHealth,
  getRateLimitMetrics,
};
