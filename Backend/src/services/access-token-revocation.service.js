const { redisClient, isRedisAvailable } = require("../config/redis");
const { verifyAccessToken } = require("../utils/token");

const memoryBlocklist = new Map();
const MEMORY_MAX_ENTRIES = 10000;

const isProduction = () => process.env.NODE_ENV === "production";

const buildKey = (jti) => `auth:access:revoked:${jti}`;

const createRedisRequiredError = () => {
  const error = new Error("Redis is required for access-token revocation in production");
  error.statusCode = 503;
  error.code = "ACCESS_TOKEN_REVOCATION_REDIS_REQUIRED";
  return error;
};

const getPayloadTtlSeconds = (payload = {}) => {
  const expMs = Number(payload.exp || 0) * 1000;
  const ttlMs = expMs - Date.now();
  return Math.max(0, Math.ceil(ttlMs / 1000));
};

const pruneMemoryBlocklist = () => {
  const now = Date.now();
  for (const [jti, expiresAt] of memoryBlocklist.entries()) {
    if (expiresAt <= now) {
      memoryBlocklist.delete(jti);
    }
  }

  if (memoryBlocklist.size <= MEMORY_MAX_ENTRIES) {
    return;
  }

  const entries = [...memoryBlocklist.entries()].sort((a, b) => a[1] - b[1]);
  const toDelete = entries.slice(0, entries.length - MEMORY_MAX_ENTRIES);
  for (const [jti] of toDelete) {
    memoryBlocklist.delete(jti);
  }
};

const revokeAccessTokenPayload = async (payload = {}) => {
  const jti = payload.jti;
  const ttlSeconds = getPayloadTtlSeconds(payload);
  if (!jti || ttlSeconds <= 0) {
    return false;
  }

  if (isRedisAvailable()) {
    try {
      await redisClient.set(buildKey(jti), "1", "EX", ttlSeconds);
      return true;
    } catch {
      if (isProduction()) throw createRedisRequiredError();
    }
  }

  if (isProduction()) {
    throw createRedisRequiredError();
  }

  memoryBlocklist.set(jti, Date.now() + ttlSeconds * 1000);
  if (memoryBlocklist.size > MEMORY_MAX_ENTRIES) {
    pruneMemoryBlocklist();
  }
  return true;
};

const revokeAccessToken = async (token) => {
  if (!token) {
    return false;
  }

  try {
    const payload = verifyAccessToken(token);
    const revoked = await revokeAccessTokenPayload(payload);
    if (payload?.sub) {
      // Drop any live Socket.IO connection for this principal (logout/forced
      // revocation). Required so a stale proctoring or monitoring socket does
      // not persist across logout or an account switch on a shared device.
      try {
        const { disconnectUserSockets } = require("../realtime/socket");
        disconnectUserSockets(payload.sub);
      } catch {
        // Socket layer unavailable; access-token revocation still succeeds.
      }
    }
    return revoked;
  } catch {
    return false;
  }
};

const revokeAccessTokenFromRequest = async (req) => {
  const authHeader = String(req?.headers?.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return revokeAccessToken(token);
};

const isAccessTokenRevoked = async (payload = {}) => {
  const jti = payload.jti;
  if (!jti) {
    return false;
  }

  if (isRedisAvailable()) {
    try {
      return Boolean(await redisClient.exists(buildKey(jti)));
    } catch {
      if (isProduction()) throw createRedisRequiredError();
    }
  }

  if (isProduction()) {
    throw createRedisRequiredError();
  }

  const expiresAt = memoryBlocklist.get(jti);
  if (!expiresAt) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    memoryBlocklist.delete(jti);
    return false;
  }
  return true;
};

module.exports = {
  revokeAccessToken,
  revokeAccessTokenFromRequest,
  revokeAccessTokenPayload,
  isAccessTokenRevoked,
};
