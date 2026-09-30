const crypto = require("crypto");
const env = require("../config/env");
const { redisClient, isRedisAvailable } = require("../config/redis");
const { ApiError } = require("../utils/http");

const memoryAttempts = new Map();

const hashValue = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

const normalizeIdentifier = (value) => String(value || "").trim().toLowerCase();

const buildKey = (scope, identifier) => `login_attempt:${scope}:${hashValue(normalizeIdentifier(identifier))}`;

const getNow = () => Date.now();

const readAttempt = async (key) => {
  if (isRedisAvailable()) {
    const raw = await redisClient.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  const current = memoryAttempts.get(key);
  if (!current || current.expiresAt <= getNow()) {
    memoryAttempts.delete(key);
    return null;
  }
  return current;
};

const writeAttempt = async (key, attempt) => {
  const ttlMs = Math.max(env.loginLockout.windowMs, (attempt.lockedUntil || 0) - getNow());
  const expiresAt = getNow() + ttlMs;
  const nextAttempt = { ...attempt, expiresAt };

  if (isRedisAvailable()) {
    await redisClient.set(key, JSON.stringify(nextAttempt), "PX", ttlMs);
    return nextAttempt;
  }

  memoryAttempts.set(key, nextAttempt);
  return nextAttempt;
};

const clearAttempt = async (key) => {
  if (isRedisAvailable()) {
    await redisClient.del(key);
    return;
  }
  memoryAttempts.delete(key);
};

// Two independent counters per login identifier:
//  - identifier + client IP: locks after `maxAttempts`. This is the normal
//    brute-force brake, and because it is IP-scoped a stranger cannot lock a
//    student out of their own account (e.g. right before an exam).
//  - identifier alone: locks only after `accountMaxAttempts` (much higher),
//    still stopping a distributed guessing attack spread across many IPs.
const getLockoutMs = (failedCount, threshold) => {
  if (failedCount < threshold) {
    return 0;
  }

  const exponent = Math.min(failedCount - threshold, 8);
  return Math.min(env.loginLockout.baseLockoutMs * (2 ** exponent), env.loginLockout.maxLockoutMs);
};

const buildKeys = ({ scope, identifier, ip }) => [
  { key: buildKey(`${scope}:ip:${String(ip || "unknown")}`, identifier), threshold: env.loginLockout.maxAttempts },
  { key: buildKey(`${scope}:account`, identifier), threshold: env.loginLockout.accountMaxAttempts },
];

const assertLoginAllowed = async ({ scope, identifier, ip }) => {
  for (const { key } of buildKeys({ scope, identifier, ip })) {
    const attempt = await readAttempt(key);
    const lockedUntil = Number(attempt?.lockedUntil || 0);

    if (lockedUntil > getNow()) {
      const retryAfterSeconds = Math.ceil((lockedUntil - getNow()) / 1000);
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

  for (const { key, threshold } of buildKeys({ scope, identifier, ip })) {
    const current = await readAttempt(key);
    const count = Number(current?.failedCount || 0) + 1;
    const lockoutMs = getLockoutMs(count, threshold);
    const lockedUntil = lockoutMs > 0 ? getNow() + lockoutMs : 0;

    await writeAttempt(key, {
      failedCount: count,
      lockedUntil,
      lastFailedAt: new Date().toISOString(),
    });

    failedCount = Math.max(failedCount, count);
    if (lockedUntil > getNow()) {
      locked = true;
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((lockedUntil - getNow()) / 1000));
    }
  }

  return { failedCount, locked, retryAfterSeconds };
};

const clearLoginFailures = async ({ scope, identifier, ip }) => {
  for (const { key } of buildKeys({ scope, identifier, ip })) {
    await clearAttempt(key);
  }
};

module.exports = {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
};
