const crypto = require("crypto");
const { redisClient, isRedisAvailable } = require("../config/redis");
const { verifyAccessToken } = require("../utils/token");
const { recordRateLimitEvent } = require("../services/rate-limit-metrics.service");

const memoryCounters = new Map();

const isProduction = () => process.env.NODE_ENV === "production";

const isRateLimitDisabled = () => {
  if (process.env.NODE_ENV === "test") {
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

const formatIdentity = (kind, id, role) => {
  if (!id) {
    return null;
  }

  if (role) {
    return `user:${String(role).toUpperCase()}:${id}`;
  }

  return `${kind}:${id}`;
};

const getClientIp = (req) => {
  const header = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return header || req.ip || req.socket?.remoteAddress || "unknown";
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

  const authHeader = String(req.headers.authorization || "");
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

const cleanExpiredMemoryCounters = () => {
  const now = Date.now();
  for (const [key, value] of memoryCounters.entries()) {
    if (!value || value.resetAt <= now) {
      memoryCounters.delete(key);
    }
  }
};

const hitMemoryCounter = (key, windowMs) => {
  const now = Date.now();
  const current = memoryCounters.get(key);

  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + windowMs };
    memoryCounters.set(key, next);
    if (memoryCounters.size > 10_000) {
      cleanExpiredMemoryCounters();
    }
    return { count: next.count, remainingMs: windowMs };
  }

  current.count += 1;
  return { count: current.count, remainingMs: Math.max(1, current.resetAt - now) };
};

const hitRedisCounter = async (key, windowMs) => {
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.pexpire(key, windowMs);
  }

  let ttl = await redisClient.pttl(key);
  if (ttl < 0) {
    await redisClient.set(key, "1", "PX", windowMs);
    ttl = windowMs;
    return {
      count: 1,
      remainingMs: ttl,
    };
  }

  return {
    count,
    remainingMs: ttl,
  };
};

const createRedisRequiredError = () => {
  const error = new Error("Redis is required for rate limiting in production");
  error.statusCode = 503;
  error.code = "RATE_LIMIT_REDIS_REQUIRED";
  return error;
};

const hitCounter = async (key, windowMs) => {
  if (isRedisAvailable()) {
    return hitRedisCounter(key, windowMs);
  }

  if (isProduction()) {
    throw createRedisRequiredError();
  }

  return hitMemoryCounter(key, windowMs);
};

const applyRateLimitHeaders = (res, max, remaining, resetAfterMs) => {
  const safeRemaining = Math.max(0, remaining);
  const resetSeconds = Math.ceil(resetAfterMs / 1000);

  res.setHeader("RateLimit-Limit", String(max));
  res.setHeader("RateLimit-Remaining", String(safeRemaining));
  res.setHeader("RateLimit-Reset", String(resetSeconds));
  res.setHeader("Retry-After", String(resetSeconds));
};

const createRateLimiter = (options = {}) => {
  const max = toSafePositiveInt(options.max, 120);
  const windowMs = toSafePositiveInt(options.windowMs, 60_000);

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

    const key = buildKey(req, options);

    try {
      const hit = await hitCounter(key, windowMs);

      const remaining = max - hit.count;
      applyRateLimitHeaders(res, max, remaining, hit.remainingMs);

      if (hit.count > max) {
        recordRateLimitEvent({
          scope: options.scope || "global",
          route: getRouteLabel(req, options),
          actor: getActorIdentity(req),
          collegeId: req.user?.collegeId || req.admin?.collegeId || req.collegeId || null,
        }).catch(() => {});

        return res.status(429).json({
          message: options.message || "Too many requests. Please slow down and try again shortly.",
          code: "RATE_LIMIT_EXCEEDED",
          requestId: req.id || req.headers["x-request-id"] || null,
          details: {
            scope: options.scope || "global",
            retryAfterSeconds: Math.ceil(hit.remainingMs / 1000),
          },
        });
      }

      return next();
    } catch (error) {
      if (!isProduction() && options.failOpen !== false) {
        return next();
      }

      return next(error);
    }
  };
};

const authKeyByIp = (req) => `ip:${getClientIp(req)}`;

const examWriteKey = (req, actorIdentity) => {
  const testId = req.params?.testId || req.body?.testId || req.body?.test_id || "unknown-test";
  const attemptId = req.params?.attemptId || req.params?.attempt_id || req.body?.submissionId || req.body?.attemptId || "unknown-attempt";
  return `${actorIdentity}:test:${testId}:attempt:${attemptId}`;
};

module.exports = {
  createRateLimiter,
  getActorIdentity,
  authKeyByIp,
  examWriteKey,
};
