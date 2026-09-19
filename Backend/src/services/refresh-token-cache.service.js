const crypto = require("crypto");
const { redisClient, isRedisAvailable } = require("../config/redis");

const REFRESH_TOKEN_PREFIX = "refresh_token";

const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
const buildKeyFromHash = (scope, tokenHash) => `${REFRESH_TOKEN_PREFIX}:${scope}:${tokenHash}`;
const buildKey = (scope, token) => buildKeyFromHash(scope, hashToken(token));

const normalizeRecord = (record, scope) => {
  if (!record) return null;

  return {
    id: record.id,
    userId: record.userId || null,
    adminId: record.adminId || null,
    superAdminId: record.superAdminId || null,
    tokenHash: record.tokenHash || (record.token ? hashToken(record.token) : null),
    scope,
    revokedAt: record.revokedAt || null,
    expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : null,
  };
};

const getTtlSeconds = (expiresAt) => {
  const expiresMs = new Date(expiresAt || 0).getTime();
  if (!Number.isFinite(expiresMs)) return 0;
  return Math.floor((expiresMs - Date.now()) / 1000);
};

const cacheRefreshToken = async (scope, token, record) => {
  if (!scope || !token || !record || !isRedisAvailable()) {
    return;
  }

  const ttlSeconds = getTtlSeconds(record.expiresAt);
  if (ttlSeconds <= 0) {
    return;
  }

  try {
    await redisClient.set(buildKey(scope, token), JSON.stringify(normalizeRecord(record, scope)), "EX", ttlSeconds);
  } catch {
    // Refresh-token cache is best-effort; DB remains authoritative.
  }
};

const getCachedRefreshToken = async (scope, token) => {
  if (!scope || !token || !isRedisAvailable()) {
    return null;
  }

  try {
    const raw = await redisClient.get(buildKey(scope, token));
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record.revokedAt || getTtlSeconds(record.expiresAt) <= 0) {
      await redisClient.del(buildKey(scope, token));
      return null;
    }
    return record;
  } catch {
    return null;
  }
};

const invalidateRefreshToken = async (scope, token) => {
  if (!scope || !token || !isRedisAvailable()) {
    return;
  }

  try {
    await redisClient.del(buildKey(scope, token));
  } catch {
    // Fail-open.
  }
};

const invalidateRefreshTokenHash = async (scope, tokenHash) => {
  if (!scope || !tokenHash || !isRedisAvailable()) {
    return;
  }

  try {
    await redisClient.del(buildKeyFromHash(scope, tokenHash));
  } catch {
    // Fail-open.
  }
};

const invalidateRefreshTokenRecord = async (scope, record) => {
  if (!scope || !record) {
    return;
  }

  if (record.tokenHash) {
    await invalidateRefreshTokenHash(scope, record.tokenHash);
    return;
  }

  if (record.token) {
    await invalidateRefreshToken(scope, record.token);
  }
};

module.exports = {
  cacheRefreshToken,
  getCachedRefreshToken,
  invalidateRefreshToken,
  invalidateRefreshTokenHash,
  invalidateRefreshTokenRecord,
  hashRefreshToken: hashToken,
};
