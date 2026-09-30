const { ApiError } = require("../utils/http");
const env = require("../config/env");
const { logger } = require("../utils/logger");

const notFound = (_req, _res, next) => {
  next(new ApiError(404, "Route not found", null, "ROUTE_NOT_FOUND"));
};

// Driver/ODM errors that mean "database unreachable right now" -> 503 + retry,
// not a 500. Mongoose wraps the driver's selection error under its own name.
const DB_UNAVAILABLE_ERROR_NAMES = new Set([
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoServerSelectionError",
  "MongooseServerSelectionError",
  "MongoNotConnectedError",
  "MongoTopologyClosedError",
  "MongoPoolClearedError",
]);

const getRequestId = (req) => req.id || req.headers["x-request-id"] || null;

const errorHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    return _next(error);
  }

  if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, "body")) {
    return res.status(400).json({
      message: "Invalid JSON payload",
      code: "INVALID_JSON_PAYLOAD",
      requestId: getRequestId(_req),
      details: null,
    });
  }

  if (error?.name === "MulterError") {
    const statusCode = error.code === "LIMIT_FILE_SIZE" ? 400 : 422;
    return res.status(statusCode).json({
      message: error.code === "LIMIT_FILE_SIZE" ? "File size exceeds the configured upload limit" : "Invalid file upload",
      code: error.code || "UPLOAD_ERROR",
      requestId: getRequestId(_req),
      details: null,
    });
  }

  const dbUnavailable =
    DB_UNAVAILABLE_ERROR_NAMES.has(error?.name) ||
    ["P1001", "P1002", "P1008", "ECONNREFUSED", "ETIMEDOUT"].includes(String(error?.code || "").toUpperCase());

  const statusCode = dbUnavailable ? 503 : (error.statusCode || 500);
  const message = error.message || "Internal server error";
  const code = dbUnavailable
    ? "SERVICE_UNAVAILABLE"
    : (error.code || (statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED"));
  const requestId = getRequestId(_req);
  const retryAfterSeconds = Number(error.details?.retryAfterSeconds || 0);
  if (statusCode === 429 && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    res.setHeader("Retry-After", String(Math.ceil(retryAfterSeconds)));
  }

  if (dbUnavailable) {
    res.setHeader("Retry-After", "5");
  }

  // Path only: query strings can carry tokens (signed links, reset tokens).
  const logPath = String(_req.originalUrl || "").split("?")[0];
  if (dbUnavailable) {
    // One line per 10s instead of a stack trace per request during an outage.
    logger.throttled("error", "db-unavailable-request", 10_000, "mongodb.unavailable_request", {
      requestId,
      method: _req.method,
      path: logPath,
      reason: error?.message,
    });
  } else if (statusCode >= 500) {
    console.error(`[api-error] request_id=${requestId || "-"} ${_req.method} ${logPath}`, error);
  }

  // Never leak raw internals (Mongoose CastError paths, stack-derived messages,
  // driver errors) to clients on unexpected failures. Only messages we set
  // ourselves via ApiError are trusted for 5xx responses; everything else gets
  // a generic message in production. The full error is still logged above.
  const isOperational = error instanceof ApiError;
  const safeMessage = dbUnavailable
    ? "Service temporarily unavailable. Please retry shortly."
    : statusCode >= 500 && !isOperational && env.nodeEnv === "production"
      ? "Internal server error"
      : message;

  res.status(statusCode).json({
    message: safeMessage,
    code,
    requestId,
    details: isOperational ? error.details || null : null,
  });
};

module.exports = {
  notFound,
  errorHandler,
};
