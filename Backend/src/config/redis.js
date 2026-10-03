const Redis = require("ioredis");
const env = require("./env");
const { logger } = require("../utils/logger");

// Redis is disabled by default in the test environment so suites stay
// deterministic, but an explicit REDIS_ENABLED=true opt-in (e.g. the Redis
// integration job in CI) must still enable it under NODE_ENV=test.
// REDIS_ENABLED=false disables it everywhere, even with REDIS_URL set.
const redisEnabled =
  Boolean(env.redisUrl) &&
  !env.redis?.explicitlyDisabled &&
  (env.nodeEnv !== "test" || Boolean(env.redis?.enabled));

// host:port/db only - never log credentials embedded in REDIS_URL.
const describeRedisTarget = (redisUrl = env.redisUrl) => {
  try {
    const parsed = new URL(redisUrl);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || 6379}${parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : ""}`;
  } catch {
    return "invalid-url";
  }
};

const createRetryStrategy = (maxDelayMs = 2000) => (attempt) => {
  const nextDelay = Math.min(attempt * 100, maxDelayMs);
  return nextDelay;
};

const baseRedisOptions = {
  lazyConnect: false,
  enableReadyCheck: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: env.redis.connectTimeoutMs,
  keepAlive: env.redis.keepAliveMs,
  retryStrategy: createRetryStrategy(env.redis.maxRetryDelayMs),
};

const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const buildRedisUrlOptions = (redisUrl = env.redisUrl) => {
  try {
    const parsed = new URL(redisUrl);
    const dbPath = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.slice(1) : "";
    const db = dbPath ? Number(dbPath) : undefined;
    const options = {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
    };

    if (parsed.username) {
      options.username = safeDecode(parsed.username);
    }
    if (parsed.password) {
      options.password = safeDecode(parsed.password);
    }
    if (Number.isInteger(db) && db >= 0) {
      options.db = db;
    }
    if (parsed.protocol === "rediss:") {
      options.tls = {};
    }

    return options;
  } catch (error) {
    logger.error("redis.invalid_url", { reason: error?.message || "invalid url" });
    return null;
  }
};

let redisClient = null;
let redisReady = false;
let lastRedisError = null;
let hasLoggedRedisDown = false;

if (redisEnabled) {
  redisClient = new Redis(env.redisUrl, {
    ...baseRedisOptions,
    // Only on the shared request-path client; BullMQ connections use blocking
    // commands and must not time out.
    commandTimeout: env.redis.commandTimeoutMs,
    connectionName: `lms-api:${env.nodeEnv}`,
  });

  redisClient.on("ready", () => {
    redisReady = true;
    lastRedisError = null;
    if (hasLoggedRedisDown) {
      logger.info("redis.reconnected", { target: describeRedisTarget() });
    }
    hasLoggedRedisDown = false;
  });

  redisClient.on("error", (error) => {
    redisReady = false;
    lastRedisError = error?.name || "RedisConnectionError";
    // Avoid flooding logs when Redis is down and reconnect retries are active.
    if (!hasLoggedRedisDown) {
      logger.error("redis.connection_error", {
        target: describeRedisTarget(),
        reason: lastRedisError,
        impact: "rate-limited requests and access-token revocation fail closed; response cache is bypassed; exam locks rely on DB guards",
      });
      hasLoggedRedisDown = true;
    }
  });

  redisClient.on("end", () => {
    redisReady = false;
  });
} else if (env.nodeEnv === "production") {
  logger.warn("redis.not_configured", {
    impact: "production readiness and rate-limited requests fail closed until Redis is configured",
  });
}

const HEALTH_PING_TIMEOUT_MS = 1_500;

const withTimeout = (promise, ms) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("redis ping timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const isRedisAvailable = () => Boolean(redisClient) && redisReady;

const getRedisHealthSnapshot = async () => {
  if (!redisClient) {
    return {
      configured: false,
      available: false,
      status: "disabled",
      latencyMs: -1,
      error: null,
    };
  }

  const start = Date.now();
  try {
    await withTimeout(redisClient.ping(), HEALTH_PING_TIMEOUT_MS);
    const latencyMs = Date.now() - start;
    return {
      configured: true,
      available: isRedisAvailable(),
      status: latencyMs > 200 ? "degraded" : "ok",
      latencyMs,
      error: lastRedisError,
    };
  } catch (error) {
    return {
      configured: true,
      available: false,
      status: "down",
      latencyMs: -1,
      error: error?.name || lastRedisError || "RedisPingFailed",
    };
  }
};

const shutdownRedis = async () => {
  if (!redisClient) {
    return;
  }

  try {
    await redisClient.quit();
  } catch {
    redisClient.disconnect();
  }
};

const getRedisQueueConnection = () => {
  if (!redisEnabled || !env.redis.queueEnabled) {
    return null;
  }

  const urlOptions = buildRedisUrlOptions();
  if (!urlOptions) {
    return null;
  }

  return {
    ...urlOptions,
    ...baseRedisOptions,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    connectionName: `lms-queue:${env.nodeEnv}`,
  };
};

module.exports = {
  redisClient,
  isRedisAvailable,
  getRedisHealthSnapshot,
  shutdownRedis,
  getRedisQueueConnection,
  buildRedisUrlOptions,
  describeRedisTarget,
};
