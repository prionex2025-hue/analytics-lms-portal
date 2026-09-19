// Centralized CORS header allowlists so they can be unit-tested without loading
// the full Express app (which pulls in Puppeteer via the report pipeline).
//
// NOTE: `X-Test-Client-Id` is required — the student exam flow sends it on
// start/answer/heartbeat/violation/submit/module-advance requests for session
// and tab-takeover detection. Omitting it makes the browser preflight fail.
const CORS_ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Request-Id", "X-Test-Client-Id"];

const CORS_EXPOSED_HEADERS = [
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
  "Retry-After",
  "X-Request-Id",
];

module.exports = { CORS_ALLOWED_HEADERS, CORS_EXPOSED_HEADERS };
