const crypto = require("crypto");
const { redisClient, isRedisAvailable } = require("../config/redis");

const EVENT_FEED_TTL_SECONDS = 30;
const EVENT_FEED_PREFIX = "event_feed";
const EVENT_SEATS_PREFIX = "event_seats";

const hash = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

const buildEventFeedKey = (scope, parts = {}) => {
  const normalized = JSON.stringify(parts, Object.keys(parts).sort());
  return `${EVENT_FEED_PREFIX}:${scope}:${hash(normalized)}`;
};

const getCachedEventFeed = async (key) => {
  if (!key || !isRedisAvailable()) {
    return null;
  }

  try {
    const raw = await redisClient.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const setCachedEventFeed = async (key, payload, ttlSeconds = EVENT_FEED_TTL_SECONDS) => {
  if (!key || !isRedisAvailable()) {
    return;
  }

  try {
    await redisClient.set(key, JSON.stringify(payload), "EX", Math.max(5, ttlSeconds));
  } catch {
    // Cache writes are best-effort.
  }
};

const invalidateEventFeedCache = async () => {
  if (!isRedisAvailable()) {
    return;
  }

  try {
    const stream = redisClient.scanStream({
      match: `${EVENT_FEED_PREFIX}:*`,
      count: 200,
    });

    const pipeline = redisClient.pipeline();
    let queued = 0;

    await new Promise((resolve, reject) => {
      stream.on("data", (keys = []) => {
        for (const key of keys) {
          pipeline.del(key);
          queued += 1;
        }
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    if (queued > 0) {
      await pipeline.exec();
    }
  } catch {
    // Invalidation is fail-open; short TTL limits stale data.
  }
};

const buildEventSeatsKey = (eventId) => `${EVENT_SEATS_PREFIX}:${eventId}`;

const primeRemainingSeats = async (eventId, remainingSeats) => {
  if (!eventId || !isRedisAvailable() || !Number.isFinite(remainingSeats)) {
    return;
  }

  try {
    await redisClient.set(buildEventSeatsKey(eventId), String(Math.max(0, remainingSeats)), "EX", 60 * 60 * 24, "NX");
  } catch {
    // Best-effort.
  }
};

const decrementRemainingSeats = async (eventId) => {
  if (!eventId || !isRedisAvailable()) {
    return;
  }

  try {
    const key = buildEventSeatsKey(eventId);
    const next = await redisClient.decr(key);
    if (next < 0) {
      await redisClient.set(key, "0", "EX", 60 * 60 * 24);
    } else {
      await redisClient.expire(key, 60 * 60 * 24);
    }
  } catch {
    // Best-effort.
  }
};

const clearRemainingSeats = async (eventId) => {
  if (!eventId || !isRedisAvailable()) {
    return;
  }

  try {
    await redisClient.del(buildEventSeatsKey(eventId));
  } catch {
    // Best-effort.
  }
};

module.exports = {
  EVENT_FEED_TTL_SECONDS,
  buildEventFeedKey,
  getCachedEventFeed,
  setCachedEventFeed,
  invalidateEventFeedCache,
  primeRemainingSeats,
  decrementRemainingSeats,
  clearRemainingSeats,
};
