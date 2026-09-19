const crypto = require("crypto");
const env = require("../config/env");

const extractBearerToken = (req) => {
  const authHeader = String(req.headers?.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }
  return authHeader.slice("Bearer ".length).trim();
};

const safeCompare = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  if (providedBuffer.length === 0 || providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const metricsAuth = (req, res, next) => {
  if (!env.metrics?.enabled) {
    return res.status(404).json({
      message: "Route not found",
      code: "ROUTE_NOT_FOUND",
      requestId: req.id || req.headers?.["x-request-id"] || null,
      details: null,
    });
  }

  if (!env.metrics?.token) {
    return res.status(503).json({
      message: "Metrics endpoint is not configured.",
      code: "METRICS_NOT_CONFIGURED",
      requestId: req.id || req.headers?.["x-request-id"] || null,
      details: null,
    });
  }

  const provided = extractBearerToken(req);
  if (!safeCompare(provided, env.metrics.token)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="lms-metrics"');
    return res.status(401).json({
      message: "Unauthorized",
      code: "METRICS_UNAUTHORIZED",
      requestId: req.id || req.headers?.["x-request-id"] || null,
      details: null,
    });
  }

  return next();
};

module.exports = {
  metricsAuth,
  extractBearerToken,
  safeCompare,
};
