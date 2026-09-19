const { redisClient, isRedisAvailable } = require("../config/redis");

/**
 * Heartbeat Write Buffer
 *
 * Problem: During exams, each of 1000 students sends heartbeats every 5 seconds.
 * That's 12,000 DB writes/minute just for heartbeats - most of which are throwaway
 * timestamp updates.
 *
 * Solution: Buffer heartbeats in a Redis hash keyed by testId.
 * A periodic flush (every 30s) batches all buffered heartbeats into a single
 * updateMany call per test, reducing DB writes by ~85%.
 *
 * Fallback: If Redis is unavailable, heartbeats write directly to DB (existing behavior).
 */

const BUFFER_TTL_SECONDS = 120;
const FLUSH_INTERVAL_MS = 30_000;
const BUFFER_TESTS_KEY = "hb:buffer:tests";

let flushTimer = null;
let flushCallback = null;

const buildBufferKey = (testId) => `hb:buffer:${testId}`;

/**
 * Buffer a heartbeat in Redis instead of writing to DB immediately.
 * Returns true if buffered, false if caller should write directly.
 */
const bufferHeartbeat = async ({ userId, testId, submissionId }) => {
  if (!isRedisAvailable() || !userId || !testId) {
    return false;
  }

  try {
    const key = buildBufferKey(testId);
    const value = JSON.stringify({
      userId,
      submissionId,
      at: Date.now(),
    });

    await redisClient
      .pipeline()
      .hset(key, userId, value)
      .expire(key, BUFFER_TTL_SECONDS)
      .sadd(BUFFER_TESTS_KEY, testId)
      .expire(BUFFER_TESTS_KEY, BUFFER_TTL_SECONDS)
      .exec();
    return true;
  } catch {
    return false;
  }
};

/**
 * Drain all buffered heartbeats for a given test.
 * Returns an array of { userId, submissionId, at } entries.
 */
const drainTestHeartbeats = async (testId) => {
  if (!isRedisAvailable()) return [];

  const key = buildBufferKey(testId);
  try {
    const raw = await redisClient.hgetall(key);
    if (!raw || Object.keys(raw).length === 0) {
      await redisClient.srem(BUFFER_TESTS_KEY, testId).catch(() => {});
      return [];
    }

    await redisClient.pipeline().del(key).srem(BUFFER_TESTS_KEY, testId).exec();

    return Object.values(raw).map((value) => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
};

/**
 * Get all test IDs that have buffered heartbeats.
 * Uses incremental SSCAN instead of KEYS/SMEMBERS so the flush loop does not
 * block Redis if many tests are active at the same time.
 */
const getBufferedTestIds = async () => {
  if (!isRedisAvailable()) return [];

  try {
    const ids = [];
    let cursor = "0";

    do {
      const [nextCursor, batch] = await redisClient.sscan(BUFFER_TESTS_KEY, cursor, "COUNT", 100);
      cursor = String(nextCursor || "0");
      if (Array.isArray(batch)) {
        ids.push(...batch.filter(Boolean));
      }
    } while (cursor !== "0");

    return [...new Set(ids)];
  } catch {
    return [];
  }
};

/**
 * Start the periodic flush loop.
 * @param {Function} onFlush - Async callback receiving an array of { testId, entries }
 */
const startHeartbeatFlush = (onFlush) => {
  if (flushTimer) return;
  flushCallback = onFlush;

  flushTimer = setInterval(async () => {
    if (!flushCallback) return;

    try {
      const testIds = await getBufferedTestIds();
      if (testIds.length === 0) return;

      const batches = [];
      for (const testId of testIds) {
        const entries = await drainTestHeartbeats(testId);
        if (entries.length > 0) {
          batches.push({ testId, entries });
        }
      }

      if (batches.length > 0) {
        await flushCallback(batches);
      }
    } catch (error) {
      console.error("Heartbeat flush error:", error?.message || error);
    }
  }, FLUSH_INTERVAL_MS);

  flushTimer.unref();
};

const stopHeartbeatFlush = () => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushCallback = null;
};

module.exports = {
  bufferHeartbeat,
  drainTestHeartbeats,
  getBufferedTestIds,
  startHeartbeatFlush,
  stopHeartbeatFlush,
};
