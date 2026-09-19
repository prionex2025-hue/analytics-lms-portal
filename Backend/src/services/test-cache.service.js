const { redisClient, isRedisAvailable } = require("../config/redis");

// Longer TTL since test metadata and questions rarely change during an exam window.
const TEST_META_TTL_SECONDS = 300;
const TEST_QUESTIONS_TTL_SECONDS = 300;

const memoryCache = new Map();
const MEMORY_MAX_ENTRIES = 500;

const isProduction = () => process.env.NODE_ENV === "production";

const pruneMemoryCache = () => {
  if (memoryCache.size <= MEMORY_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }
};

const getFromCache = async (key) => {
  if (isRedisAvailable()) {
    try {
      const raw = await redisClient.get(key);
      return raw ? JSON.parse(raw) : null;
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
  if (entry) memoryCache.delete(key);
  return null;
};

const setInCache = async (key, value, ttlSeconds) => {
  if (!value) return;

  if (isRedisAvailable()) {
    try {
      await redisClient.set(key, JSON.stringify(value), "EX", ttlSeconds);
      return;
    } catch {
      if (isProduction()) return;
    }
  }

  if (isProduction()) {
    return;
  }

  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  pruneMemoryCache();
};

const deleteFromCache = async (key) => {
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

// --- Test Metadata Cache ---

/**
 * Cache test metadata (everything except questions).
 * Strips questions array to avoid storing answers in cache.
 */
const getCachedTestMeta = (testId) => getFromCache(`test:meta:${testId}`);

const setCachedTestMeta = (testId, test) => {
  if (!testId || !test) return Promise.resolve();
  // Store only metadata fields — not questions/submissions
  const meta = { ...test };
  delete meta.questions;
  delete meta.submissions;
  delete meta.answers;
  return setInCache(`test:meta:${testId}`, meta, TEST_META_TTL_SECONDS);
};

const invalidateTestMeta = (testId) => deleteFromCache(`test:meta:${testId}`);

// --- Test Questions Cache ---

/**
 * Cache questions for a test — safe for student view (no correct answers).
 * The caller must sanitize questions before caching.
 */
const getCachedTestQuestions = (testId) => getFromCache(`test:questions:${testId}`);

const setCachedTestQuestions = (testId, questions) => {
  if (!testId || !questions) return Promise.resolve();
  return setInCache(`test:questions:${testId}`, questions, TEST_QUESTIONS_TTL_SECONDS);
};

const invalidateTestQuestions = (testId) => deleteFromCache(`test:questions:${testId}`);

/**
 * Invalidate all cached data for a test (call after test CRUD).
 */
const invalidateTestCache = async (testId) => {
  await Promise.all([
    invalidateTestMeta(testId),
    invalidateTestQuestions(testId),
  ]);
};

module.exports = {
  getCachedTestMeta,
  setCachedTestMeta,
  invalidateTestMeta,
  getCachedTestQuestions,
  setCachedTestQuestions,
  invalidateTestQuestions,
  invalidateTestCache,
};
