const crypto = require("crypto");
const { redisClient, isRedisAvailable } = require("../config/redis");

const METRIC_TTL_SECONDS = 24 * 60 * 60;
const EXAM_SCOPE_PREFIX = "student-exam-";

const createMetricBucket = () => ({
  routes: new Map(),
  actors: new Map(),
  scopes: new Map(),
  totalBlocked: 0,
});

const memoryMetrics = {
  routes: new Map(),
  actors: new Map(),
  scopes: new Map(),
  totalBlocked: 0,
  exam: {
    global: createMetricBucket(),
    byCollege: new Map(),
  },
};

const hashValue = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);

const sanitizeActor = (actor) => {
  const raw = String(actor || "unknown");
  if (raw.startsWith("user:")) {
    const [kind, role, id] = raw.split(":");
    return `${kind}:${role || "UNKNOWN"}:${hashValue(id || "")}`;
  }

  if (raw.startsWith("ip:")) {
    return `ip:${hashValue(raw.slice(3))}`;
  }

  return hashValue(raw);
};

const incrementMemoryMetric = (map, key) => {
  map.set(key, Number(map.get(key) || 0) + 1);
};

const incrementMetricBucket = (bucket, { route, actor, scope }) => {
  bucket.totalBlocked += 1;
  incrementMemoryMetric(bucket.routes, route);
  incrementMemoryMetric(bucket.actors, actor);
  incrementMemoryMetric(bucket.scopes, scope);
};

const topFromMap = (map, limit) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, blocked]) => ({ label, blocked }));

const toPairs = (items) => {
  const pairs = [];
  for (let i = 0; i < items.length; i += 2) {
    pairs.push({ label: items[i], blocked: Number(items[i + 1] || 0) });
  }
  return pairs;
};

const normalizeCollegeId = (collegeId) => {
  const value = String(collegeId || "").trim();
  return value || null;
};

const isExamScope = (scope) => String(scope || "").startsWith(EXAM_SCOPE_PREFIX);

const getExamCollegeBucket = (collegeId) => {
  const safeCollegeId = normalizeCollegeId(collegeId);
  if (!safeCollegeId) {
    return null;
  }

  if (!memoryMetrics.exam.byCollege.has(safeCollegeId)) {
    memoryMetrics.exam.byCollege.set(safeCollegeId, createMetricBucket());
  }

  return memoryMetrics.exam.byCollege.get(safeCollegeId);
};

const createSnapshot = ({ source, totalBlocked, topRoutes, topActors, topScopes, extra = {} }) => ({
  generatedAt: new Date().toISOString(),
  source,
  totalBlocked,
  topRoutes,
  topActors,
  topScopes,
  ...extra,
});

const createMemorySnapshotFromBucket = ({ bucket, source, limit, extra }) =>
  createSnapshot({
    source,
    totalBlocked: bucket.totalBlocked,
    topRoutes: topFromMap(bucket.routes, limit),
    topActors: topFromMap(bucket.actors, limit),
    topScopes: topFromMap(bucket.scopes, limit),
    extra,
  });

const getCollegeMetricPrefix = (collegeId) => {
  const safeCollegeId = normalizeCollegeId(collegeId);
  if (!safeCollegeId) {
    return null;
  }

  return `rate_metrics:exam:college:${hashValue(safeCollegeId)}`;
};

const ensureRedisMetricKey = async (key) => {
  const ttl = await redisClient.ttl(key);
  if (ttl < 0) {
    await redisClient.expire(key, METRIC_TTL_SECONDS);
  }
};

const buildRedisSnapshot = async ({ source, totalKey, routesKey, actorsKey, scopesKey, limit, extra }) => {
  const [totalBlockedRaw, topRoutesRaw, topActorsRaw, topScopesRaw] = await Promise.all([
    redisClient.get(totalKey),
    redisClient.zrevrange(routesKey, 0, limit - 1, "WITHSCORES"),
    redisClient.zrevrange(actorsKey, 0, limit - 1, "WITHSCORES"),
    redisClient.zrevrange(scopesKey, 0, limit - 1, "WITHSCORES"),
  ]);

  return createSnapshot({
    source,
    totalBlocked: Number(totalBlockedRaw || 0),
    topRoutes: toPairs(topRoutesRaw),
    topActors: toPairs(topActorsRaw),
    topScopes: toPairs(topScopesRaw),
    extra,
  });
};

const recordRateLimitEvent = async ({ scope, route, actor, collegeId }) => {
  const safeScope = String(scope || "global");
  const safeRoute = String(route || "unknown-route");
  const safeActor = sanitizeActor(actor);
  const safeCollegeId = normalizeCollegeId(collegeId);

  memoryMetrics.totalBlocked += 1;
  incrementMemoryMetric(memoryMetrics.routes, safeRoute);
  incrementMemoryMetric(memoryMetrics.actors, safeActor);
  incrementMemoryMetric(memoryMetrics.scopes, safeScope);

  if (isExamScope(safeScope)) {
    incrementMetricBucket(memoryMetrics.exam.global, {
      route: safeRoute,
      actor: safeActor,
      scope: safeScope,
    });

    const collegeBucket = getExamCollegeBucket(safeCollegeId);
    if (collegeBucket) {
      incrementMetricBucket(collegeBucket, {
        route: safeRoute,
        actor: safeActor,
        scope: safeScope,
      });
    }
  }

  if (!isRedisAvailable()) {
    return;
  }

  try {
    const increments = [
      redisClient.zincrby("rate_metrics:routes", 1, safeRoute),
      redisClient.zincrby("rate_metrics:actors", 1, safeActor),
      redisClient.zincrby("rate_metrics:scopes", 1, safeScope),
      redisClient.incr("rate_metrics:total_blocked"),
    ];
    const keysToTouch = [
      "rate_metrics:routes",
      "rate_metrics:actors",
      "rate_metrics:scopes",
      "rate_metrics:total_blocked",
    ];

    if (isExamScope(safeScope)) {
      increments.push(
        redisClient.zincrby("rate_metrics:exam:routes", 1, safeRoute),
        redisClient.zincrby("rate_metrics:exam:actors", 1, safeActor),
        redisClient.zincrby("rate_metrics:exam:scopes", 1, safeScope),
        redisClient.incr("rate_metrics:exam:total_blocked")
      );
      keysToTouch.push(
        "rate_metrics:exam:routes",
        "rate_metrics:exam:actors",
        "rate_metrics:exam:scopes",
        "rate_metrics:exam:total_blocked"
      );

      const collegePrefix = getCollegeMetricPrefix(safeCollegeId);
      if (collegePrefix) {
        increments.push(
          redisClient.zincrby(`${collegePrefix}:routes`, 1, safeRoute),
          redisClient.zincrby(`${collegePrefix}:actors`, 1, safeActor),
          redisClient.zincrby(`${collegePrefix}:scopes`, 1, safeScope),
          redisClient.incr(`${collegePrefix}:total_blocked`)
        );
        keysToTouch.push(
          `${collegePrefix}:routes`,
          `${collegePrefix}:actors`,
          `${collegePrefix}:scopes`,
          `${collegePrefix}:total_blocked`
        );
      }
    }

    await Promise.all(increments);

    await Promise.all(keysToTouch.map((key) => ensureRedisMetricKey(key)));
  } catch {
    // Keep request flow fail-open for metrics collection.
  }
};

const getRateLimitMetricsSnapshot = async ({ limit = 10 } = {}) => {
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 10;

  if (!isRedisAvailable()) {
    return createSnapshot({
      source: "memory",
      totalBlocked: memoryMetrics.totalBlocked,
      topRoutes: topFromMap(memoryMetrics.routes, safeLimit),
      topActors: topFromMap(memoryMetrics.actors, safeLimit),
      topScopes: topFromMap(memoryMetrics.scopes, safeLimit),
    });
  }

  try {
    return await buildRedisSnapshot({
      source: "redis",
      totalKey: "rate_metrics:total_blocked",
      routesKey: "rate_metrics:routes",
      actorsKey: "rate_metrics:actors",
      scopesKey: "rate_metrics:scopes",
      limit: safeLimit,
    });
  } catch {
    return createSnapshot({
      source: "memory-fallback",
      totalBlocked: memoryMetrics.totalBlocked,
      topRoutes: topFromMap(memoryMetrics.routes, safeLimit),
      topActors: topFromMap(memoryMetrics.actors, safeLimit),
      topScopes: topFromMap(memoryMetrics.scopes, safeLimit),
    });
  }
};

const getExamRateLimitMetricsSnapshot = async ({ limit = 10, collegeId = null } = {}) => {
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 10;
  const safeCollegeId = normalizeCollegeId(collegeId);
  const extra = {
    scopeFamily: "exam",
    collegeScoped: Boolean(safeCollegeId),
    windowHours: 24,
  };

  if (!isRedisAvailable()) {
    const bucket = safeCollegeId
      ? (memoryMetrics.exam.byCollege.get(safeCollegeId) || createMetricBucket())
      : memoryMetrics.exam.global;

    return createMemorySnapshotFromBucket({
      bucket,
      source: "memory",
      limit: safeLimit,
      extra,
    });
  }

  try {
    const collegePrefix = getCollegeMetricPrefix(safeCollegeId);
    const prefix = collegePrefix || "rate_metrics:exam";

    return await buildRedisSnapshot({
      source: "redis",
      totalKey: `${prefix}:total_blocked`,
      routesKey: `${prefix}:routes`,
      actorsKey: `${prefix}:actors`,
      scopesKey: `${prefix}:scopes`,
      limit: safeLimit,
      extra,
    });
  } catch {
    const bucket = safeCollegeId
      ? (memoryMetrics.exam.byCollege.get(safeCollegeId) || createMetricBucket())
      : memoryMetrics.exam.global;

    return createMemorySnapshotFromBucket({
      bucket,
      source: "memory-fallback",
      limit: safeLimit,
      extra,
    });
  }
};

module.exports = {
  recordRateLimitEvent,
  getRateLimitMetricsSnapshot,
  getExamRateLimitMetricsSnapshot,
};
