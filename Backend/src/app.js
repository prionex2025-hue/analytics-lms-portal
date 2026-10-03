const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const compression = require("compression");

const env = require("./config/env");
const { CORS_ALLOWED_HEADERS, CORS_EXPOSED_HEADERS } = require("./config/cors");

// RATE_LIMIT_DISABLED=true (k6/load tests only) is honoured inside
// createRateLimiter itself; it is ignored under NODE_ENV=test.
const mongoose = require("mongoose");
const { getRedisHealthSnapshot } = require("./config/redis");
const { isShuttingDown } = require("./utils/lifecycle");
const studentAuthRoutes = require("./routes/Students/auth.routes");
const studentDashboardRoutes = require("./routes/Students/dashboard.routes");
const studentTestsRoutes = require("./routes/Students/tests.routes");
const studentTestsCompatRoutes = require("./routes/Students/tests-compat.routes");
const studentEventsRoutes = require("./routes/Students/events.routes");
const studentReportsRoutes = require("./routes/Students/reports.routes");
const studentLeaderboardRoutes = require("./routes/Students/leaderboard.routes");
const studentProfileRoutes = require("./routes/Students/profile.routes");
const studentMeRoutes = require("./routes/Students/me.routes");
const adminAuthRoutes = require("./routes/Admin/auth.routes");
const adminDashboardRoutes = require("./routes/Admin/dashboard.routes");
const adminTestsRoutes = require("./routes/Admin/tests.routes");
const adminQuestionBankRoutes = require("./routes/Admin/question-bank.routes");
const adminSubjectsRoutes = require("./routes/Admin/subjects.routes");
const adminStudentsRoutes = require("./routes/Admin/students.routes");
const adminDepartmentsRoutes = require("./routes/Admin/departments.routes");
const adminBatchesRoutes = require("./routes/Admin/batches.routes");
const adminEventsRoutes = require("./routes/Admin/events.routes");
const adminReportsRoutes = require("./routes/Admin/reports.routes");
const adminJobsRoutes = require("./routes/Admin/jobs.routes");
const adminSearchRoutes = require("./routes/Admin/search.routes");
const adminSettingsRoutes = require("./routes/Admin/settings.routes");
const adminAdminsRoutes = require("./routes/Admin/admins.routes");
const adminAnalyticsRoutes = require("./routes/Admin/analytics.routes");
const superAdminAuthRoutes = require("./routes/SuperAdmin/auth.routes");
const superAdminDashboardRoutes = require("./routes/SuperAdmin/dashboard.routes");
const superAdminSystemAdminsRoutes = require("./routes/SuperAdmin/system-admins.routes");
const superAdminCollegesRoutes = require("./routes/SuperAdmin/colleges.routes");
const superAdminAdminsRoutes = require("./routes/SuperAdmin/admins.routes");
const superAdminStudentsRoutes = require("./routes/SuperAdmin/students.routes");
const superAdminTestsRoutes = require("./routes/SuperAdmin/tests.routes");
const superAdminBatchesRoutes = require("./routes/SuperAdmin/batches.routes");
const superAdminDepartmentsRoutes = require("./routes/SuperAdmin/departments.routes");
const superAdminEventsRoutes = require("./routes/SuperAdmin/events.routes");
const superAdminReportsRoutes = require("./routes/SuperAdmin/reports.routes");
const superAdminAnalyticsRoutes = require("./routes/SuperAdmin/analytics.routes");
const superAdminSettingsRoutes = require("./routes/SuperAdmin/settings.routes");
const superAdminHealthRoutes = require("./routes/SuperAdmin/health.routes");
const superAdminQuestionBankRoutes = require("./routes/SuperAdmin/question-bank.routes");
const superAdminSubjectsRoutes = require("./routes/SuperAdmin/subjects.routes");
const { createResourcesRouter } = require("./modules/resources/routes/resources.routes");
const { recordApiMetric } = require("./services/api-metrics.service");
const { createRateLimiter, authKeyByIp } = require("./middleware/rate-limit");
const { requestIdMiddleware } = require("./middleware/request-id");
const { metricsAuth } = require("./middleware/metrics-auth");
const { createResponseCache, createResponseCacheInvalidationHook } = require("./middleware/response-cache");
const { notFound, errorHandler } = require("./middleware/error-handler");
const { setupCompleteValidationSystem } = require("./config/validation-integration.setup");
const { getDb } = require("./utils/db");
const { ApiError, asyncHandler } = require("./utils/http");
const { getPrometheusMetrics } = require("./services/prometheus-metrics.service");
const { recordRumMetric } = require("./services/rum-metrics.service");
const {
  authenticateAdmin,
  authenticateCollegeAdmin,
  authenticateStudent,
  authenticateSuperAdmin,
} = require("./middleware/auth");

const app = express();
app.set("trust proxy", env.trustProxy);

morgan.token("request-id", (req) => req.id || "-");

const studentResourcesRoutes = createResourcesRouter();
const adminResourcesRoutes = createResourcesRouter({ managementEnabled: true, analyticsEnabled: true });
const collegeAdminResourcesRoutes = createResourcesRouter({ managementEnabled: true, analyticsEnabled: true });
const superAdminResourcesRoutes = createResourcesRouter({ managementEnabled: true, analyticsEnabled: true });
const superAdminResourcesAliasRoutes = createResourcesRouter({ managementEnabled: true, analyticsEnabled: true });

const getApiRelativePath = (req) =>
  String(req.originalUrl || req.path || "")
    .split("?")[0]
    .replace(/^\/api(?=\/|$)/, "") || "/";

// Auth endpoints with their own dedicated limiters (middleware/auth-rate-limits.js).
// Everything else under /auth (logout, /me) stays under the general limit.
const DEDICATED_AUTH_LIMIT_PATTERN =
  /^\/(?:admin\/|college-admin\/|super-admin\/|superadmin\/)?auth\/(?:login|refresh|forgot-password|reset-password)\/?$/;
const SUPER_ADMIN_PATH_PATTERN = /^\/(?:super-admin|superadmin)(?:\/|$)/;

const shouldSkipGeneralApiLimit = (req) => {
  const path = getApiRelativePath(req);
  return (
    DEDICATED_AUTH_LIMIT_PATTERN.test(path) ||
    // Super admin traffic has its own (higher) per-user budget below.
    SUPER_ADMIN_PATH_PATTERN.test(path)
  );
};

// Baseline per-principal budget for every /api request (per user when the
// access token is valid, otherwise per IP). Route files add tighter limits
// for expensive or sensitive operations.
const generalApiLimiter = createRateLimiter({
  scope: "api-general",
  routeLabel: "/api/*",
  windowMs: env.rateLimit.generalApiWindowMs,
  max: env.rateLimit.generalApiMax,
  skip: shouldSkipGeneralApiLimit,
  message: "Too many requests. Please slow down and try again.",
});

const rumLimiter = createRateLimiter({
  scope: "rum",
  routeLabel: "/api/rum",
  windowMs: 60 * 1000,
  max: 120,
  keySelector: authKeyByIp,
  message: "Too many metrics requests.",
});

const collegeAdminApiLimiter = createRateLimiter({
  scope: "college-admin-api",
  routeLabel: "/api/college-admin/*",
  windowMs: env.rateLimit.collegeAdminApiWindowMs,
  max: env.rateLimit.collegeAdminApiMax,
  // Mounted with app.use("/api/college-admin"), so req.path is relative;
  // match on the full URL instead.
  skip: (req) => DEDICATED_AUTH_LIMIT_PATTERN.test(getApiRelativePath(req)),
  message: "College admin API is rate limited. Please retry shortly.",
});

const superAdminApiLimiter = createRateLimiter({
  scope: "super-admin-api",
  routeLabel: "/api/super-admin/*",
  windowMs: env.rateLimit.superAdminApiWindowMs,
  max: env.rateLimit.superAdminApiMax,
  skip: (req) => DEDICATED_AUTH_LIMIT_PATTERN.test(getApiRelativePath(req)),
  message: "Super admin API is rate limited. Please retry shortly.",
});

const normalizeQueryParams = (query = {}) =>
  Object.keys(query)
    .sort()
    .reduce((accumulator, key) => {
      accumulator[key] = query[key];
      return accumulator;
    }, {});

const buildCollegeAdminCacheKey = (req) =>
  JSON.stringify({
    path: String(req.originalUrl || "").split("?")[0],
    query: normalizeQueryParams(req.query || {}),
    adminId: req.admin?.id || null,
    collegeId: req.admin?.collegeId || req.collegeId || null,
    departmentId: req.admin?.departmentId || null,
    role: req.admin?.role || null,
    permissions: Array.isArray(req.admin?.permissions) ? [...req.admin.permissions].sort() : [],
    accessProfile: req.admin?.accessProfile || null,
  });

const isLiveMonitoringRequest = (req) =>
  /\/tests\/[^/]+\/monitoring(?:\/|$)/.test(String(req.path || ""));

// File downloads must never be served from the response cache: they are
// generated per request and are not JSON payloads.
const isReportDownloadRequest = (req) =>
  /\/reports\/export\.(csv|xlsx)$/.test(String(req.path || "")) || /\/reports\/[^/]+\/download$/.test(String(req.path || ""));

const shouldSkipAdminResponseCache = (req) => isLiveMonitoringRequest(req) || isReportDownloadRequest(req);

const createCollegeAdminCache = ({ scope, ttlSeconds, tagPrefix }) =>
  createResponseCache({
    scope,
    enabled: env.responseCache.enabled,
    ttlSeconds,
    skip: shouldSkipAdminResponseCache,
    keyBuilder: buildCollegeAdminCacheKey,
    tagsBuilder: (req) => [
      `${tagPrefix}:all`,
      req.admin?.collegeId ? `${tagPrefix}:college:${req.admin.collegeId}` : null,
    ],
  });

const adminReportsCache = createCollegeAdminCache({
  scope: "admin-reports",
  ttlSeconds: env.responseCache.adminReportsTtlSeconds,
  tagPrefix: "admin-reports",
});

const adminAnalyticsCache = createCollegeAdminCache({
  scope: "admin-analytics",
  ttlSeconds: env.responseCache.adminAnalyticsTtlSeconds,
  tagPrefix: "admin-analytics",
});

const adminCollectionCache = createCollegeAdminCache({
  scope: "admin-collections",
  ttlSeconds: env.responseCache.adminCollectionsTtlSeconds,
  tagPrefix: "admin-collections",
});

const adminSettingsCache = createCollegeAdminCache({
  scope: "admin-settings",
  ttlSeconds: env.responseCache.adminCollectionsTtlSeconds,
  tagPrefix: "admin-settings",
});

const superAnalyticsCache = createResponseCache({
  scope: "super-analytics",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.superAnalyticsTtlSeconds,
  tagsBuilder: () => ["super-analytics:all"],
});

const studentDashboardCache = createResponseCache({
  scope: "student-dashboard",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.studentDashboardTtlSeconds,
  tagsBuilder: (req) => [
    "student-dashboard:all",
    req.user?.id ? `student-dashboard:user:${req.user.id}` : null,
    req.user?.collegeId ? `student-dashboard:college:${req.user.collegeId}` : null,
  ],
});

const studentTestsCache = createResponseCache({
  scope: "student-tests",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.studentTestsTtlSeconds,
  tagsBuilder: (req) => [
    "student-tests:all",
    req.user?.id ? `student-tests:user:${req.user.id}` : null,
    req.user?.collegeId ? `student-tests:college:${req.user.collegeId}` : null,
  ],
});

const adminDashboardCache = createResponseCache({
  scope: "admin-dashboard",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.adminDashboardTtlSeconds,
  keyBuilder: buildCollegeAdminCacheKey,
  tagsBuilder: (req) => [
    "admin-dashboard:all",
    req.admin?.collegeId ? `admin-dashboard:college:${req.admin.collegeId}` : null,
  ],
});

const superDashboardCache = createResponseCache({
  scope: "super-dashboard",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.superDashboardTtlSeconds,
  tagsBuilder: () => ["super-dashboard:all"],
});

// Cache system health checks for 15s - prevents redundant DB/Redis/disk
// probes when multiple super admins have the dashboard open.
const systemHealthCache = createResponseCache({
  scope: "system-health",
  enabled: env.responseCache.enabled,
  ttlSeconds: 15,
  tagsBuilder: () => ["system-health:all"],
});

const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} check timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const checkMongo = async () => {
  try {
    await withTimeout(
      (async () => {
        await getDb();
        await mongoose.connection.db.admin().command({ ping: 1 });
      })(),
      env.database.readinessTimeoutMs,
      "mongodb"
    );
    return "ok";
  } catch {
    return "down";
  }
};

// Readiness: can this instance serve traffic right now?
//  - MongoDB is required (nothing works without it).
//  - Redis is required in production: shared rate limits and access-token
//    revocation fail closed when Redis is unavailable. Keep every API replica
//    out of service until the shared security state is available again.
//  - During graceful shutdown the instance reports not-ready so it drains.
const buildCoreHealthSnapshot = async () => {
  if (isShuttingDown()) {
    return { ready: false, body: { status: "shutting_down" } };
  }

  const [mongodb, redisHealth] = await Promise.all([checkMongo(), getRedisHealthSnapshot()]);
  const redis = redisHealth.configured ? (redisHealth.available ? "ok" : "down") : "disabled";
  const redisBlocksReadiness = env.redis.requiredForReadiness && redis !== "ok";
  const ready = mongodb === "ok" && !redisBlocksReadiness;
  const degraded = ready && redis === "down";

  return {
    ready,
    // Public, unauthenticated endpoint: dependency status only. No hosts,
    // latencies, versions or error text (super admins get detail via
    // /api/super-admin/system/health).
    body: {
      status: !ready ? "unavailable" : degraded ? "degraded" : "ok",
      checks: { mongodb, redis },
      uptime: Math.floor(process.uptime()),
    },
  };
};

const allowedOrigins = env.frontendOrigins || [env.frontendOrigin].filter(Boolean);
app.disable("x-powered-by");
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const getOriginFromReferer = (referer) => {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
};

const enforceTrustedOriginForUnsafeMethods = (req, res, next) => {
  if (!unsafeMethods.has(String(req.method || "").toUpperCase())) {
    return next();
  }

  const requestOrigin = req.get("origin") || getOriginFromReferer(req.get("referer"));
  if (!requestOrigin || allowedOrigins.includes(requestOrigin)) {
    return next();
  }

  return res.status(403).json({
    message: "Untrusted request origin",
    code: "UNTRUSTED_ORIGIN",
    requestId: req.id,
  });
};

app.use(requestIdMiddleware);
// While draining, tell NGINX/clients not to reuse this connection.
app.use((_req, res, next) => {
  if (isShuttingDown()) {
    res.setHeader("Connection", "close");
  }
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new ApiError(403, "Untrusted request origin", null, "CORS_ORIGIN_DENIED"));
    },
    credentials: true,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: CORS_EXPOSED_HEADERS,
  })
);

const buildCspConnectSrc = () => {
  const sources = new Set(["'self'"]);
  for (const origin of env.frontendOrigins || []) {
    try {
      const parsed = new URL(origin);
      sources.add(`https://${parsed.host}`);
      sources.add(`wss://${parsed.host}`);
    } catch {
      sources.add(origin);
    }
  }
  return [...sources];
};

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: buildCspConnectSrc(),
        objectSrc: ["'none'"],
        workerSrc: ["'self'", "blob:"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    frameguard: { action: "deny" },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);
app.use(compression());
// Production access log: one JSON object per line, same shape as utils/logger
// events so Loki/ELK can parse everything uniformly. Path only (query strings
// can carry tokens); no cookies, auth headers or bodies.
const jsonAccessLogFormat = (tokens, req, res) =>
  JSON.stringify({
    time: new Date().toISOString(),
    level: res.statusCode >= 500 ? "error" : "info",
    event: "http.request",
    method: req.method,
    path: String(req.originalUrl || req.url || "").split("?")[0],
    status: res.statusCode,
    durationMs: Number(tokens["response-time"](req, res)) || null,
    bytes: Number(tokens.res(req, res, "content-length")) || 0,
    ip: req.ip,
    requestId: req.id || null,
    userAgent: String(req.get("user-agent") || "").slice(0, 200),
  });

app.use(
  morgan(env.nodeEnv === "production" ? jsonAccessLogFormat : "dev", {
    skip: (req) => ["/api/live", "/api/ready", "/api/health"].includes(req.path),
  })
);
app.use(express.json({ limit: env.requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: env.requestBodyLimit }));
app.use(cookieParser());
app.use(enforceTrustedOriginForUnsafeMethods);
app.use(createResponseCacheInvalidationHook());

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    recordApiMetric({
      durationMs,
      statusCode: res.statusCode,
    });
  });
  next();
});

app.get("/api/live", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
  });
});

const sendReadiness = asyncHandler(async (_req, res) => {
  const snapshot = await buildCoreHealthSnapshot();
  res.setHeader("Cache-Control", "no-store");
  res.status(snapshot.ready ? 200 : 503).json(snapshot.body);
});

// Liveness (/api/live): process is up and the event loop responds - no
// dependency checks, so a DB outage never gets containers killed in a loop.
// Readiness (/api/ready): see buildCoreHealthSnapshot. /api/health is kept as
// an alias of readiness for existing monitors and the Dockerfile HEALTHCHECK.
app.get("/api/ready", sendReadiness);
app.get("/api/health", sendReadiness);

app.get("/api/metrics", metricsAuth, asyncHandler(async (_req, res) => {
  const metrics = await getPrometheusMetrics();
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.status(200).send(metrics);
}));

app.post("/api/rum", rumLimiter, (req, res) => {
  recordRumMetric(req.body || {});
  res.status(202).json({ accepted: true });
});

app.use("/api", generalApiLimiter);

// Login/refresh/password-reset limits live on the auth routers themselves
// (middleware/auth-rate-limits.js), so each request is counted exactly once.
app.use("/api/college-admin", collegeAdminApiLimiter);
app.use("/api/super-admin", superAdminApiLimiter);
app.use("/api/superadmin", superAdminApiLimiter);

app.use("/api/admin/dashboard/summary", authenticateAdmin, adminDashboardCache);
app.use("/api/admin/analytics", authenticateAdmin, adminAnalyticsCache);
app.use("/api/admin/reports", authenticateAdmin, adminReportsCache);
app.use("/api/admin/settings", authenticateAdmin, adminSettingsCache);
app.use("/api/admin/tests", authenticateAdmin, adminCollectionCache);
app.use("/api/admin/question-bank", authenticateAdmin, adminCollectionCache);
app.use("/api/admin/questions", authenticateAdmin, adminCollectionCache);
app.use("/api/admin/subjects", authenticateAdmin, adminCollectionCache);
app.use("/api/admin/students", authenticateAdmin, adminCollectionCache);
app.use("/api/admin/departments", authenticateAdmin, adminCollectionCache);
app.use("/api/admin/batches", authenticateAdmin, adminCollectionCache);
app.use("/api/admin/events", authenticateAdmin, adminCollectionCache);
app.use("/api/admin/admins", authenticateAdmin, adminCollectionCache);

app.use("/api/college-admin/dashboard/summary", authenticateCollegeAdmin, adminDashboardCache);
app.use("/api/college-admin/analytics", authenticateCollegeAdmin, adminAnalyticsCache);
app.use("/api/college-admin/reports", authenticateCollegeAdmin, adminReportsCache);
app.use("/api/college-admin/settings", authenticateCollegeAdmin, adminSettingsCache);
app.use("/api/college-admin/tests", authenticateCollegeAdmin, adminCollectionCache);
app.use("/api/college-admin/question-bank", authenticateCollegeAdmin, adminCollectionCache);
app.use("/api/college-admin/questions", authenticateCollegeAdmin, adminCollectionCache);
app.use("/api/college-admin/subjects", authenticateCollegeAdmin, adminCollectionCache);
app.use("/api/college-admin/students", authenticateCollegeAdmin, adminCollectionCache);
app.use("/api/college-admin/departments", authenticateCollegeAdmin, adminCollectionCache);
app.use("/api/college-admin/batches", authenticateCollegeAdmin, adminCollectionCache);
app.use("/api/college-admin/events", authenticateCollegeAdmin, adminCollectionCache);
app.use("/api/college-admin/admins", authenticateCollegeAdmin, adminCollectionCache);

app.use("/api/super-admin/analytics", authenticateSuperAdmin, superAnalyticsCache);
app.use("/api/superadmin/analytics", authenticateSuperAdmin, superAnalyticsCache);
app.use("/api/dashboard/summary", authenticateStudent, studentDashboardCache);
app.use("/api/tests/ongoing", authenticateStudent, studentTestsCache);
app.use("/api/tests/upcoming", authenticateStudent, studentTestsCache);
app.use("/api/super-admin/dashboard/summary", authenticateSuperAdmin, superDashboardCache);
app.use("/api/superadmin/dashboard/summary", authenticateSuperAdmin, superDashboardCache);
app.use("/api/super-admin/system/health", authenticateSuperAdmin, systemHealthCache);
app.use("/api/superadmin/system/health", authenticateSuperAdmin, systemHealthCache);

app.use("/api/auth", studentAuthRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/college-admin/auth", adminAuthRoutes);
app.use("/api/super-admin/auth", superAdminAuthRoutes);
app.use("/api/superadmin/auth", superAdminAuthRoutes);

app.use((req, res, next) => {
  if (req.method !== "GET") {
    return next();
  }

  if (
    req.path.startsWith("/api/tests/") ||
    req.path.startsWith("/api/attempts/") ||
    req.path.startsWith("/api/results/") ||
    req.path.startsWith("/api/submission/") ||
    isLiveMonitoringRequest(req) ||
    isReportDownloadRequest(req)
  ) {
    res.setHeader("Cache-Control", "no-store");
    return next();
  }

  const cacheablePrefixes = [
    "/api/dashboard",
    "/api/leaderboard",
    "/api/events",
    "/api/reports",
    "/api/admin/dashboard",
    "/api/admin/reports",
    "/api/admin/analytics",
    "/api/admin/settings",
    "/api/admin/tests",
    "/api/admin/question-bank",
    "/api/admin/questions",
    "/api/admin/subjects",
    "/api/admin/students",
    "/api/admin/departments",
    "/api/admin/batches",
    "/api/admin/events",
    "/api/admin/admins",
    "/api/college-admin/dashboard",
    "/api/college-admin/reports",
    "/api/college-admin/analytics",
    "/api/college-admin/settings",
    "/api/college-admin/tests",
    "/api/college-admin/question-bank",
    "/api/college-admin/questions",
    "/api/college-admin/subjects",
    "/api/college-admin/students",
    "/api/college-admin/departments",
    "/api/college-admin/batches",
    "/api/college-admin/events",
    "/api/college-admin/admins",
    "/api/super-admin/dashboard",
    "/api/super-admin/system-admins",
    "/api/super-admin/system-administrators",
    "/api/super-admin/analytics",
    "/api/superadmin/dashboard",
    "/api/superadmin/system-admins",
    "/api/superadmin/system-administrators",
    "/api/superadmin/analytics",
  ];

  if (cacheablePrefixes.some((prefix) => req.path.startsWith(prefix))) {
    res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
  }

  return next();
});

app.use("/api/dashboard", studentDashboardRoutes);
app.use("/api/tests", studentTestsRoutes);
app.use("/api", studentTestsCompatRoutes);
app.use("/api/events", studentEventsRoutes);
app.use("/api/reports", studentReportsRoutes);
app.use("/api/leaderboard", studentLeaderboardRoutes);
app.use("/api/profile", studentProfileRoutes);
app.use("/api/students/me", studentMeRoutes);
app.use("/api/resources", authenticateStudent, studentResourcesRoutes);

app.use("/api/admin/dashboard", authenticateAdmin, adminDashboardRoutes);
app.use("/api/admin/tests", authenticateAdmin, adminTestsRoutes);
app.use("/api/admin/question-bank", authenticateAdmin, adminQuestionBankRoutes);
app.use("/api/admin/questions", authenticateAdmin, adminQuestionBankRoutes);
app.use("/api/admin/subjects", authenticateAdmin, adminSubjectsRoutes);
app.use("/api/admin/students", authenticateAdmin, adminStudentsRoutes);
app.use("/api/admin/departments", authenticateAdmin, adminDepartmentsRoutes);
app.use("/api/admin/batches", authenticateAdmin, adminBatchesRoutes);
app.use("/api/admin/events", authenticateAdmin, adminEventsRoutes);
app.use("/api/admin/reports", authenticateAdmin, adminReportsRoutes);
app.use("/api/admin/jobs", authenticateAdmin, adminJobsRoutes);
app.use("/api/admin/search", authenticateAdmin, adminSearchRoutes);
app.use("/api/admin/settings", authenticateAdmin, adminSettingsRoutes);
app.use("/api/admin/admins", authenticateAdmin, adminAdminsRoutes);
app.use("/api/admin/analytics", authenticateAdmin, adminAnalyticsRoutes);
app.use("/api/admin/resources", authenticateAdmin, adminResourcesRoutes);

app.use("/api/college-admin/dashboard", authenticateCollegeAdmin, adminDashboardRoutes);
app.use("/api/college-admin/tests", authenticateCollegeAdmin, adminTestsRoutes);
app.use("/api/college-admin/question-bank", authenticateCollegeAdmin, adminQuestionBankRoutes);
app.use("/api/college-admin/questions", authenticateCollegeAdmin, adminQuestionBankRoutes);
app.use("/api/college-admin/subjects", authenticateCollegeAdmin, adminSubjectsRoutes);
app.use("/api/college-admin/students", authenticateCollegeAdmin, adminStudentsRoutes);
app.use("/api/college-admin/departments", authenticateCollegeAdmin, adminDepartmentsRoutes);
app.use("/api/college-admin/batches", authenticateCollegeAdmin, adminBatchesRoutes);
app.use("/api/college-admin/events", authenticateCollegeAdmin, adminEventsRoutes);
app.use("/api/college-admin/reports", authenticateCollegeAdmin, adminReportsRoutes);
app.use("/api/college-admin/jobs", authenticateCollegeAdmin, adminJobsRoutes);
app.use("/api/college-admin/search", authenticateCollegeAdmin, adminSearchRoutes);
app.use("/api/college-admin/settings", authenticateCollegeAdmin, adminSettingsRoutes);
app.use("/api/college-admin/admins", authenticateCollegeAdmin, adminAdminsRoutes);
app.use("/api/college-admin/analytics", authenticateCollegeAdmin, adminAnalyticsRoutes);
app.use("/api/college-admin/resources", authenticateCollegeAdmin, collegeAdminResourcesRoutes);

app.use("/api/super-admin/dashboard", superAdminDashboardRoutes);
app.use("/api/super-admin/system-admins", superAdminSystemAdminsRoutes);
app.use("/api/super-admin/system-administrators", superAdminSystemAdminsRoutes);
app.use("/api/super-admin/colleges", superAdminCollegesRoutes);
app.use("/api/super-admin/admins", superAdminAdminsRoutes);
app.use("/api/super-admin/students", superAdminStudentsRoutes);
app.use("/api/super-admin/tests", superAdminTestsRoutes);
app.use("/api/super-admin/batches", superAdminBatchesRoutes);
app.use("/api/super-admin/departments", superAdminDepartmentsRoutes);
app.use("/api/super-admin/events", superAdminEventsRoutes);
app.use("/api/super-admin/reports", superAdminReportsRoutes);
app.use("/api/super-admin/analytics", superAdminAnalyticsRoutes);
  
app.use("/api/super-admin/settings", superAdminSettingsRoutes);
app.use("/api/super-admin/system", superAdminHealthRoutes);
app.use("/api/super-admin/question-bank", superAdminQuestionBankRoutes);
app.use("/api/super-admin/questions", superAdminQuestionBankRoutes);
app.use("/api/super-admin/subjects", superAdminSubjectsRoutes);
app.use("/api/super-admin/resources", authenticateSuperAdmin, superAdminResourcesRoutes);

// Endpoint aliases for clients that use /superadmin instead of /super-admin.
app.use("/api/superadmin/auth", superAdminAuthRoutes);
app.use("/api/superadmin/dashboard", superAdminDashboardRoutes);
app.use("/api/superadmin/system-admins", superAdminSystemAdminsRoutes);
app.use("/api/superadmin/system-administrators", superAdminSystemAdminsRoutes);
app.use("/api/superadmin/colleges", superAdminCollegesRoutes);
app.use("/api/superadmin/admins", superAdminAdminsRoutes);
app.use("/api/superadmin/students", superAdminStudentsRoutes);
app.use("/api/superadmin/tests", superAdminTestsRoutes);
app.use("/api/superadmin/batches", superAdminBatchesRoutes);
app.use("/api/superadmin/departments", superAdminDepartmentsRoutes);
app.use("/api/superadmin/events", superAdminEventsRoutes);
app.use("/api/superadmin/reports", superAdminReportsRoutes);
app.use("/api/superadmin/analytics", superAdminAnalyticsRoutes);
 
app.use("/api/superadmin/settings", superAdminSettingsRoutes);
app.use("/api/superadmin/system", superAdminHealthRoutes);
app.use("/api/superadmin/question-bank", superAdminQuestionBankRoutes);
app.use("/api/superadmin/questions", superAdminQuestionBankRoutes);
app.use("/api/superadmin/subjects", superAdminSubjectsRoutes);
app.use("/api/superadmin/resources", authenticateSuperAdmin, superAdminResourcesAliasRoutes);

setupCompleteValidationSystem(app);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
