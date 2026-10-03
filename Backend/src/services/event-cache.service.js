const crypto = require("crypto");
const { redisClient, isRedisAvailable } = require("../config/redis");

const EVENT_FEED_TTL_SECONDS = 30;
const EVENT_FEED_PREFIX = "event_feed";
// Index of live feed cache keys. Redis SCAN iterates the ENTIRE keyspace and only
// filters by pattern on the way out, so invalidating `event_feed:*` on a Redis
// shared with rate limits, sessions, queues and other caches walked every key in
// the instance. This set makes invalidation proportional to the number of cached
// feeds instead of the size of the keyspace.
const EVENT_FEED_INDEX_KEY = `${EVENT_FEED_PREFIX}:index`;
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
    const ttl = Math.max(5, ttlSeconds);
    const pipeline = redisClient.pipeline();
    pipeline.set(key, JSON.stringify(payload), "EX", ttl);
    // Track the key so invalidation can find it without scanning.
    pipeline.sadd(EVENT_FEED_INDEX_KEY, key);
    // The index only needs to outlive the longest-lived feed entry it tracks;
    // refreshing it here keeps it from expiring while keys are still live.
    pipeline.expire(EVENT_FEED_INDEX_KEY, ttl + 5);
    await pipeline.exec();
  } catch {
    // Cache writes are best-effort.
  }
};

const invalidateEventFeedCache = async () => {
  if (!isRedisAvailable()) {
    return;
  }

  try {
    // Only the keys this service wrote are listed in the index, so this is O(cached
    // feeds) rather than O(total keys in Redis).
    const keys = await redisClient.smembers(EVENT_FEED_INDEX_KEY);
    const pipeline = redisClient.pipeline();

    for (const key of keys) {
      pipeline.del(key);
    }

    pipeline.del(EVENT_FEED_INDEX_KEY);

    if (pipeline.length > 0) {
      await pipeline.exec();
    }
  } catch {
    // Invalidation is fail-open; the short feed TTL limits stale data.
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
