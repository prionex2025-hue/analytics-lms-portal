const { redisClient, isRedisAvailable } = require("../config/redis");

// TTL for cached auth profiles — short enough to limit stale permission windows,
// long enough to absorb thundering-herd load during exams.
const AUTH_CACHE_TTL_SECONDS = 120;

// In-memory fallback when Redis is unavailable.
const memoryCache = new Map();
const MEMORY_MAX_ENTRIES = 2000;

const isProduction = () => process.env.NODE_ENV === "production";

const buildKey = (role, userId) => `auth:${role}:${userId}`;

/**
 * Strip sensitive fields before caching.
 */
const sanitizeForCache = (user) => {
  if (!user) return null;
  const safe = { ...user };
  delete safe.passwordHash;
  delete safe.password;
  return safe;
};

const pruneMemoryCache = () => {
  if (memoryCache.size <= MEMORY_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }
  // If still over limit after expiry sweep, evict oldest entries
  if (memoryCache.size > MEMORY_MAX_ENTRIES) {
    const entries = [...memoryCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toDelete = entries.slice(0, entries.length - MEMORY_MAX_ENTRIES);
    for (const [key] of toDelete) {
      memoryCache.delete(key);
    }
  }
};

/**
 * Get a cached user profile. Returns null on miss.
 */
const getCachedUser = async (role, userId) => {
  if (!userId) return null;

  const key = buildKey(role, userId);

  if (isRedisAvailable()) {
    try {
      const raw = await redisClient.get(key);
      if (raw) {
        return JSON.parse(raw);
      }
      return null;
    } catch {
      if (isProduction()) return null;
    }
  }

  if (isProduction()) {
    return null;
  }

  const entry = memoryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value;
  }
  if (entry) {
    memoryCache.delete(key);
  }
  return null;
};

/**
 * Cache a user profile after DB lookup.
 */
const setCachedUser = async (role, userId, user) => {
  if (!userId || !user) return;

  const key = buildKey(role, userId);
  const safe = sanitizeForCache(user);

  if (isRedisAvailable()) {
    try {
      await redisClient.set(key, JSON.stringify(safe), "EX", AUTH_CACHE_TTL_SECONDS);
      return;
    } catch {
      if (isProduction()) return;
    }
  }

  if (isProduction()) {
    return;
  }

  memoryCache.set(key, {
    value: safe,
    expiresAt: Date.now() + AUTH_CACHE_TTL_SECONDS * 1000,
  });
  pruneMemoryCache();
};

/**
 * Invalidate a cached user profile (call on profile update, deactivation, etc.)
 */
const invalidateCachedUser = async (role, userId) => {
  if (!userId) return;

  const key = buildKey(role, userId);
  if (!isProduction()) {
    memoryCache.delete(key);
  }

  if (isRedisAvailable()) {
    try {
      await redisClient.del(key);
    } catch {
      // Fail-open
    }
  }
};

module.exports = {
  getCachedUser,
  setCachedUser,
  invalidateCachedUser,
};
