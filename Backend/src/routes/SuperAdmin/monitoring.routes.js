/**
 * Validation Monitoring Routes
 * 
 * Provides endpoints to view, analyze, and alert on validation metrics.
 * Access restricted to SuperAdmin and monitoring systems.
 */

const express = require("express");
const router = express.Router();
const env = require("../../config/env");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { asyncHandler, ApiError } = require("../../utils/http");
const {
  getMetricsSnapshot,
  getFailureRate,
  detectAnomalies,
  exportMetrics,
} = require("../../services/validation-monitoring.service");

router.use(authenticateSuperAdmin);

// These endpoints aggregate over every submission/violation record and
// /metrics/export streams the whole set, so they get their own ceiling
// instead of the 600/min super-admin API budget.
const superAdminMonitoringLimiter = createRateLimiter({
  scope: "super-admin-monitoring",
  routeLabel: "/api/super-admin/monitoring/*",
  windowMs: env.rateLimit.superAdminMonitoringWindowMs,
  max: env.rateLimit.superAdminMonitoringMax,
  message: "Monitoring endpoints are rate limited. Please wait a moment and retry.",
});

router.use(superAdminMonitoringLimiter);

/**
 * GET /api/super-admin/metrics
 * Get current validation metrics snapshot
 */
router.get("/metrics", asyncHandler(async (req, res) => {
  const metrics = await getMetricsSnapshot();

  res.status(200).json({
    timestamp: new Date().toISOString(),
    summary: metrics.summary,
    failures: metrics.failures,
    latency: metrics.latency,
  });
}));

/**
 * GET /api/super-admin/metrics/failure-rate?model=UserValidation
 * Get failure rate for specific validation model
 */
router.get("/metrics/failure-rate", asyncHandler(async (req, res) => {
  const { model } = req.query;

  if (!model) {
    throw new ApiError(400, "Model query parameter is required");
  }

  const failureRate = await getFailureRate(model);

  res.status(200).json({
    model,
    ...failureRate,
  });
}));

/**
 * GET /api/super-admin/metrics/anomalies
 * Detect and return validation anomalies
 */
router.get("/metrics/anomalies", asyncHandler(async (req, res) => {
  const anomalies = await detectAnomalies();

  res.status(200).json({
    timestamp: new Date().toISOString(),
    anomalies,
    count: anomalies.length,
    hasAnomalies: anomalies.length > 0,
  });
}));

/**
 * GET /api/super-admin/metrics/export
 * Export metrics in Prometheus format
 */
router.get("/metrics/export", asyncHandler(async (req, res) => {
  const metrics = await exportMetrics();

  // Prometheus format
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.status(200).send(metrics);
}));

/**
 * GET /api/super-admin/metrics/health
 * Quick health check for validation system
 */
router.get("/metrics/health", asyncHandler(async (req, res) => {
  const metrics = await getMetricsSnapshot();
  const anomalies = await detectAnomalies();

  const isHealthy = {
    status: "unknown",
    successRate: parseFloat(metrics.summary.successRate) || 0,
    hasAnomalies: anomalies.length > 0,
  };

  if (isHealthy.successRate >= 95 && !isHealthy.hasAnomalies) {
    isHealthy.status = "healthy";
  } else if (isHealthy.successRate >= 90 && anomalies.length <= 2) {
    isHealthy.status = "degraded";
  } else {
    isHealthy.status = "unhealthy";
  }

  const statusCode = isHealthy.status === "healthy" ? 200 : isHealthy.status === "degraded" ? 202 : 503;

  res.status(statusCode).json(isHealthy);
}));

/**
 * GET /api/super-admin/metrics/summary
 * Get concise summary of validation metrics
 */
router.get("/metrics/summary", asyncHandler(async (req, res) => {
  const metrics = await getMetricsSnapshot();
  const anomalies = await detectAnomalies();

  res.status(200).json({
    summary: {
      total: metrics.summary.total,
      passed: metrics.summary.passed,
      failed: metrics.summary.failed,
      successRate: metrics.summary.successRate,
    },
    topFailures: Object.entries(metrics.failures || {})
      .map(([model, data]) => ({
        model,
        count: data.count || 0,
        rate: `${((data.count / metrics.summary.total) * 100).toFixed(2)}%`,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    anomalies: anomalies.slice(0, 3),
  });
}));

module.exports = router;
