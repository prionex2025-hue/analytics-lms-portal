const { redisClient, isRedisAvailable } = require("../config/redis");
const { verifyAccessToken } = require("../utils/token");

const { logger } = require("../utils/logger");
const { ApiError } = require("../utils/http");

// Per-token (jti) blocklist used on logout, so a logged-out access token stops
// working before its natural expiry (JWT_ACCESS_EXPIRES_IN, 15m by default).
//
// Development/test may fall back to this process's memory. Production requires
// Redis for shared revocation and fails closed with 503 if Redis is unavailable.
// Rationale:
//  - Account-level revocation (password reset/change, deactivation, admin
//    force-logout) is enforced by the tokenVersion check against MongoDB in
//    middleware/auth.js and does NOT depend on Redis.
//  - Logout also revokes the refresh token in MongoDB, so a failed access-token
//    revocation cannot extend the session.
// Production intentionally accepts temporary unavailability rather than
// accepting a token that may have been revoked on another replica.
const memoryBlocklist = new Map();
const MEMORY_MAX_ENTRIES = 10000;

const buildKey = (jti) => `auth:access:revoked:${jti}`;

const isProduction = () => String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

const redisUnavailable = () => new ApiError(
  503,
  "Authentication service temporarily unavailable. Please retry shortly.",
  null,
  "TOKEN_REVOCATION_UNAVAILABLE"
);

const warnDegraded = (operation, error) => {
  logger.throttled("warn", `token-revocation-degraded:${operation}`, 60_000, "auth.token_revocation_redis_unavailable", {
    operation,
    fallback: isProduction() ? "none" : "per-instance-memory",
    impact: isProduction()
      ? "authentication or logout rejected with 503"
      : "local development/test revocation state used",
    reason: error?.name || (error ? "redis command failed" : "redis not ready"),
  });
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

  if (isProduction()) {
    // Redis is authoritative in production. Never let a local entry alter a
    // later decision after Redis reconnects; every replica must observe the
    // same persisted result.
    if (!redisClient || !isRedisAvailable()) {
      warnDegraded("revoke");
      throw redisUnavailable();
    }
    try {
      await redisClient.set(buildKey(jti), "1", "EX", ttlSeconds);
    } catch (error) {
      warnDegraded("revoke", error);
      throw redisUnavailable();
    }
    return true;
  }

  memoryBlocklist.set(jti, Date.now() + ttlSeconds * 1000);
  if (memoryBlocklist.size > MEMORY_MAX_ENTRIES) {
    pruneMemoryBlocklist();
  }

  if (redisClient && isRedisAvailable()) {
    try {
      await redisClient.set(buildKey(jti), "1", "EX", ttlSeconds);
    } catch (error) {
      warnDegraded("revoke", error);
    }
  } else if (redisClient) {
    warnDegraded("revoke");
  }
  return true;
};

const revokeAccessToken = async (token) => {
  if (!token) {
    return false;
  }

  try {
    const payload = verifyAccessToken(token);
    let revoked;
    try {
      revoked = await revokeAccessTokenPayload(payload);
    } finally {
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
    }
    return revoked;
  } catch (error) {
    if (error?.code === "TOKEN_REVOCATION_UNAVAILABLE") throw error;
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

  if (isProduction()) {
    if (!redisClient || !isRedisAvailable()) {
      warnDegraded("check");
      throw redisUnavailable();
    }
    try {
      return Boolean(await redisClient.exists(buildKey(jti)));
    } catch (error) {
      warnDegraded("check", error);
      throw redisUnavailable();
    }
  }

  if (redisClient && isRedisAvailable()) {
    try {
      if (await redisClient.exists(buildKey(jti))) return true;
    } catch (error) {
      warnDegraded("check", error);
    }
  } else if (redisClient) {
    warnDegraded("check");
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
