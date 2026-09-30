const net = require("net");
const { logger } = require("./logger");

// Strip the IPv4-mapped IPv6 prefix Node reports for IPv4 clients on
// dual-stack sockets ("::ffff:203.0.113.5").
const normalizeIp = (ip) => String(ip || "").trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");

/**
 * Build a matcher from "203.0.113.10, 198.51.100.0/24, 2001:db8::/32".
 * Invalid entries are logged and ignored (never widen the list).
 */
const createIpAllowlist = (entries = []) => {
  const list = new net.BlockList();
  let size = 0;

  for (const raw of entries) {
    const entry = String(raw || "").trim();
    if (!entry) continue;
    const [address, prefixRaw] = entry.split("/");
    const family = net.isIP(address);
    if (!family) {
      logger.warn("config.invalid_trusted_network", { entry });
      continue;
    }
    const type = family === 6 ? "ipv6" : "ipv4";
    if (prefixRaw === undefined) {
      list.addAddress(address, type);
    } else {
      const prefix = Number(prefixRaw);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === 6 ? 128 : 32)) {
        logger.warn("config.invalid_trusted_network", { entry });
        continue;
      }
      list.addSubnet(address, prefix, type);
    }
    size += 1;
  }

  return {
    size,
    has(ip) {
      if (size === 0) return false;
      const normalized = normalizeIp(ip);
      const family = net.isIP(normalized);
      if (!family) return false;
      return list.check(normalized, family === 6 ? "ipv6" : "ipv4");
    },
  };
};

module.exports = { createIpAllowlist, normalizeIp };
