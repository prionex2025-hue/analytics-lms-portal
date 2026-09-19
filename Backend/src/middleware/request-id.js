const crypto = require("crypto");

const REQUEST_ID_HEADER = "x-request-id";
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

const normalizeRequestId = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw || "").trim();
  return SAFE_REQUEST_ID.test(text) ? text : crypto.randomUUID();
};

const requestIdMiddleware = (req, res, next) => {
  const requestId = normalizeRequestId(req.headers[REQUEST_ID_HEADER]);

  req.id = requestId;
  req.requestId = requestId;
  req.headers[REQUEST_ID_HEADER] = requestId;
  res.setHeader("X-Request-Id", requestId);

  next();
};

module.exports = {
  requestIdMiddleware,
  normalizeRequestId,
};
