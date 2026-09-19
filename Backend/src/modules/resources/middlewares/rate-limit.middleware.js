const env = require("../../../config/env");
const { isRedisAvailable } = require("../../../config/redis");
const { createRateLimiter } = require("../../../middleware/rate-limit");

const requireRedisForProductionRateLimit = (req, res, next) => {
  if (env.nodeEnv === "test" || !env.redis.enabled || isRedisAvailable()) {
    return next();
  }

  return res.status(503).json({
    message: "Resource rate limiting is temporarily unavailable. Please retry shortly.",
    code: "RESOURCE_RATE_LIMIT_UNAVAILABLE",
    requestId: req.id || req.headers["x-request-id"] || null,
    details: null,
  });
};

const createRedisBackedResourceLimiter = (options) => [
  requireRedisForProductionRateLimit,
  createRateLimiter({
    ...options,
    failOpen: false,
  }),
];

const resourceDownloadLimiter = createRedisBackedResourceLimiter({
  scope: "resources-download",
  routeLabel: "/api/resources/download/:id",
  windowMs: env.rateLimit.resourceDownloadWindowMs,
  max: env.rateLimit.resourceDownloadMax,
  message: "Download limit reached. Please wait before downloading more resources.",
});

const resourceSearchLimiter = createRedisBackedResourceLimiter({
  scope: "resources-search",
  routeLabel: "/api/resources",
  windowMs: env.rateLimit.resourceSearchWindowMs,
  max: env.rateLimit.resourceSearchMax,
  message: "Search limit reached. Please slow down and try again.",
});

const resourceUploadLimiter = createRedisBackedResourceLimiter({
  scope: "resources-upload",
  routeLabel: "/api/resources/upload",
  windowMs: env.rateLimit.resourceUploadWindowMs,
  max: env.rateLimit.resourceUploadMax,
  message: "Upload limit reached. Please wait before uploading more resources.",
});

module.exports = {
  createRedisBackedResourceLimiter,
  resourceDownloadLimiter,
  resourceSearchLimiter,
  resourceUploadLimiter,
};
