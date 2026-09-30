const crypto = require("crypto");
const env = require("../config/env");
const { redisClient, isRedisAvailable } = require("../config/redis");
const { ApiError } = require("../utils/http");
const { logger } = require("../utils/logger");

// Two independent counters per login identifier:
//  - identifier + client IP: locks after `maxAttempts`. This is the normal
//    brute-force brake, and because it is IP-scoped a stranger cannot lock a
//    student out of their own account (e.g. right before an exam).
//  - identifier alone: locks only after `accountMaxAttempts` (much higher),
//    still stopping a distributed guessing attack spread across many IPs.
//
// Storage: Redis (shared by all replicas) with atomic INCR, so a burst of
// parallel wrong-password requests cannot under-count the way a
// GET-then-SET did. If Redis is unavailable, counters fall back to bounded
// per-process memory rather than failing logins.

const MEMORY_MAX_KEYS = 50_000;
const memoryCounts = new Map();
const memoryLocks = new Map();

const hashValue = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

const normalizeIdentifier = (value) => String(value || "").trim().toLowerCase();

const buildKey = (scope, identifier) => `login_attempt:${scope}:${hashValue(normalizeIdentifier(identifier))}`;
const lockKeyFor = (key) => `${key}:lock`;

const getNow = () => Date.now();

// INCR the failure counter and keep its TTL at least `ARGV[1]` ms.
const RECORD_FAILURE_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < tonumber(ARGV[1]) then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`;

// Extend an existing counter's TTL to at least ARGV[1] ms.
const EXTEND_SCRIPT = `
local ttl = redis.call("PTTL", KEYS[1])
if ttl > 0 and ttl < tonumber(ARGV[1]) then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return ttl
`;

const getLockoutMs = (failedCount, threshold) => {
  if (failedCount < threshold) {
    return 0;
  }

  const exponent = Math.min(failedCount - threshold, 8);
  return Math.min(env.loginLockout.baseLockoutMs * (2 ** exponent), env.loginLockout.maxLockoutMs);
};

const buildKeys = ({ scope, identifier, ip }) => [
  { kind: "identifier+ip", key: buildKey(`${scope}:ip:${String(ip || "unknown")}`, identifier), threshold: env.loginLockout.maxAttempts },
  { kind: "account", key: buildKey(`${scope}:account`, identifier), threshold: env.loginLockout.accountMaxAttempts },
];

// --- memory fallback --------------------------------------------------------

const boundMap = (map) => {
  if (map.size <= MEMORY_MAX_KEYS) return;
  const now = getNow();
  for (const [key, value] of map.entries()) {
    if (value.expiresAt <= now) map.delete(key);
  }
  let overflow = map.size - MEMORY_MAX_KEYS;
  for (const key of map.keys()) {
    if (overflow <= 0) break;
    map.delete(key);
    overflow -= 1;
  }
};

const memoryGet = (map, key) => {
  const entry = map.get(key);
  if (!entry || entry.expiresAt <= getNow()) {
    map.delete(key);
    return null;
  }
  return entry;
};

const memory = {
  lockRemainingMs: (key) => {
    const lock = memoryGet(memoryLocks, lockKeyFor(key));
    return lock ? lock.expiresAt - getNow() : 0;
  },
  recordFailure: (key, ttlMs) => {
    const current = memoryGet(memoryCounts, key);
    const count = Number(current?.count || 0) + 1;
    memoryCounts.set(key, { count, expiresAt: Math.max(current?.expiresAt || 0, getNow() + ttlMs) });
    boundMap(memoryCounts);
    return count;
  },
  lock: (key, lockoutMs) => {
    memoryLocks.set(lockKeyFor(key), { expiresAt: getNow() + lockoutMs });
    boundMap(memoryLocks);
  },
  extend: (key, ttlMs) => {
    const current = memoryGet(memoryCounts, key);
    if (current) current.expiresAt = Math.max(current.expiresAt, getNow() + ttlMs);
  },
  clear: (key) => {
    memoryCounts.delete(key);
    memoryLocks.delete(lockKeyFor(key));
  },
};

// --- redis ------------------------------------------------------------------

const redisStore = {
  lockRemainingMs: async (key) => Math.max(0, Number(await redisClient.pttl(lockKeyFor(key)))),
  recordFailure: async (key, ttlMs) => Number(await redisClient.eval(RECORD_FAILURE_SCRIPT, 1, key, String(ttlMs))),
  lock: async (key, lockoutMs) => {
    await redisClient.set(lockKeyFor(key), "1", "PX", lockoutMs);
  },
  extend: async (key, ttlMs) => {
    await redisClient.eval(EXTEND_SCRIPT, 1, key, String(ttlMs));
  },
  clear: async (key) => {
    await redisClient.del(key, lockKeyFor(key));
  },
};

const run = async (operation, ...args) => {
  if (redisClient && isRedisAvailable()) {
    try {
      return await redisStore[operation](...args);
    } catch (error) {
      logger.throttled("warn", "login-attempt-degraded", 60_000, "login_lockout.redis_unavailable", {
        fallback: "per-instance-memory",
        reason: error?.message,
      });
    }
  }
  return memory[operation](...args);
};

// --- public API -------------------------------------------------------------

const assertLoginAllowed = async ({ scope, identifier, ip }) => {
  for (const { key } of buildKeys({ scope, identifier, ip })) {
    const remainingMs = await run("lockRemainingMs", key);

    if (remainingMs > 0) {
      const retryAfterSeconds = Math.ceil(remainingMs / 1000);
      throw new ApiError(
        429,
        "Too many failed login attempts. Please retry later.",
        { retryAfterSeconds },
        "ACCOUNT_LOCKED"
      );
    }
  }
};

const recordLoginFailure = async ({ scope, identifier, ip }) => {
  let locked = false;
  let retryAfterSeconds = 0;
  let failedCount = 0;

  for (const { kind, key, threshold } of buildKeys({ scope, identifier, ip })) {
    const count = await run("recordFailure", key, env.loginLockout.windowMs);
    const lockoutMs = getLockoutMs(count, threshold);

    if (lockoutMs > 0) {
      await run("lock", key, lockoutMs);
      // Keep the counter alive for the whole lockout so the next failure after
      // it expires escalates instead of starting over.
      if (lockoutMs > env.loginLockout.windowMs) {
        await run("extend", key, lockoutMs);
      }
      locked = true;
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil(lockoutMs / 1000));
      logger.warn("auth.login_locked", {
        scope,
        counter: kind,
        failedCount: count,
        lockoutSeconds: Math.ceil(lockoutMs / 1000),
        ip: String(ip || "unknown"),
      });
    }

    failedCount = Math.max(failedCount, count);
  }

  return { failedCount, locked, retryAfterSeconds };
};

const clearLoginFailures = async ({ scope, identifier, ip }) => {
  for (const { key } of buildKeys({ scope, identifier, ip })) {
    await run("clear", key);
  }
};

module.exports = {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
};
