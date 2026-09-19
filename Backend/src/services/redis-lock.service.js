const crypto = require("crypto");
const { redisClient, isRedisAvailable } = require("../config/redis");

const DEFAULT_LOCK_TTL_MS = 8_000;

const releaseScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const buildLockToken = () => crypto.randomBytes(16).toString("hex");

const tryAcquireLock = async (lockKey, ttlMs = DEFAULT_LOCK_TTL_MS) => {
  if (!isRedisAvailable()) {
    return null;
  }

  const token = buildLockToken();
  try {
    const result = await redisClient.set(lockKey, token, "PX", Math.max(1000, ttlMs), "NX");
    if (result !== "OK") {
      return null;
    }

    return token;
  } catch {
    return null;
  }
};

const releaseLock = async (lockKey, token) => {
  if (!lockKey || !token || !isRedisAvailable()) {
    return;
  }

  try {
    await redisClient.eval(releaseScript, 1, lockKey, token);
  } catch {
    // Fail-open.
  }
};

const withRedisLock = async ({
  lockKey,
  ttlMs = DEFAULT_LOCK_TTL_MS,
  waitTimeoutMs = 2_500,
  retryDelayMs = 60,
  onLockTimeout,
  task,
}) => {
  if (typeof task !== "function") {
    throw new Error("withRedisLock requires a task function");
  }

  if (!lockKey) {
    return task({ lockAcquired: false });
  }

  if (!isRedisAvailable()) {
    return task({ lockAcquired: false });
  }

  const deadline = Date.now() + Math.max(0, waitTimeoutMs);
  let token = await tryAcquireLock(lockKey, ttlMs);

  while (!token && Date.now() < deadline) {
    await sleep(Math.max(20, retryDelayMs));
    token = await tryAcquireLock(lockKey, ttlMs);
  }

  if (!token) {
    if (typeof onLockTimeout === "function") {
      return onLockTimeout();
    }

    return task({ lockAcquired: false });
  }

  try {
    return await task({ lockAcquired: true });
  } finally {
    await releaseLock(lockKey, token);
  }
};

module.exports = {
  withRedisLock,
};
