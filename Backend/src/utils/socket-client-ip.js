const proxyaddr = require("proxy-addr");
const env = require("../config/env");
const { normalizeIp } = require("./ip-allowlist");

// Same trust rules Express applies for req.ip (TRUST_PROXY), for raw
// Socket.IO handshake requests that never pass through Express.
const compileTrust = (value) => {
  if (typeof value === "function") return value;
  if (value === true) return () => true;
  if (typeof value === "number") return (_addr, hop) => hop < value;
  if (typeof value === "string" && value) return proxyaddr.compile(value.split(",").map((v) => v.trim()));
  return () => false;
};

const trust = compileTrust(env.trustProxy);

const getSocketClientIp = (request) => {
  try {
    return normalizeIp(proxyaddr(request, trust)) || "unknown";
  } catch {
    return normalizeIp(request?.socket?.remoteAddress) || "unknown";
  }
};

module.exports = { getSocketClientIp };
