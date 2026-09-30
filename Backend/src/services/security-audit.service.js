const crypto = require("crypto");
const { createAuditLog } = require("./audit.service");
const { getClientIp } = require("../utils/client-ip");

const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);


const getUserAgent = (req = {}) => String(req.headers?.["user-agent"] || "").slice(0, 200);

const recordSecurityEvent = async ({
  action,
  req,
  targetType = "AUTH",
  targetId = "unknown",
  collegeId = null,
  adminId = null,
  superAdminId = null,
  outcome = "unknown",
  metadata = {},
}) => {
  await createAuditLog({
    action,
    targetType,
    targetId: String(targetId || "unknown"),
    collegeId,
    adminId,
    superAdminId,
    afterState: {
      outcome,
      requestId: req?.id || req?.headers?.["x-request-id"] || null,
      ipHash: hashValue(getClientIp(req)),
      userAgentHash: hashValue(getUserAgent(req)),
      ...metadata,
    },
  }).catch(() => null);
};

module.exports = {
  recordSecurityEvent,
};
