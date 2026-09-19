const crypto = require("crypto");
const { redisClient, isRedisAvailable } = require("../config/redis");
const { verifyAccessToken } = require("../utils/token");

const memoryStore = new Map();
const memoryTagIndex = new Map();
const cacheLogThrottle = new Map();

const CACHE_LOG_THROTTLE_MS = 60000;

const isProduction = () => process.env.NODE_ENV === "production";

const hash = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

const getPathname = (originalUrl = "") => {
  const [pathname] = String(originalUrl).split("?");
  return pathname || "/";
};

const getRequestActor = (req) => {
  if (req.admin?.id) {
    return `admin:${req.admin.id}`;
  }

  if (req.superAdmin?.id) {
    return `super-admin:${req.superAdmin.id}`;
  }

  if (req.user?.id) {
    return `student:${req.user.id}`;
  }

  if (req.student?.id) {
    return `student:${req.student.id}`;
  }

  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return `ip:${req.ip || "unknown"}`;
  }

  try {
    const payload = verifyAccessToken(authHeader.slice(7));
    const role = payload?.role || "ANON";
    const id = payload?.sub || payload?.id || req.ip || "unknown";
    return `${role}:${id}`;
  } catch {
    return `ip:${req.ip || "unknown"}`;
  }
};

const getTenantScope = (req) => {
  if (req.admin?.collegeId) {
    return `college:${req.admin.collegeId}`;
  }

  if (req.user?.collegeId) {
    return `college:${req.user.collegeId}`;
  }

  if (req.student?.collegeId) {
    return `college:${req.student.collegeId}`;
  }

  if (req.collegeId) {
    return `college:${req.collegeId}`;
  }

  if (req.superAdmin?.id) {
    return `super-admin:${req.superAdmin.id}`;
  }

  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  try {
    const payload = verifyAccessToken(authHeader.slice(7));
    if (payload?.collegeId) {
      return `college:${payload.collegeId}`;
    }
  } catch {
    return null;
  }

  return null;
};

const hasAuthenticatedContext = (req) =>
  Boolean(req.authIdentity || req.admin?.id || req.superAdmin?.id || req.user?.id || req.student?.id);

const shouldLogCacheEvent = (key) => {
  const now = Date.now();
  const last = cacheLogThrottle.get(key) || 0;
  if (now - last < CACHE_LOG_THROTTLE_MS) return false;
  cacheLogThrottle.set(key, now);
  return true;
};

const logCacheEvent = (level, message, meta = {}) => {
  const key = `${level}:${meta.scope || ""}:${meta.path || ""}`;
  if (!shouldLogCacheEvent(key)) return;
  const payload = {
    scope: meta.scope,
    path: meta.path,
    actor: meta.actor,
    reason: meta.reason,
  };
  if (level === "warn") {
    console.warn(message, payload);
    return;
  }
  console.info(message, payload);
};

const buildCacheKey = ({ req, scope, keyBuilder }) => {
  try {
    const rawKey = keyBuilder
      ? keyBuilder(req)
      : `${req.method}:${getPathname(req.originalUrl)}:${JSON.stringify(req.query || {})}:${getRequestActor(req)}`;

    if (!rawKey) return null;
    const tenantScope = getTenantScope(req);
    const actorScope = tenantScope ? null : `actor:${getRequestActor(req)}`;
    if (!tenantScope) {
      logCacheEvent("info", "Response cache using actor scope (no tenant scope).", {
        scope,
        path: getPathname(req.originalUrl),
        actor: actorScope,
        reason: "tenant-scope-missing",
      });
    }
    const namespace = tenantScope || actorScope;
    return `resp_cache:${namespace}:${scope}:${hash(rawKey)}`;
  } catch {
    logCacheEvent("warn", "Response cache key build failed.", {
      scope,
      path: getPathname(req.originalUrl),
      reason: "key-build-failed",
    });
    return null;
  }
};

const setMemoryCache = (key, value, ttlSeconds, tags) => {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  memoryStore.set(key, { value, expiresAt, tags });

  for (const tag of tags) {
    const current = memoryTagIndex.get(tag) || new Set();
    current.add(key);
    memoryTagIndex.set(tag, current);
  }
};

const getMemoryCache = (key) => {
  const entry = memoryStore.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }

  return entry.value;
};

const setRedisCache = async (key, payload, ttlSeconds, tags) => {
  await redisClient.set(key, JSON.stringify(payload), "EX", ttlSeconds);

  for (const tag of tags) {
    const tagKey = `resp_cache_tag:${tag}`;
    await redisClient.sadd(tagKey, key);
    await redisClient.expire(tagKey, Math.max(ttlSeconds * 4, ttlSeconds));
  }
};

const getRedisCache = async (key) => {
  const raw = await redisClient.get(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const createResponseCache = ({
  scope,
  ttlSeconds = 30,
  enabled = true,
  keyBuilder,
  tagsBuilder,
  shouldCache,
  skip,
  requireAuthenticated = true,
}) => (req, res, next) => {
  if (!enabled || req.method !== "GET") {
    return next();
  }

  if (typeof skip === "function" && skip(req)) {
    return next();
  }

  if (requireAuthenticated && !hasAuthenticatedContext(req)) {
    return next();
  }

  // Compute cache key lazily to ensure authentication middleware has populated req
  const computeCacheKey = () => {
    try {
      const key = buildCacheKey({ req, scope, keyBuilder });
      // If keyBuilder intentionally returns null/undefined, treat as not cacheable
      if (!key) return null;
      return key;
    } catch {
      return null;
    }
  };

  const readFromCache = async () => {
    const cacheKey = computeCacheKey();
    if (!cacheKey) return null;

    if (!isRedisAvailable()) {
      if (isProduction()) return null;
      return getMemoryCache(cacheKey);
    }

    try {
      return await getRedisCache(cacheKey);
    } catch {
      if (isProduction()) return null;
      return getMemoryCache(cacheKey);
    }
  };

  const writeToCache = async (payload, tags) => {
    const cacheKey = computeCacheKey();
    if (!cacheKey) return; // skip storing if we can't compute a stable key

    if (!isRedisAvailable()) {
      if (isProduction()) return;
      setMemoryCache(cacheKey, payload, ttlSeconds, tags);
      return;
    }

    try {
      await setRedisCache(cacheKey, payload, ttlSeconds, tags);
    } catch {
      if (isProduction()) return;
      setMemoryCache(cacheKey, payload, ttlSeconds, tags);
    }
  };

  readFromCache()
    .then((cached) => {
      if (cached) {
        res.setHeader("X-Response-Cache", "HIT");
        if (cached.headers && typeof cached.headers === "object") {
          for (const [headerName, headerValue] of Object.entries(cached.headers)) {
            if (headerValue) {
              res.setHeader(headerName, headerValue);
            }
          }
        }
        return res.status(cached.statusCode || 200).json(cached.body);
      }

      res.setHeader("X-Response-Cache", "MISS");
      const originalJson = res.json.bind(res);

      res.json = (body) => {
        const canStore =
          res.statusCode >= 200 &&
          res.statusCode < 300 &&
          (typeof shouldCache !== "function" || shouldCache(req, res, body));

        if (canStore) {
          const tags = Array.isArray(tagsBuilder) ? tagsBuilder : typeof tagsBuilder === "function" ? tagsBuilder(req, res, body) : [];
          const normalizedTags = Array.from(new Set(tags.filter(Boolean)));
          const payload = {
            statusCode: res.statusCode,
            body,
            headers: {
              "Cache-Control": res.getHeader("Cache-Control") || undefined,
            },
          };

          writeToCache(payload, normalizedTags).catch(() => {});
        }

        return originalJson(body);
      };

      return next();
    })
    .catch(() => next());
};

const invalidateResponseCacheByTags = async (tags = []) => {
  const normalizedTags = Array.from(new Set((tags || []).filter(Boolean)));
  if (normalizedTags.length === 0) {
    return;
  }

  if (!isRedisAvailable()) {
    if (isProduction()) {
      return;
    }
    for (const tag of normalizedTags) {
      const keys = memoryTagIndex.get(tag) || new Set();
      for (const key of keys) {
        memoryStore.delete(key);
      }
      memoryTagIndex.delete(tag);
    }
    return;
  }

  try {
    const tagKeys = normalizedTags.map((tag) => `resp_cache_tag:${tag}`);
    const memberArrays = await Promise.all(tagKeys.map((tagKey) => redisClient.smembers(tagKey)));
    const keysToDelete = Array.from(new Set(memberArrays.flat()));

    const pipeline = redisClient.pipeline();
    if (keysToDelete.length > 0) {
      pipeline.del(...keysToDelete);
    }
    pipeline.del(...tagKeys);
    await pipeline.exec();
  } catch {
    // Keep invalidation fail-open.
  }
};

const createResponseCacheInvalidationHook = () => (req, res, next) => {
  res.on("finish", () => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return;
    }

    if (res.statusCode >= 400) {
      return;
    }

    const pathname = getPathname(req.originalUrl);
    const tags = [];

    if ((pathname.startsWith("/api/admin/") || pathname.startsWith("/api/college-admin/")) && req.admin?.collegeId) {
      const collegeTag = `college:${req.admin.collegeId}`;
      tags.push(
        `admin-collections:${collegeTag}`,
        `admin-dashboard:${collegeTag}`,
        `admin-reports:${collegeTag}`,
        `admin-analytics:${collegeTag}`,
        `admin-search:${collegeTag}`,
        `admin-settings:${collegeTag}`
      );
    }

    if (
      pathname.startsWith("/api/admin/reports") ||
      pathname.startsWith("/api/college-admin/reports") ||
      pathname.startsWith("/api/admin/tests") ||
      pathname.startsWith("/api/college-admin/tests") ||
      pathname.startsWith("/api/tests") ||
      pathname.startsWith("/api/attempts")
    ) {
      tags.push("admin-reports:all");
      if (req.admin?.collegeId) {
        tags.push(`admin-reports:college:${req.admin.collegeId}`);
      }

      tags.push("student-tests:all", "student-dashboard:all", "super-dashboard:all");

      if (req.user?.id) {
        tags.push(`student-tests:user:${req.user.id}`, `student-dashboard:user:${req.user.id}`);
      }
      if (req.user?.collegeId) {
        tags.push(
          `student-tests:college:${req.user.collegeId}`,
          `student-dashboard:college:${req.user.collegeId}`,
          // A student action (e.g. submit) changes admin-facing counts too, so
          // bust the admin dashboard/collection caches for that college.
          `admin-dashboard:college:${req.user.collegeId}`,
          `admin-collections:college:${req.user.collegeId}`
        );
      }

      if (req.admin?.collegeId) {
        tags.push(
          `student-tests:college:${req.admin.collegeId}`,
          `student-dashboard:college:${req.admin.collegeId}`,
          `admin-dashboard:college:${req.admin.collegeId}`
        );
      }
    }

    if (
      pathname.startsWith("/api/super-admin/reports") ||
      pathname.startsWith("/api/superadmin/reports") ||
      pathname.startsWith("/api/super-admin/analytics") ||
      pathname.startsWith("/api/superadmin/analytics") ||
      pathname.startsWith("/api/super-admin/tests") ||
      pathname.startsWith("/api/superadmin/tests")
    ) {
      tags.push("super-analytics:all", "super-dashboard:all");
    }

    if (tags.length > 0) {
      invalidateResponseCacheByTags(tags).catch(() => {});
    }
  });

  next();
};

module.exports = {
  createResponseCache,
  createResponseCacheInvalidationHook,
  invalidateResponseCacheByTags,
};
