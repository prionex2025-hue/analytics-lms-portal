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

const getLockoutMs = (failedCount) => {
  if (failedCount < env.loginLockout.maxAttempts) {
    return 0;
  }

  const exponent = Math.min(failedCount - env.loginLockout.maxAttempts, 8);
  return Math.min(env.loginLockout.baseLockoutMs * (2 ** exponent), env.loginLockout.maxLockoutMs);
};

const assertLoginAllowed = async ({ scope, identifier }) => {
  const key = buildKey(scope, identifier);
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
};

const recordLoginFailure = async ({ scope, identifier }) => {
  const key = buildKey(scope, identifier);
  const current = await readAttempt(key);
  const failedCount = Number(current?.failedCount || 0) + 1;
  const lockoutMs = getLockoutMs(failedCount);
  const lockedUntil = lockoutMs > 0 ? getNow() + lockoutMs : 0;

  await writeAttempt(key, {
    failedCount,
    lockedUntil,
    lastFailedAt: new Date().toISOString(),
  });

  return {
    failedCount,
    locked: lockedUntil > getNow(),
    retryAfterSeconds: lockedUntil > getNow() ? Math.ceil((lockedUntil - getNow()) / 1000) : 0,
  };
};

const clearLoginFailures = async ({ scope, identifier }) => {
  await clearAttempt(buildKey(scope, identifier));
};

module.exports = {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
};
