const bcrypt = require("bcrypt");
const crypto = require("crypto");

const models = require("../models");
const env = require("../config/env");
const { ROLES, normalizeRole, isAdminLikeRole } = require("../constants/roles");
const { ApiError } = require("../utils/http");
const { revokeAllRefreshTokensForOwner } = require("./refresh-token-session.service");

const GENERIC_RESET_MESSAGE = "If an account matches, password reset instructions will be sent.";
const RESET_SUCCESS_MESSAGE = "Password reset successful. This reset link is now expired. Please sign in again.";
const VALID_SCOPES = new Set(["student", "admin", "super-admin"]);
const VALID_PORTALS = new Set(["student", "admin", "college-admin", "super-admin"]);
const RESEND_EMAIL_API_URL = "https://api.resend.com/emails";

const PORTAL_LABELS = {
  student: "Student Portal",
  admin: "Admin Portal",
  "college-admin": "College Admin Portal",
  "super-admin": "Super Admin Portal",
};

const normalizeIdentifier = (value) => String(value || "").trim();
const normalizeEmail = (value) => normalizeIdentifier(value).toLowerCase();
const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getClientIp = (req) =>
  String(req?.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim() ||
  req?.ip ||
  req?.socket?.remoteAddress ||
  null;

const normalizePortal = ({ portal, scope, principal = null }) => {
  const requested = String(portal || "").trim().toLowerCase();
  if (VALID_PORTALS.has(requested)) {
    return requested;
  }

  if (scope === "admin") {
    return normalizeRole(principal?.role) === ROLES.COLLEGE_ADMIN ? "college-admin" : "admin";
  }
  return scope === "super-admin" ? "super-admin" : "student";
};

const buildResetUrl = ({ scope, token, portal = null, principal = null }) => {
  const resolvedPortal = normalizePortal({ portal, scope, principal });
  const configured = env.passwordReset.resetUrls?.[resolvedPortal] || env.passwordReset.frontendUrl;
  const separator = configured.includes("?") ? "&" : "?";
  return `${configured}${separator}scope=${encodeURIComponent(scope)}&token=${encodeURIComponent(token)}`;
};

const formatSender = () => {
  const email = normalizeEmail(env.email.resendFromEmail);
  const name = String(env.email.resendFromName || "").replace(/[<>]/g, "").trim();
  return name ? `${name} <${email}>` : email;
};

const buildPasswordResetEmail = ({ resetUrl, expiresAt, portal }) => {
  const portalLabel = PORTAL_LABELS[portal] || "Analytics Edify";
  const safeResetUrl = escapeHtml(resetUrl);
  const safePortalLabel = escapeHtml(portalLabel);
  const expiresLabel = new Date(expiresAt).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  return {
    subject: "Reset your Analytics Edify LMS password",
    html: `<!doctype html>
<html>
  <body style="margin:0;background:#07111f;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="background:radial-gradient(circle at 12% 8%,rgba(56,189,248,.42),transparent 30%),radial-gradient(circle at 88% 18%,rgba(59,130,246,.38),transparent 32%),linear-gradient(135deg,#07111f 0%,#0b1f46 48%,#eff6ff 100%);padding:42px 16px;">
      <div style="max-width:620px;margin:0 auto;">
        <div style="padding:1px;border-radius:28px;background:linear-gradient(135deg,rgba(125,211,252,.9),rgba(37,99,235,.75),rgba(255,255,255,.85));box-shadow:0 28px 90px rgba(15,35,71,.42);">
          <div style="overflow:hidden;border-radius:27px;background:#ffffff;">
            <div style="background:linear-gradient(135deg,#0c4cff 0%,#082bb7 46%,#06166f 100%);padding:30px 30px 34px;color:#ffffff;">
              <div style="font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#bfdbfe;">Analytics Edify</div>
              <h1 style="margin:18px 0 12px;font-size:32px;line-height:1.08;font-weight:800;color:#ffffff;">Secure password reset</h1>
              <p style="margin:0;font-size:15px;line-height:1.7;color:#dbeafe;">${safePortalLabel} access request verified. Use the encrypted one-time link below to choose a new password.</p>
            </div>
            <div style="padding:30px;background:linear-gradient(180deg,#ffffff 0%,#f5f9ff 100%);">
              <div style="border:1px solid #dbeafe;border-radius:18px;background:#ffffff;padding:22px;box-shadow:0 16px 40px rgba(37,99,235,.08);">
                <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#475569;">We received a request to reset your Analytics Edify password. This link works once and expires automatically after use.</p>
                <p style="margin:0 0 22px;">
                  <a href="${safeResetUrl}" style="display:inline-block;border-radius:14px;background:linear-gradient(135deg,#0ea5e9 0%,#2563eb 54%,#1d4ed8 100%);color:#ffffff;padding:14px 22px;text-decoration:none;font-size:15px;font-weight:800;box-shadow:0 16px 34px rgba(37,99,235,.38);">Reset password</a>
                </p>
                <div style="border-radius:14px;background:#eff6ff;border:1px solid #bfdbfe;padding:14px 16px;">
                  <p style="margin:0;font-size:13px;line-height:1.6;color:#1e40af;"><strong>Link expiry:</strong> ${escapeHtml(expiresLabel)} IST</p>
                  <p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:#475569;">After you reset your password, this link becomes invalid immediately.</p>
                </div>
                <p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:#64748b;">If you did not request this email, no action is needed.</p>
              </div>
              <div style="margin-top:22px;border-radius:18px;background:#0f172a;padding:18px 20px;color:#cbd5e1;">
                <p style="margin:0 0 8px;font-size:13px;line-height:1.6;">Built and supported by <strong style="color:#ffffff;">Prionex</strong>.</p>
                <p style="margin:0;font-size:13px;line-height:1.6;">For contact and support, visit <a href="https://prionex.dev" style="color:#7dd3fc;text-decoration:none;font-weight:700;">prionex.dev</a>.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`,
    text: [
      "Reset your Analytics Edify password",
      "",
      `Portal: ${portalLabel}`,
      `Reset link: ${resetUrl}`,
      `This link expires at ${expiresLabel}.`,
      "After you reset your password, this link becomes invalid immediately.",
      "",
      "If you did not request this, you can safely ignore this email.",
      "",
      "Built and supported by Prionex. Contact/support: https://prionex.dev",
    ].join("\n"),
  };
};

const sendResendPasswordResetEmail = async ({ email, resetUrl, expiresAt, portal, token }) => {
  if (!env.email.resendApiKey) {
    return {
      delivered: false,
      reason: "RESEND_API_KEY is not configured",
    };
  }

  const to = normalizeEmail(email);
  if (!to) {
    return {
      delivered: false,
      reason: "password reset recipient email is missing",
    };
  }

  const message = buildPasswordResetEmail({ resetUrl, expiresAt, portal });
  const body = {
    from: formatSender(),
    to: [to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    tags: [
      { name: "event", value: "password_reset" },
      { name: "portal", value: String(portal || "unknown").replace(/[^A-Za-z0-9_-]/g, "_") },
    ],
  };

  try {
    const response = await fetch(RESEND_EMAIL_API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.email.resendApiKey}`,
        "content-type": "application/json",
        "Idempotency-Key": `password-reset-${hashToken(token).slice(0, 32)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const responseText = await response.text();
    let responseBody = {};
    try {
      responseBody = responseText ? JSON.parse(responseText) : {};
    } catch {
      responseBody = { message: responseText };
    }

    if (!response.ok) {
      return {
        delivered: false,
        reason: `Resend returned ${response.status}${responseBody?.message ? `: ${responseBody.message}` : ""}`,
      };
    }

    return {
      delivered: true,
      provider: "resend",
      emailId: responseBody?.id || null,
    };
  } catch (error) {
    return {
      delivered: false,
      reason: error?.message || "Resend request failed",
    };
  }
};

const withGenericDelay = async () => {
  await new Promise((resolve) => setTimeout(resolve, 75 + crypto.randomInt(75)));
};

const findStudentPrincipal = async (db, identifier) => {
  const normalized = normalizeIdentifier(identifier);
  const email = normalizeEmail(identifier);
  const isEmail = normalized.includes("@");

  let student = null;
  if (isEmail) {
    student = await db.student.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
  } else {
    student = await db.student.findFirst({
      where: {
        OR: [
          { studentId: normalized },
          { enrollNumber: normalized },
          { enrollmentNumber: normalized },
        ],
      },
    });
  }

  if (student) {
    return {
      modelName: "student",
      refreshModelName: "studentRefreshToken",
      refreshScope: "student",
      ownerField: "userId",
      principal: student,
      email: student.email || null,
    };
  }

  if (!isEmail) {
    return null;
  }

  const user = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (!user || normalizeRole(user.role) !== ROLES.STUDENT) {
    return null;
  }

  return {
    modelName: "user",
    refreshModelName: "studentRefreshToken",
    refreshScope: "student",
    ownerField: "userId",
    principal: user,
    email: user.email || null,
  };
};

const findAdminPrincipal = async (db, identifier) => {
  const email = normalizeEmail(identifier);
  const admin = await db.admin.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      isActive: true,
    },
  });

  if (!admin || !isAdminLikeRole(normalizeRole(admin.role))) {
    return null;
  }

  return {
    modelName: "admin",
    refreshModelName: "adminRefreshToken",
    refreshScope: "admin",
    ownerField: "adminId",
    principal: admin,
    email: admin.email || email,
  };
};

const findSuperAdminPrincipal = async (db, identifier) => {
  const email = normalizeEmail(identifier);
  const superAdmin = await db.superAdmin.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      role: ROLES.SUPER_ADMIN,
      isActive: true,
    },
  });

  if (!superAdmin) {
    return null;
  }

  return {
    modelName: "superAdmin",
    refreshModelName: "superAdminRefreshToken",
    refreshScope: "super-admin",
    ownerField: "superAdminId",
    principal: superAdmin,
    email: superAdmin.email || email,
  };
};

const findPrincipal = async (db, scope, identifier) => {
  if (scope === "student") {
    return findStudentPrincipal(db, identifier);
  }
  if (scope === "admin") {
    return findAdminPrincipal(db, identifier);
  }
  if (scope === "super-admin") {
    return findSuperAdminPrincipal(db, identifier);
  }
  throw new ApiError(400, "Invalid password reset scope", null, "INVALID_PASSWORD_RESET_SCOPE");
};

const loadPrincipalFromResetRecord = async (db, scope, record) => {
  const principal = await db[record.principalModel]?.findUnique({
    where: { id: record.principalId },
  });

  if (!principal) {
    return null;
  }

  if (scope === "student" && record.principalModel === "student") {
    return {
      modelName: "student",
      refreshModelName: "studentRefreshToken",
      refreshScope: "student",
      ownerField: "userId",
      principal,
      email: principal.email || record.email,
    };
  }

  if (scope === "student" && record.principalModel === "user" && normalizeRole(principal.role) === ROLES.STUDENT) {
    return {
      modelName: "user",
      refreshModelName: "studentRefreshToken",
      refreshScope: "student",
      ownerField: "userId",
      principal,
      email: principal.email || record.email,
    };
  }

  if (scope === "admin" && record.principalModel === "admin" && isAdminLikeRole(normalizeRole(principal.role))) {
    return {
      modelName: "admin",
      refreshModelName: "adminRefreshToken",
      refreshScope: "admin",
      ownerField: "adminId",
      principal,
      email: principal.email || record.email,
    };
  }

  if (scope === "super-admin" && record.principalModel === "superAdmin" && normalizeRole(principal.role) === ROLES.SUPER_ADMIN) {
    return {
      modelName: "superAdmin",
      refreshModelName: "superAdminRefreshToken",
      refreshScope: "super-admin",
      ownerField: "superAdminId",
      principal,
      email: principal.email || record.email,
    };
  }

  return null;
};

const createResetRecord = async ({ db, scope, principalContext, token, req }) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.passwordReset.tokenTtlMinutes * 60 * 1000);

  await db.passwordResetToken.updateMany({
    where: {
      scope,
      principalId: principalContext.principal.id,
      usedAt: null,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
      revokedReason: "superseded",
    },
  });

  return db.passwordResetToken.create({
    data: {
      scope,
      principalId: principalContext.principal.id,
      principalModel: principalContext.modelName,
      email: normalizeEmail(principalContext.email),
      tokenHash: hashToken(token),
      expiresAt,
      usedAt: null,
      revokedAt: null,
      requestedAt: now,
      requestedIp: getClientIp(req),
      requestedUserAgent: req?.headers?.["user-agent"] || null,
    },
  });
};

const dispatchResetNotification = async ({ scope, email, token, expiresAt, portal, principal }) => {
  const resolvedPortal = normalizePortal({ portal, scope, principal });
  const resetUrl = buildResetUrl({ scope, token, portal: resolvedPortal, principal });
  const mode = env.passwordReset.deliveryMode;

  if (mode === "response") {
    return {
      delivered: true,
      resetToken: token,
      resetUrl,
    };
  }

  if (mode === "resend") {
    return sendResendPasswordResetEmail({
      email,
      resetUrl,
      expiresAt,
      portal: resolvedPortal,
      token,
    });
  }

  return {
    delivered: false,
    reason: "password reset email delivery disabled",
  };
};

const requestPasswordReset = async ({ scope, identifier, portal = null, req, db: providedDb = null }) => {
  if (!VALID_SCOPES.has(scope)) {
    throw new ApiError(400, "Invalid password reset scope", null, "INVALID_PASSWORD_RESET_SCOPE");
  }

  const db = providedDb || (await models.init()).dbClient;
  const principalContext = await findPrincipal(db, scope, identifier);
  if (!principalContext?.principal?.id || principalContext.principal.isActive === false) {
    await withGenericDelay();
    return { message: GENERIC_RESET_MESSAGE };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const resetRecord = await createResetRecord({ db, scope, principalContext, token, req });
  const delivery = await dispatchResetNotification({
    scope,
    email: principalContext.email,
    token,
    expiresAt: resetRecord.expiresAt,
    portal,
    principal: principalContext.principal,
  });

  if (!delivery.delivered) {
    await db.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: {
        revokedAt: new Date(),
        revokedReason: delivery.reason || "delivery_failed",
      },
    }).catch(() => {});
    console.warn("Password reset delivery failed", { scope, reason: delivery.reason });
  }

  const response = { message: GENERIC_RESET_MESSAGE };
  if (env.passwordReset.returnToken || env.passwordReset.deliveryMode === "response") {
    response.resetToken = token;
    response.resetUrl = buildResetUrl({ scope, token, portal, principal: principalContext.principal });
    response.expiresAt = new Date(resetRecord.expiresAt).toISOString();
  }
  return response;
};

const getResetRecordOrThrow = async ({ db, scope, token }) => {
  const record = await db.passwordResetToken.findFirst({
    where: {
      scope,
      tokenHash: hashToken(token),
    },
  });

  if (!record || record.usedAt || record.revokedAt || new Date(record.expiresAt).getTime() <= Date.now()) {
    throw new ApiError(400, "Invalid or expired password reset token", null, "INVALID_PASSWORD_RESET_TOKEN");
  }

  return record;
};

const resetPasswordWithToken = async ({ scope, token, password, db: providedDb = null }) => {
  if (!VALID_SCOPES.has(scope)) {
    throw new ApiError(400, "Invalid password reset scope", null, "INVALID_PASSWORD_RESET_SCOPE");
  }

  const db = providedDb || (await models.init()).dbClient;
  const record = await getResetRecordOrThrow({ db, scope, token });
  const principalContext = await loadPrincipalFromResetRecord(db, scope, record);

  if (
    !principalContext?.principal?.id ||
    String(principalContext.principal.id) !== String(record.principalId) ||
    principalContext.modelName !== record.principalModel ||
    principalContext.principal.isActive === false
  ) {
    throw new ApiError(400, "Invalid or expired password reset token", null, "INVALID_PASSWORD_RESET_TOKEN");
  }

  const passwordHash = await bcrypt.hash(String(password || ""), 10);
  await db[principalContext.modelName].update({
    where: { id: principalContext.principal.id },
    data: { passwordHash },
  });

  await revokeAllRefreshTokensForOwner({
    db,
    modelName: principalContext.refreshModelName,
    scope: principalContext.refreshScope,
    ownerField: principalContext.ownerField,
    ownerId: principalContext.principal.id,
    reason: "password_reset",
  });

  await db.passwordResetToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return {
    message: RESET_SUCCESS_MESSAGE,
  };
};

module.exports = {
  GENERIC_RESET_MESSAGE,
  RESET_SUCCESS_MESSAGE,
  requestPasswordReset,
  resetPasswordWithToken,
};
