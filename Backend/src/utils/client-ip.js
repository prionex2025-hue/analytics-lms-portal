// Resolve the caller's IP for rate limiting, lockout and audit logging.
//
// Never read X-Forwarded-For directly: its leftmost entry is whatever the
// client sent, because each proxy appends to (not replaces) the header. Express
// computes `req.ip` from X-Forwarded-For using the `trust proxy` hop count
// (TRUST_PROXY, see config/env.js), which only trusts entries added by our own
// proxies.
const getClientIp = (req) => req?.ip || req?.socket?.remoteAddress || "unknown";

module.exports = { getClientIp };
