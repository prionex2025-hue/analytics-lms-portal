const Redis = require("ioredis");
const env = require("./env");

// Redis is disabled by default in the test environment so suites stay
// deterministic, but an explicit REDIS_ENABLED=true opt-in (e.g. the Redis
// integration job in CI) must still enable it under NODE_ENV=test.
const redisEnabled = Boolean(env.redisUrl) && (env.nodeEnv !== "test" || Boolean(env.redis?.enabled));

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
    console.error("Invalid REDIS_URL for Redis queue connection:", error?.message || "invalid url");
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
    connectionName: `lms-api:${env.nodeEnv}`,
  });

  redisClient.on("ready", () => {
    redisReady = true;
    lastRedisError = null;
    if (hasLoggedRedisDown) {
      console.log("Redis reconnected.");
    }
    hasLoggedRedisDown = false;
  });

  redisClient.on("error", (error) => {
    redisReady = false;
    lastRedisError = error?.message || "unknown redis error";
    // Avoid flooding logs when Redis is down and reconnect retries are active.
    if (!hasLoggedRedisDown) {
      console.error("Redis connection error:", lastRedisError);
      hasLoggedRedisDown = true;
    }
  });

  redisClient.on("end", () => {
    redisReady = false;
  });
}

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
    await redisClient.ping();
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
      error: error?.message || lastRedisError || "ping failed",
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
};
