const crypto = require("crypto");
const { redisClient, isRedisAvailable } = require("../config/redis");
const { verifyAccessToken } = require("../utils/token");
const { recordRateLimitEvent } = require("../services/rate-limit-metrics.service");
const { getClientIp } = require("../utils/client-ip");
const { logger } = require("../utils/logger");
const { ApiError } = require("../utils/http");

// ---------------------------------------------------------------------------
// Counter store
//
// Redis is the shared store, so every API replica sees the same count for a
// key. Production limiters fail closed if Redis is missing or unavailable;
// per-process fallback is retained only for development and tests. That keeps
// brute-force and abuse ceilings consistent across replicas.
// ---------------------------------------------------------------------------

const MEMORY_COUNTER_MAX_KEYS = 50_000;
const memoryCounters = new Map();

// One round trip, atomic: INCR, attach the window TTL on first hit, and repair a
// key that somehow lost its TTL (would otherwise block that identity forever).
const HIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  if count > 1 then
    redis.call("SET", KEYS[1], "1", "PX", ARGV[1])
    count = 1
  else
    redis.call("PEXPIRE", KEYS[1], ARGV[1])
  end
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

const isRateLimitDisabled = () => {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  // This kill switch turns off *every* limiter, including the login,
  // forgot-password and reset-password brute-force protections. That is a
  // sensible local debugging aid and a serious production exposure, so it is
  // honoured only outside production.
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() === "production") {
    return false;
  }

  const value = String(process.env.RATE_LIMIT_DISABLED || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
};

const toSafePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const hashValue = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 32);

const pruneMemoryCounters = () => {
  const now = Date.now();
  for (const [key, value] of memoryCounters.entries()) {
    if (!value || value.resetAt <= now) {
      memoryCounters.delete(key);
    }
  }

  // Still full of live keys (e.g. an attacker rotating identities): drop the
  // oldest entries. Map iteration order is insertion order.
  let overflow = memoryCounters.size - MEMORY_COUNTER_MAX_KEYS;
  for (const key of memoryCounters.keys()) {
    if (overflow <= 0) break;
    memoryCounters.delete(key);
    overflow -= 1;
  }
};

const hitMemoryCounter = (key, windowMs) => {
  const now = Date.now();
  const current = memoryCounters.get(key);

  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + windowMs };
    memoryCounters.set(key, next);
    if (memoryCounters.size > MEMORY_COUNTER_MAX_KEYS) {
      pruneMemoryCounters();
    }
    return { count: next.count, remainingMs: windowMs };
  }

  current.count += 1;
  return { count: current.count, remainingMs: Math.max(1, current.resetAt - now) };
};

const hitRedisCounter = async (key, windowMs) => {
  const [count, ttl] = await redisClient.eval(HIT_SCRIPT, 1, key, String(windowMs));
  return { count: Number(count), remainingMs: Math.max(1, Number(ttl)) };
};

// Give back one unit (reservation released). Never creates a key or goes
// negative, so a release after the window rolled over is a no-op.
const RELEASE_SCRIPT = `
local count = tonumber(redis.call("GET", KEYS[1]) or "0")
if count > 0 then
  return redis.call("DECR", KEYS[1])
end
return 0
`;

const releaseRedisCounter = async (key) => {
  await redisClient.eval(RELEASE_SCRIPT, 1, key);
};

const releaseMemoryCounter = (key) => {
  const current = memoryCounters.get(key);
  if (current && current.resetAt > Date.now() && current.count > 0) {
    current.count -= 1;
  }
};

const warnDegraded = (scope, error) => {
  logger.throttled("warn", `rate-limit-degraded:${scope}`, 60_000, "rate_limit.redis_unavailable", {
    scope,
    fallback: isProduction() ? "none" : "per-instance-memory",
    impact: isProduction() ? "rate-limited request rejected with 503" : "local test/development counter used",
    reason: error?.name || (error ? "redis command failed" : "redis not ready"),
  });
};

const isProduction = () => String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

const rateLimitStoreUnavailable = () => new ApiError(
  503,
  "Request protection is temporarily unavailable. Please retry shortly.",
  null,
  "RATE_LIMIT_STORE_UNAVAILABLE"
);

const withStore = async (scope, redisOp, memoryOp) => {
  if (redisClient && isRedisAvailable()) {
    try {
      return await redisOp();
    } catch (error) {
      warnDegraded(scope, error);
      if (isProduction()) throw rateLimitStoreUnavailable();
      return memoryOp();
    }
  }

  if (redisClient) {
    // Configured but not connected.
    warnDegraded(scope);
    if (isProduction()) throw rateLimitStoreUnavailable();
  } else if (isProduction()) {
    logger.throttled("error", `rate-limit-redis-missing:${scope}`, 60_000, "rate_limit.redis_not_configured", { scope });
    throw rateLimitStoreUnavailable();
  }
  return memoryOp();
};

const hitCounter = (scope, key, windowMs) =>
  withStore(scope, () => hitRedisCounter(key, windowMs), () => hitMemoryCounter(key, windowMs));

const releaseCounter = (scope, key) =>
  withStore(scope, () => releaseRedisCounter(key), () => releaseMemoryCounter(key));

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const formatIdentity = (kind, id, role) => {
  if (!id) {
    return null;
  }

  if (role) {
    return `user:${String(role).toUpperCase()}:${id}`;
  }

  return `${kind}:${id}`;
};

const getActorIdentity = (req) => {
  if (req.authIdentity) {
    return String(req.authIdentity);
  }

  if (req.user?.id) {
    return formatIdentity("user", req.user.id, req.user.role || "STUDENT");
  }

  if (req.admin?.id) {
    return formatIdentity("user", req.admin.id, req.admin.role || "ADMIN");
  }

  if (req.superAdmin?.id) {
    return formatIdentity("user", req.superAdmin.id, req.superAdmin.role || "SUPER_ADMIN");
  }

  const authHeader = String(req.headers?.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (token) {
    try {
      const payload = verifyAccessToken(token);
      if (payload?.sub) {
        const role = String(payload.role || "UNKNOWN").toUpperCase();
        return `user:${role}:${payload.sub}`;
      }
    } catch {
      // Fall back to IP-based key.
    }
  }

  return `ip:${getClientIp(req)}`;
};

const buildKey = (req, options) => {
  const identity = options.keySelector ? options.keySelector(req, getActorIdentity(req)) : getActorIdentity(req);
  const scope = options.scope || "global";
  // Identities (IPs, user ids, token hashes) are hashed so Redis never holds
  // raw personal data or credentials.
  return `rate:${scope}:${hashValue(identity)}`;
};

const getRouteLabel = (req, options) => {
  if (options.routeLabel) {
    return String(options.routeLabel);
  }

  const raw = String(req.originalUrl || req.path || "");
  const [pathWithoutQuery] = raw.split("?");
  return pathWithoutQuery || "unknown-route";
};

const applyRateLimitHeaders = (res, max, remaining, resetAfterMs) => {
  const safeRemaining = Math.max(0, remaining);
  const resetSeconds = Math.ceil(resetAfterMs / 1000);

  res.setHeader("RateLimit-Limit", String(max));
  res.setHeader("RateLimit-Remaining", String(safeRemaining));
  res.setHeader("RateLimit-Reset", String(resetSeconds));
  if (safeRemaining <= 0) {
    res.setHeader("Retry-After", String(resetSeconds));
  }
};

const rejectRequest = (req, res, options, remainingMs) => {
  const scope = options.scope || "global";
  const actor = getActorIdentity(req);
  const route = getRouteLabel(req, options);

  recordRateLimitEvent({
    scope,
    route,
    actorHash: hashValue(actor),
    collegeId: req.user?.collegeId || req.admin?.collegeId || req.collegeId || null,
  }).catch(() => {});

  logger.throttled("warn", `rate-limit-exceeded:${scope}:${hashValue(actor)}`, 60_000, "rate_limit.exceeded", {
    scope,
    route,
    method: req.method,
    actor,
    requestId: req.id || null,
  });

  res.setHeader("Retry-After", String(Math.ceil(remainingMs / 1000)));
  return res.status(429).json({
    message: options.message || "Too many requests. Please slow down and try again shortly.",
    code: "RATE_LIMIT_EXCEEDED",
    requestId: req.id || req.headers?.["x-request-id"] || null,
    details: {
      scope,
      retryAfterSeconds: Math.ceil(remainingMs / 1000),
    },
  });
};

/**
 * Create a rate-limit middleware.
 *
 * Options:
 *  - scope       Namespace for the counter (part of the Redis key).
 *  - max         Requests allowed per window.
 *  - windowMs    Fixed window length.
 *  - keySelector (req, actorIdentity) => string identity. Defaults to the
 *                authenticated principal, falling back to client IP.
 *  - countIf     (req, res) => boolean, evaluated when the response closes.
 *                When set, only matching responses keep their quota unit (e.g.
 *                failed logins); others release it. In-flight requests hold a
 *                unit, so parallel bursts cannot exceed `max`.
 *  - skip        (req) => boolean.
 *  - failOpen    false = propagate unexpected limiter errors instead of
 *                letting the request through. Production Redis failures return
 *                503 before this option is considered; memory fallback is for
 *                development and tests only.
 */
const createRateLimiter = (options = {}) => {
  const max = toSafePositiveInt(options.max, 120);
  const windowMs = toSafePositiveInt(options.windowMs, 60_000);
  const scope = options.scope || "global";

  return async (req, res, next) => {
    if (isRateLimitDisabled()) {
      return next();
    }

    if (req.method === "OPTIONS") {
      return next();
    }

    if (typeof options.skip === "function" && options.skip(req)) {
      return next();
    }

    try {
      const key = buildKey(req, options);

      if (typeof options.countIf === "function") {
        // Reserve a unit up front and give it back once the response turns out
        // not to match (e.g. a successful login). Counting only after the
        // response would let a burst of parallel requests all pass the check
        // before any of them was recorded.
        const reserved = await hitCounter(scope, key, windowMs);
        if (reserved.count > max) {
          await releaseCounter(scope, key);
          applyRateLimitHeaders(res, max, 0, reserved.remainingMs);
          return rejectRequest(req, res, options, reserved.remainingMs);
        }
        applyRateLimitHeaders(res, max, max - reserved.count, reserved.remainingMs);

        // "close" fires for completed and aborted requests alike.
        res.once("close", () => {
          let matched = false;
          try {
            matched = res.writableFinished && options.countIf(req, res);
          } catch {
            matched = false;
          }
          if (!matched) {
            releaseCounter(scope, key).catch(() => {});
          }
        });
        return next();
      }

      const hit = await hitCounter(scope, key, windowMs);
      applyRateLimitHeaders(res, max, max - hit.count, hit.remainingMs);

      if (hit.count > max) {
        return rejectRequest(req, res, options, hit.remainingMs);
      }

      return next();
    } catch (error) {
      if (error?.code === "RATE_LIMIT_STORE_UNAVAILABLE") {
        return next(error);
      }
      logger.error("rate_limit.internal_error", { scope, error });
      if (options.failOpen !== false) {
        return next();
      }
      return next(error);
    }
  };
};

/**
 * Consume one unit of quota outside the middleware chain (e.g. per-account
 * limits that need the parsed/normalized identifier). Returns whether the call
 * is still within the limit.
 */
const consumeRateLimit = async ({ scope, identity, max, windowMs }) => {
  const safeMax = toSafePositiveInt(max, 1);
  const safeWindowMs = toSafePositiveInt(windowMs, 60_000);
  const key = `rate:${scope}:${hashValue(identity)}`;
  const hit = await hitCounter(scope, key, safeWindowMs);
  return {
    allowed: hit.count <= safeMax,
    count: hit.count,
    retryAfterSeconds: Math.ceil(hit.remainingMs / 1000),
  };
};

/** Give back a unit taken with consumeRateLimit (reserve-then-release pattern). */
const releaseRateLimit = async ({ scope, identity }) => {
  await releaseCounter(scope, `rate:${scope}:${hashValue(identity)}`);
};

// ---------------------------------------------------------------------------
// Key selectors
// ---------------------------------------------------------------------------

const authKeyByIp = (req) => `ip:${getClientIp(req)}`;

const REFRESH_COOKIE_NAMES = ["student_refresh_token", "lms_admin_refresh_token", "lms_super_admin_refresh_token"];

// Refresh is keyed per refresh-token (i.e. per login session), not per IP: an
// entire college lab behind one NAT address refreshes every ~15 minutes, and
// an IP key would lock the whole lab out. Requests without a token fall back
// to the IP.
const refreshKeyBySession = (req) => {
  const token =
    REFRESH_COOKIE_NAMES.map((name) => req.cookies?.[name]).find(Boolean) ||
    (typeof req.body?.refreshToken === "string" ? req.body.refreshToken : "");
  return token ? `refresh:${hashValue(token)}` : `ip:${getClientIp(req)}`;
};

const examWriteKey = (req, actorIdentity) => {
  const testId = req.params?.testId || req.body?.testId || req.body?.test_id || "unknown-test";
  const attemptId = req.params?.attemptId || req.params?.attempt_id || req.body?.submissionId || req.body?.attemptId || "unknown-attempt";
  return `${actorIdentity}:test:${testId}:attempt:${attemptId}`;
};

// Test-only helpers.
const resetMemoryCounters = () => memoryCounters.clear();
const getMemoryCounterSize = () => memoryCounters.size;

module.exports = {
  createRateLimiter,
  consumeRateLimit,
  releaseRateLimit,
  getActorIdentity,
  authKeyByIp,
  refreshKeyBySession,
  examWriteKey,
  resetMemoryCounters,
  getMemoryCounterSize,
  MEMORY_COUNTER_MAX_KEYS,
};
