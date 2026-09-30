// Minimal structured logger for operational/security events.
//
// Production emits one JSON object per line (easy to ship to Loki/ELK/
// CloudWatch); other environments emit a readable single line. Metadata keys
// that look like credentials are always redacted, so callers can pass request-
// derived objects without leaking passwords, tokens, cookies or API keys.

const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|credential|otp/i;
const MAX_DEPTH = 4;

const redact = (value, depth = 0) => {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code };
  }
  if (depth >= MAX_DEPTH) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
};

const isProduction = () => process.env.NODE_ENV === "production";
const isTest = () => process.env.NODE_ENV === "test";

const write = (level, event, meta = {}) => {
  if (isTest() && level !== "error") {
    return;
  }

  const safeMeta = redact(meta);
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (isProduction()) {
    sink(JSON.stringify({ time: new Date().toISOString(), level, event, ...safeMeta }));
    return;
  }

  sink(`[${level}] ${event}`, Object.keys(safeMeta).length ? safeMeta : "");
};

// Collapse repeated identical events (e.g. "Redis down" on every request) to
// one line per interval per key.
const throttleState = new Map();
const THROTTLE_MAX_KEYS = 5_000;

const shouldEmit = (key, intervalMs) => {
  const now = Date.now();
  const last = throttleState.get(key) || 0;
  if (now - last < intervalMs) {
    return false;
  }
  if (throttleState.size >= THROTTLE_MAX_KEYS) {
    throttleState.clear();
  }
  throttleState.set(key, now);
  return true;
};

const logger = {
  info: (event, meta) => write("info", event, meta),
  warn: (event, meta) => write("warn", event, meta),
  error: (event, meta) => write("error", event, meta),
  throttled: (level, key, intervalMs, event, meta) => {
    if (shouldEmit(key, intervalMs)) {
      write(level, event, meta);
    }
  },
};

module.exports = { logger, redact };
