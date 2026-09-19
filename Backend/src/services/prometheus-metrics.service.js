const { getRedisHealthSnapshot } = require("../config/redis");
const { getIO } = require("../realtime/socket");
const { getApiMetricsSnapshot } = require("./api-metrics.service");
const { getOperationalHealthSnapshot } = require("./operational-health.service");
const { getRateLimitMetricsSnapshot } = require("./rate-limit-metrics.service");
const { getRumMetricsSnapshot } = require("./rum-metrics.service");
const { getDb } = require("../utils/db");

const toMetricValue = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const appendMetric = (lines, { name, help, type = "gauge", value }) => {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} ${type}`);
  lines.push(`${name} ${toMetricValue(value)}`);
};

const getMongoSnapshot = async () => {
  const startedAt = Date.now();
  try {
    const db = await getDb();
    await db.college.count();
    return {
      up: 1,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return {
      up: 0,
      latencyMs: -1,
    };
  }
};

const getPrometheusMetrics = async () => {
  const [mongodb, redis, api, rateLimits, operational, rum] = await Promise.all([
    getMongoSnapshot(),
    getRedisHealthSnapshot(),
    getApiMetricsSnapshot(),
    getRateLimitMetricsSnapshot({ limit: 1 }),
    getOperationalHealthSnapshot(),
    getRumMetricsSnapshot(),
  ]);

  const memory = process.memoryUsage();
  const io = getIO();
  const lines = [];

  appendMetric(lines, {
    name: "lms_process_uptime_seconds",
    help: "Node.js process uptime in seconds.",
    value: process.uptime(),
  });
  appendMetric(lines, {
    name: "lms_process_resident_memory_bytes",
    help: "Resident memory used by the API process.",
    value: memory.rss,
  });
  appendMetric(lines, {
    name: "lms_process_heap_used_bytes",
    help: "V8 heap used by the API process.",
    value: memory.heapUsed,
  });
  appendMetric(lines, {
    name: "lms_mongodb_up",
    help: "MongoDB health status, 1 when reachable.",
    value: mongodb.up,
  });
  appendMetric(lines, {
    name: "lms_mongodb_latency_ms",
    help: "MongoDB health check latency in milliseconds.",
    value: mongodb.latencyMs,
  });
  appendMetric(lines, {
    name: "lms_redis_configured",
    help: "Redis configured status, 1 when a Redis URL is configured.",
    value: redis.configured ? 1 : 0,
  });
  appendMetric(lines, {
    name: "lms_redis_available",
    help: "Redis availability status, 1 when ready for commands.",
    value: redis.available ? 1 : 0,
  });
  appendMetric(lines, {
    name: "lms_redis_latency_ms",
    help: "Redis ping latency in milliseconds.",
    value: redis.latencyMs,
  });
  appendMetric(lines, {
    name: "lms_socket_connected_clients",
    help: "Connected Socket.IO clients on this API process.",
    value: io?.engine?.clientsCount || 0,
  });
  appendMetric(lines, {
    name: "lms_api_requests_per_minute",
    help: "Rolling API requests per minute observed by this deployment.",
    value: api.requestsPerMinute,
  });
  appendMetric(lines, {
    name: "lms_api_avg_response_ms",
    help: "Rolling average API response time in milliseconds.",
    value: api.avgResponseMs,
  });
  appendMetric(lines, {
    name: "lms_api_error_rate_percent",
    help: "Rolling API 5xx error rate percentage.",
    value: api.errorRatePercent,
  });
  appendMetric(lines, {
    name: "lms_rate_limit_blocked_total",
    help: "Rate-limited requests recorded in the current metrics retention window.",
    type: "counter",
    value: rateLimits.totalBlocked,
  });
  appendMetric(lines, {
    name: "lms_rum_metric_count",
    help: "Real user monitoring metric samples in the rolling retention window.",
    value: rum.count,
  });
  appendMetric(lines, {
    name: "lms_rum_lcp_p75_ms",
    help: "Rolling p75 largest contentful paint in milliseconds.",
    value: rum.lcpP75Ms,
  });
  appendMetric(lines, {
    name: "lms_rum_cls_p75",
    help: "Rolling p75 cumulative layout shift.",
    value: rum.clsP75,
  });
  appendMetric(lines, {
    name: "lms_rum_fid_p75_ms",
    help: "Rolling p75 first input delay in milliseconds.",
    value: rum.fidP75Ms,
  });
  appendMetric(lines, {
    name: "lms_upload_disk_used_percent",
    help: "Upload storage disk usage percentage.",
    value: operational.uploads.disk.percent_used,
  });
  appendMetric(lines, {
    name: "lms_upload_disk_available_bytes",
    help: "Available bytes on the upload storage filesystem.",
    value: operational.uploads.disk.available_bytes,
  });
  appendMetric(lines, {
    name: "lms_upload_tmp_files",
    help: "Temporary upload files waiting for cleanup.",
    value: operational.uploads.temp.file_count,
  });
  appendMetric(lines, {
    name: "lms_upload_tmp_stale_files",
    help: "Temporary upload files older than the configured threshold.",
    value: operational.uploads.temp.stale_files,
  });
  appendMetric(lines, {
    name: "lms_upload_malware_scan_enabled",
    help: "Upload malware scanning enabled status, 1 when enabled.",
    value: operational.uploads.malware_scan.enabled ? 1 : 0,
  });
  appendMetric(lines, {
    name: "lms_upload_malware_scan_required",
    help: "Upload malware scanning required status, 1 when required.",
    value: operational.uploads.malware_scan.required ? 1 : 0,
  });
  appendMetric(lines, {
    name: "lms_backup_mongodb_present",
    help: "MongoDB backup presence, 1 when a local backup archive exists.",
    value: operational.backups.mongodb.present ? 1 : 0,
  });
  appendMetric(lines, {
    name: "lms_backup_mongodb_latest_age_seconds",
    help: "Age in seconds of the latest MongoDB backup archive.",
    value: operational.backups.mongodb.age_seconds,
  });
  appendMetric(lines, {
    name: "lms_backup_uploads_present",
    help: "Uploads backup presence, 1 when a local backup archive exists.",
    value: operational.backups.uploads.present ? 1 : 0,
  });
  appendMetric(lines, {
    name: "lms_backup_uploads_latest_age_seconds",
    help: "Age in seconds of the latest uploads backup archive.",
    value: operational.backups.uploads.age_seconds,
  });

  return `${lines.join("\n")}\n`;
};

module.exports = {
  getPrometheusMetrics,
};
