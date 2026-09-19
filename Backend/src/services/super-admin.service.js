const bcrypt = require("bcrypt");
const crypto = require("crypto");

const { ROLES, normalizeRole } = require("../constants/roles");
const { ApiError } = require("../utils/http");

const MAX_SUPER_ADMINS = 5;
const SUPER_ADMIN_LIMIT_CODE = "SUPER_ADMIN_LIMIT_REACHED";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeName = (value) => String(value || "").trim();

const normalizeCliEmail = (value) => {
  const raw = String(value || "").trim();
  const markdownMailto = raw.match(/^\[[^\]]+\]\(mailto:([^)]+)\)$/i);
  if (markdownMailto) {
    return normalizeEmail(markdownMailto[1]);
  }
  return normalizeEmail(raw.replace(/^mailto:/i, ""));
};

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));

const validatePasswordPolicy = (password) => {
  const value = String(password || "");
  const failures = [];

  if (value.length < 8) failures.push("at least 8 characters");
  if (!/[A-Z]/.test(value)) failures.push("one uppercase letter");
  if (!/[a-z]/.test(value)) failures.push("one lowercase letter");
  if (!/\d/.test(value)) failures.push("one number");
  if (!/[^A-Za-z0-9]/.test(value)) failures.push("one special character");

  return {
    valid: failures.length === 0,
    failures,
  };
};

const assertValidPassword = (password) => {
  const result = validatePasswordPolicy(password);
  if (!result.valid) {
    throw new ApiError(
      400,
      `Password must contain ${result.failures.join(", ")}.`,
      { failures: result.failures },
      "PASSWORD_POLICY_FAILED"
    );
  }
};

const assertValidEmail = (email) => {
  if (!isValidEmail(email)) {
    throw new ApiError(400, "Invalid email address.", null, "INVALID_EMAIL");
  }
};

const getDefaultDb = async () => {
  const models = require("../models");
  return (await models.init()).dbClient;
};

const writeSuperAdminAuditLog = async ({
  db,
  action,
  targetId,
  actorSuperAdminId = null,
  beforeState = null,
  afterState = null,
}) => {
  if (!db?.auditLog?.create) {
    return null;
  }

  return db.auditLog.create({
    data: {
      action,
      targetType: "SUPER_ADMIN",
      targetId,
      superAdminId: actorSuperAdminId,
      beforeState,
      afterState,
    },
  });
};

const buildEmailWhere = (email) => ({
  email: { equals: normalizeEmail(email), mode: "insensitive" },
});

const toPublicSuperAdmin = (superAdmin = null) => {
  if (!superAdmin) {
    return null;
  }

  const fullName = superAdmin.fullName || superAdmin.name || "";
  return {
    id: superAdmin.id,
    fullName,
    name: fullName,
    email: superAdmin.email,
    role: normalizeRole(superAdmin.role || ROLES.SUPER_ADMIN),
    isActive: superAdmin.isActive !== false,
    bootstrapCreated: Boolean(superAdmin.bootstrapCreated),
    createdAt: superAdmin.createdAt || null,
    updatedAt: superAdmin.updatedAt || null,
    lastLoginAt: superAdmin.lastLoginAt || null,
    lastLogin: superAdmin.lastLoginAt || null,
  };
};

const countSuperAdmins = (db) =>
  db.superAdmin.count({
    where: { role: ROLES.SUPER_ADMIN },
  });

const countActiveSuperAdmins = (db) =>
  db.superAdmin.count({
    where: {
      role: ROLES.SUPER_ADMIN,
      isActive: true,
    },
  });

const assertSuperAdminLimitAvailable = async (db) => {
  const total = await countSuperAdmins(db);
  if (total >= MAX_SUPER_ADMINS) {
    throw new ApiError(
      409,
      `A maximum of ${MAX_SUPER_ADMINS} SuperAdmin accounts is allowed.`,
      { max: MAX_SUPER_ADMINS, total },
      SUPER_ADMIN_LIMIT_CODE
    );
  }
  return total;
};

const findSuperAdminByEmail = async (db, email) =>
  db.superAdmin.findFirst({
    where: {
      role: ROLES.SUPER_ADMIN,
      ...buildEmailWhere(email),
    },
  });

const findSuperAdminById = async (db, superAdminId) =>
  db.superAdmin.findUnique({ where: { id: superAdminId } });

const createSuperAdmin = async ({
  db: providedDb = null,
  name,
  fullName,
  email,
  password,
  bootstrapCreated = false,
  actorSuperAdminId = null,
}) => {
  const db = providedDb || await getDefaultDb();
  const normalizedEmail = normalizeCliEmail(email);
  const normalizedName = normalizeName(fullName || name);

  if (!normalizedName || normalizedName.length < 2) {
    throw new ApiError(400, "Name must be at least 2 characters.", null, "INVALID_NAME");
  }
  assertValidEmail(normalizedEmail);
  assertValidPassword(password);

  await assertSuperAdminLimitAvailable(db);

  const existing = await findSuperAdminByEmail(db, normalizedEmail);
  if (existing) {
    throw new ApiError(409, "SuperAdmin with this email already exists.", null, "DUPLICATE_SUPER_ADMIN_EMAIL");
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const superAdmin = await db.superAdmin.create({
    data: {
      fullName: normalizedName,
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
      role: ROLES.SUPER_ADMIN,
      isActive: true,
      bootstrapCreated: Boolean(bootstrapCreated),
      createdBySuperAdminId: actorSuperAdminId,
      lastLoginAt: null,
      tokenVersion: 0,
    },
  });

  await writeSuperAdminAuditLog({
    db,
    action: bootstrapCreated ? "BOOTSTRAP_CREATE_SUPER_ADMIN" : "SUPER_ADMIN_CREATE_SUPER_ADMIN",
    targetId: superAdmin.id,
    actorSuperAdminId,
    afterState: toPublicSuperAdmin(superAdmin),
  });

  return superAdmin;
};

const revokeSuperAdminSessions = async (db, superAdminId, reason) => {
  const { revokeAllRefreshTokensForOwner } = require("./refresh-token-session.service");
  const { bumpPrincipalTokenVersion } = require("./auth-revocation.service");

  await bumpPrincipalTokenVersion(db, "superAdmin", superAdminId);
  await revokeAllRefreshTokensForOwner({
    db,
    modelName: "superAdminRefreshToken",
    scope: "super-admin",
    ownerField: "superAdminId",
    ownerId: superAdminId,
    reason,
  });
};

const setSuperAdminActive = async ({
  db: providedDb = null,
  superAdminId,
  isActive,
  actorSuperAdminId = null,
}) => {
  const db = providedDb || await getDefaultDb();
  const existing = await findSuperAdminById(db, superAdminId);

  if (!existing || normalizeRole(existing.role) !== ROLES.SUPER_ADMIN) {
    throw new ApiError(404, "SuperAdmin not found.", null, "SUPER_ADMIN_NOT_FOUND");
  }

  const nextActive = Boolean(isActive);
  if (!nextActive && existing.isActive !== false) {
    const activeCount = await countActiveSuperAdmins(db);
    if (activeCount <= 1) {
      throw new ApiError(
        409,
        "At least one active SuperAdmin must remain.",
        { activeCount },
        "LAST_ACTIVE_SUPER_ADMIN"
      );
    }
  }

  const updated = await db.superAdmin.update({
    where: { id: existing.id },
    data: { isActive: nextActive },
  });

  if (!nextActive) {
    await revokeSuperAdminSessions(db, existing.id, "super_admin_deactivated");
  }

  await writeSuperAdminAuditLog({
    db,
    action: nextActive ? "SUPER_ADMIN_REACTIVATE_SUPER_ADMIN" : "SUPER_ADMIN_DEACTIVATE_SUPER_ADMIN",
    targetId: existing.id,
    actorSuperAdminId,
    beforeState: toPublicSuperAdmin(existing),
    afterState: toPublicSuperAdmin(updated),
  });

  return updated;
};

const resetSuperAdminPassword = async ({
  db: providedDb = null,
  superAdminId,
  email,
  password,
  actorSuperAdminId = null,
  action = "SUPER_ADMIN_RESET_SUPER_ADMIN_PASSWORD",
}) => {
  const db = providedDb || await getDefaultDb();
  const target = superAdminId
    ? await findSuperAdminById(db, superAdminId)
    : await findSuperAdminByEmail(db, email);

  if (!target || normalizeRole(target.role) !== ROLES.SUPER_ADMIN) {
    throw new ApiError(404, "SuperAdmin not found.", null, "SUPER_ADMIN_NOT_FOUND");
  }

  assertValidPassword(password);

  const passwordHash = await bcrypt.hash(String(password), 10);
  const updated = await db.superAdmin.update({
    where: { id: target.id },
    data: { passwordHash },
  });

  await revokeSuperAdminSessions(db, target.id, "super_admin_password_reset");

  await writeSuperAdminAuditLog({
    db,
    action,
    targetId: target.id,
    actorSuperAdminId,
    beforeState: { email: target.email, isActive: target.isActive !== false },
    afterState: { email: updated.email, passwordResetAt: new Date().toISOString() },
  });

  return updated;
};

const generateTemporaryPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const special = "!@#$%^&*";
  const bytes = crypto.randomBytes(16);
  let tail = "";
  for (const byte of bytes) {
    tail += alphabet[byte % alphabet.length];
  }
  return `Tmp${tail.slice(0, 10)}1${special[bytes[0] % special.length]}`;
};

const resetSuperAdminPasswordByEmail = async ({
  db: providedDb = null,
  email,
  actorSuperAdminId = null,
}) => {
  const temporaryPassword = generateTemporaryPassword();
  const superAdmin = await resetSuperAdminPassword({
    db: providedDb,
    email,
    password: temporaryPassword,
    actorSuperAdminId,
    action: "SCRIPT_RESET_SUPER_ADMIN_PASSWORD",
  });

  return {
    superAdmin,
    temporaryPassword,
  };
};

const recordSuperAdminLogin = async ({ db: providedDb = null, superAdminId }) => {
  const db = providedDb || await getDefaultDb();
  if (!superAdminId) {
    return null;
  }

  return db.superAdmin.update({
    where: { id: superAdminId },
    data: { lastLoginAt: new Date() },
  }).catch(() => null);
};

const listSuperAdmins = async ({
  db: providedDb = null,
  page = 1,
  limit = 20,
  search = "",
  status = "",
} = {}) => {
  const db = providedDb || await getDefaultDb();
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (normalizedPage - 1) * normalizedLimit;
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const trimmedSearch = String(search || "").trim();

  const where = {
    role: ROLES.SUPER_ADMIN,
    ...(normalizedStatus === "active"
      ? { isActive: true }
      : normalizedStatus === "inactive"
        ? { isActive: false }
        : {}),
    ...(trimmedSearch
      ? {
          OR: [
            { fullName: { contains: trimmedSearch, mode: "insensitive" } },
            { name: { contains: trimmedSearch, mode: "insensitive" } },
            { email: { contains: trimmedSearch, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total, totalSuperAdmins, active, inactive] = await Promise.all([
    db.superAdmin.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: normalizedLimit,
    }),
    db.superAdmin.count({ where }),
    db.superAdmin.count({ where: { role: ROLES.SUPER_ADMIN } }),
    db.superAdmin.count({ where: { role: ROLES.SUPER_ADMIN, isActive: true } }),
    db.superAdmin.count({ where: { role: ROLES.SUPER_ADMIN, isActive: false } }),
  ]);

  return {
    data: items.map(toPublicSuperAdmin),
    counts: {
      totalSuperAdmins,
      activeSuperAdmins: active,
      inactiveSuperAdmins: inactive,
      maxSuperAdmins: MAX_SUPER_ADMINS,
      remainingSlots: Math.max(0, MAX_SUPER_ADMINS - totalSuperAdmins),
    },
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      pages: Math.ceil(total / normalizedLimit),
    },
  };
};

const verifySuperAdminState = async ({ db: providedDb = null } = {}) => {
  const db = providedDb || await getDefaultDb();
  const [totalSuperAdmins, activeSuperAdmins, inactiveSuperAdmins] = await Promise.all([
    db.superAdmin.count({ where: { role: ROLES.SUPER_ADMIN } }),
    db.superAdmin.count({ where: { role: ROLES.SUPER_ADMIN, isActive: true } }),
    db.superAdmin.count({ where: { role: ROLES.SUPER_ADMIN, isActive: false } }),
  ]);

  const violations = [];
  if (totalSuperAdmins > MAX_SUPER_ADMINS) {
    violations.push(SUPER_ADMIN_LIMIT_CODE);
  }
  if (activeSuperAdmins < 1) {
    violations.push("NO_ACTIVE_SUPER_ADMIN");
  }

  return {
    totalSuperAdmins,
    activeSuperAdmins,
    inactiveSuperAdmins,
    maxSuperAdmins: MAX_SUPER_ADMINS,
    valid: violations.length === 0,
    violations,
  };
};

module.exports = {
  MAX_SUPER_ADMINS,
  SUPER_ADMIN_LIMIT_CODE,
  assertSuperAdminLimitAvailable,
  createSuperAdmin,
  generateTemporaryPassword,
  listSuperAdmins,
  normalizeCliEmail,
  recordSuperAdminLogin,
  resetSuperAdminPassword,
  resetSuperAdminPasswordByEmail,
  setSuperAdminActive,
  toPublicSuperAdmin,
  validatePasswordPolicy,
  verifySuperAdminState,
};
