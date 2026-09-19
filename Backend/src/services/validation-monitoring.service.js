/**
 * Validation Monitoring Service
 *
 * Tracks validation failures, latency, and anomalies in Redis so metrics are
 * shared across instances. A small in-memory store remains as a fail-open
 * fallback when Redis is disabled or unavailable.
 */

const models = require("../models");
const { redisClient, isRedisAvailable } = require("../config/redis");

const REDIS_PREFIX = "validation_metrics";
const STATUS_KEY = `${REDIS_PREFIX}:status`;
const FAILURE_INDEX_KEY = `${REDIS_PREFIX}:failures:index`;
const LATENCY_INDEX_KEY = `${REDIS_PREFIX}:latency:index`;
const METRIC_TTL_SECONDS = 60 * 60 * 24 * 7;

const memoryMetrics = {
  validationFailures: {},
  validationLatency: {},
  statusCounts: {
    total: 0,
    passed: 0,
    failed: 0,
  },
};

const failureKey = (key) => `${REDIS_PREFIX}:failure:${key}`;
const failureErrorsKey = (key) => `${REDIS_PREFIX}:failure:${key}:errors`;
const latencyKey = (key) => `${REDIS_PREFIX}:latency:${key}`;

const splitMetricKey = (key) => {
  const [model, ...rest] = String(key || "").split(":");
  return { model, label: rest.join(":") };
};

const updateMemoryFailure = (key, error, context = {}, timestamp = new Date()) => {
  if (!memoryMetrics.validationFailures[key]) {
    memoryMetrics.validationFailures[key] = {
      count: 0,
      firstFailure: timestamp,
      lastFailure: timestamp,
      errors: [],
    };
  }

  const item = memoryMetrics.validationFailures[key];
  item.count += 1;
  item.lastFailure = timestamp;
  if (item.errors.length < 10) {
    item.errors.push({
      timestamp,
      message: error.message,
      code: error.statusCode,
      context,
    });
  }
  memoryMetrics.statusCounts.total += 1;
  memoryMetrics.statusCounts.failed += 1;
};

const updateMemorySuccess = (key, latencyMs = 0) => {
  if (!memoryMetrics.validationLatency[key]) {
    memoryMetrics.validationLatency[key] = {
      count: 0,
      totalMs: 0,
      minMs: Infinity,
      maxMs: 0,
      avgMs: 0,
    };
  }

  const item = memoryMetrics.validationLatency[key];
  item.count += 1;
  item.totalMs += latencyMs;
  item.minMs = Math.min(item.minMs, latencyMs);
  item.maxMs = Math.max(item.maxMs, latencyMs);
  item.avgMs = item.totalMs / item.count;
  memoryMetrics.statusCounts.total += 1;
  memoryMetrics.statusCounts.passed += 1;
};

async function logValidationFailure(modelName, error, label, context = {}) {
  const m = await models.init();
  const db = m.dbClient;
  const timestamp = new Date();
  const key = `${modelName}:${label}`;

  if (isRedisAvailable()) {
    try {
      const fKey = failureKey(key);
      const eKey = failureErrorsKey(key);
      const pipeline = redisClient.pipeline();
      pipeline.sadd(FAILURE_INDEX_KEY, key);
      pipeline.hsetnx(fKey, "firstFailure", timestamp.toISOString());
      pipeline.hincrby(fKey, "count", 1);
      pipeline.hset(fKey, "lastFailure", timestamp.toISOString());
      pipeline.lpush(eKey, JSON.stringify({
        timestamp: timestamp.toISOString(),
        message: error.message,
        code: error.statusCode,
        context,
      }));
      pipeline.ltrim(eKey, 0, 9);
      pipeline.hincrby(STATUS_KEY, "total", 1);
      pipeline.hincrby(STATUS_KEY, "failed", 1);
      pipeline.expire(FAILURE_INDEX_KEY, METRIC_TTL_SECONDS);
      pipeline.expire(fKey, METRIC_TTL_SECONDS);
      pipeline.expire(eKey, METRIC_TTL_SECONDS);
      pipeline.expire(STATUS_KEY, METRIC_TTL_SECONDS);
      await pipeline.exec();
    } catch {
      updateMemoryFailure(key, error, context, timestamp);
    }
  } else {
    updateMemoryFailure(key, error, context, timestamp);
  }

  try {
    await db.auditLog.create({
      data: {
        action: "VALIDATION_FAILURE",
        entityType: modelName,
        metadata: {
          label,
          error: error.message,
          code: error.code || "VALIDATION_ERROR",
          ...context,
        },
      },
    });
  } catch (dbError) {
    console.error("Failed to log validation failure to DB:", dbError.message);
  }
}

async function logValidationSuccess(modelName, label, latencyMs = 0) {
  const key = `${modelName}:${label}`;
  const safeLatency = Math.max(0, Number(latencyMs) || 0);

  if (isRedisAvailable()) {
    try {
      const lKey = latencyKey(key);
      const previous = await redisClient.hgetall(lKey);
      const count = Number(previous.count || 0) + 1;
      const totalMs = Number(previous.totalMs || 0) + safeLatency;
      const previousMin = previous.minMs == null ? safeLatency : Number(previous.minMs);
      const minMs = Number.isFinite(previousMin) ? Math.min(previousMin, safeLatency) : safeLatency;
      const maxMs = Math.max(Number(previous.maxMs || 0), safeLatency);
      const avgMs = totalMs / count;

      await redisClient
        .pipeline()
        .sadd(LATENCY_INDEX_KEY, key)
        .hset(lKey, {
          count,
          totalMs,
          minMs,
          maxMs,
          avgMs,
        })
        .hincrby(STATUS_KEY, "total", 1)
        .hincrby(STATUS_KEY, "passed", 1)
        .expire(LATENCY_INDEX_KEY, METRIC_TTL_SECONDS)
        .expire(lKey, METRIC_TTL_SECONDS)
        .expire(STATUS_KEY, METRIC_TTL_SECONDS)
        .exec();
      return;
    } catch {
      updateMemorySuccess(key, safeLatency);
      return;
    }
  }

  updateMemorySuccess(key, safeLatency);
}

const buildSummary = (statusCounts) => {
  const total = Number(statusCounts.total || 0);
  const passed = Number(statusCounts.passed || 0);
  const failed = Number(statusCounts.failed || 0);
  const successRate = total > 0 ? ((passed / total) * 100).toFixed(2) : 0;
  return {
    total,
    passed,
    failed,
    successRate: `${successRate}%`,
  };
};

const parseErrors = (items = []) => items.map((raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}).filter(Boolean);

const getRedisMetricsSnapshot = async () => {
  const [statusCounts, failureKeys, latencyKeys] = await Promise.all([
    redisClient.hgetall(STATUS_KEY),
    redisClient.smembers(FAILURE_INDEX_KEY),
    redisClient.smembers(LATENCY_INDEX_KEY),
  ]);

  const failures = {};
  await Promise.all(failureKeys.map(async (key) => {
    const [data, errors] = await Promise.all([
      redisClient.hgetall(failureKey(key)),
      redisClient.lrange(failureErrorsKey(key), 0, 9),
    ]);
    if (Object.keys(data).length === 0) return;
    failures[key] = {
      count: Number(data.count || 0),
      firstFailure: data.firstFailure ? new Date(data.firstFailure) : null,
      lastFailure: data.lastFailure ? new Date(data.lastFailure) : null,
      errors: parseErrors(errors),
    };
  }));

  const latency = {};
  await Promise.all(latencyKeys.map(async (key) => {
    const data = await redisClient.hgetall(latencyKey(key));
    if (Object.keys(data).length === 0) return;
    latency[key] = {
      count: Number(data.count || 0),
      totalMs: Number(data.totalMs || 0),
      minMs: Number(data.minMs || 0),
      maxMs: Number(data.maxMs || 0),
      avgMs: Number(data.avgMs || 0),
    };
  }));

  return {
    summary: buildSummary(statusCounts),
    failures,
    latency,
    timestamp: new Date(),
    source: "redis",
  };
};

async function getMetricsSnapshot() {
  if (isRedisAvailable()) {
    try {
      return await getRedisMetricsSnapshot();
    } catch {
      // Fall through to memory.
    }
  }

  return {
    summary: buildSummary(memoryMetrics.statusCounts),
    failures: memoryMetrics.validationFailures,
    latency: memoryMetrics.validationLatency,
    timestamp: new Date(),
    source: "memory",
  };
}

async function getFailureRate(modelName) {
  const snapshot = await getMetricsSnapshot();
  const failureKeys = Object.keys(snapshot.failures).filter((key) => key.startsWith(`${modelName}:`));

  if (failureKeys.length === 0) {
    return { count: 0, rate: "0%", lastFailure: null };
  }

  const totalFailures = failureKeys.reduce((sum, key) => sum + Number(snapshot.failures[key].count || 0), 0);
  const latencyKeys = Object.keys(snapshot.latency).filter((key) => key.startsWith(`${modelName}:`));
  const totalAttempts = latencyKeys.reduce((sum, key) => sum + Number(snapshot.latency[key].count || 0), 0) + totalFailures;
  const rate = totalAttempts > 0 ? ((totalFailures / totalAttempts) * 100).toFixed(2) : 0;
  const lastFailure = Math.max(...failureKeys.map((key) => new Date(snapshot.failures[key].lastFailure || 0).getTime()));

  return {
    count: totalFailures,
    rate: `${rate}%`,
    lastFailure: Number.isFinite(lastFailure) && lastFailure > 0 ? new Date(lastFailure) : null,
  };
}

async function detectAnomalies() {
  const snapshot = await getMetricsSnapshot();
  const anomalies = [];

  for (const key of Object.keys(snapshot.failures)) {
    const failureData = snapshot.failures[key];
    const latencyData = snapshot.latency[key];
    if (!latencyData) continue;

    const totalAttempts = Number(failureData.count || 0) + Number(latencyData.count || 0);
    const failureRate = totalAttempts > 0 ? (Number(failureData.count || 0) / totalAttempts) * 100 : 0;
    if (failureRate > 10) {
      const { model, label } = splitMetricKey(key);
      anomalies.push({
        model,
        label,
        failureRate: `${failureRate.toFixed(2)}%`,
        severity: failureRate > 25 ? "HIGH" : "MEDIUM",
      });
    }
  }

  for (const key of Object.keys(snapshot.latency)) {
    const latencyData = snapshot.latency[key];
    if (Number(latencyData.avgMs || 0) > 50) {
      const { model, label } = splitMetricKey(key);
      anomalies.push({
        model,
        label,
        avgLatency: `${Number(latencyData.avgMs || 0).toFixed(2)}ms`,
        severity: Number(latencyData.avgMs || 0) > 100 ? "HIGH" : "MEDIUM",
      });
    }
  }

  return anomalies;
}

async function resetMetrics() {
  memoryMetrics.validationFailures = {};
  memoryMetrics.validationLatency = {};
  memoryMetrics.statusCounts = {
    total: 0,
    passed: 0,
    failed: 0,
  };

  if (!isRedisAvailable()) return;

  try {
    const [failureKeys, latencyKeys] = await Promise.all([
      redisClient.smembers(FAILURE_INDEX_KEY),
      redisClient.smembers(LATENCY_INDEX_KEY),
    ]);
    const keys = [
      STATUS_KEY,
      FAILURE_INDEX_KEY,
      LATENCY_INDEX_KEY,
      ...failureKeys.flatMap((key) => [failureKey(key), failureErrorsKey(key)]),
      ...latencyKeys.map((key) => latencyKey(key)),
    ];
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } catch {
    // Best-effort reset.
  }
}

async function exportMetrics() {
  const snapshot = await getMetricsSnapshot();
  const anomalies = await detectAnomalies();

  return [
    `validation_total ${snapshot.summary.total}`,
    `validation_passed ${snapshot.summary.passed}`,
    `validation_failed ${snapshot.summary.failed}`,
    `validation_success_rate ${parseFloat(snapshot.summary.successRate) || 0}`,
    `validation_anomalies ${anomalies.length}`,
  ].join("\n");
}

module.exports = {
  logValidationFailure,
  logValidationSuccess,
  getMetricsSnapshot,
  getFailureRate,
  detectAnomalies,
  resetMetrics,
  exportMetrics,
};
