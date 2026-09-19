const models = require("../models");
const bcrypt = require("bcrypt");
const { validateDocument } = require("./model-validation.service");
const { UserValidation } = require("../models/validation");
const { ApiError } = require("../utils/http");
const { bumpPrincipalTokenVersion, invalidatePrincipalAuthCache } = require("./auth-revocation.service");

/**
 * Create admin user with validation
 *
 * Validates role is ADMIN and persists with audit trail
 */
async function createAdmin(payload, collegeId, superAdminId) {
  const m = await models.init();
  const db = m.dbClient;
  // Verify college exists
  const college = await db.college.findUnique({ where: { id: collegeId } });
  if (!college) {
    throw new ApiError(422, "College not found", { collegeId }, "COLLEGE_NOT_FOUND");
  }

  // Validate admin - role enforced as ADMIN
  const validated = await validateDocument(
    UserValidation,
    {
      fullName: payload.fullName,
      email: (payload.email || "").toLowerCase(),
      role: "ADMIN",
      collegeId,
      departmentId: payload.departmentId || null,
      isActive: payload.isActive !== false,
    },
    "Admin creation"
  );

  // Hash password
  const passwordHash = await bcrypt.hash(payload.password, 10);

  // Persist using modelClient
  const admin = await db.admin.create({
    data: {
      ...validated,
      employeeId: payload.employeeId || `EMP-${Date.now()}`,
      passwordHash,
      permissions: payload.permissions || [],
      accessLevel: payload.accessLevel || "STANDARD",
      metadata: payload.metadata || {},
    },
    include: {
      college: true,
      department: true,
    },
  });

  // Audit
  await db.auditLog.create({
    data: {
      action: "ADMIN_CREATED",
      entityType: "admin",
      entityId: admin.id,
      userId: superAdminId,
      collegeId,
      metadata: {
        fullName: validated.fullName,
        email: validated.email,
        employeeId: admin.employeeId,
      },
    },
  });

  return admin;
}

/**
 * Update admin with validation
 */
async function updateAdmin(adminId, payload, collegeId, superAdminId) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.admin.findUnique({ where: { id: adminId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Admin not found or access denied");
  }

  // Validate merged data
  const validated = await validateDocument(
    UserValidation,
    {
      fullName: payload.fullName || existing.fullName,
      email: payload.email ? (payload.email || "").toLowerCase() : existing.email,
      role: "ADMIN",
      collegeId,
      departmentId: payload.departmentId !== undefined ? payload.departmentId : existing.departmentId,
      isActive: payload.isActive !== undefined ? payload.isActive : existing.isActive,
    },
    "Admin update"
  );

  // Hash password if provided
  const updateData = {
    ...validated,
    permissions: payload.permissions || existing.permissions,
    accessLevel: payload.accessLevel || existing.accessLevel,
  };

  if (payload.password) {
    updateData.passwordHash = await bcrypt.hash(payload.password, 10);
  }

  // Persist
  const updated = await db.admin.update({
    where: { id: adminId },
    data: updateData,
  });

  if (payload.password || payload.isActive === false) {
    await bumpPrincipalTokenVersion(db, "admin", adminId);
  } else {
    await invalidatePrincipalAuthCache("admin", adminId);
  }

  await db.auditLog.create({
    data: {
      action: "ADMIN_UPDATED",
      entityType: "admin",
      entityId: adminId,
      userId: superAdminId,
      collegeId,
      metadata: { changes: Object.keys(payload) },
    },
  });

  return updated;
}

/**
 * Assign permissions to admin
 */
async function assignPermissions(adminId, collegeId, permissions, superAdminId) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.admin.findUnique({ where: { id: adminId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Admin not found");
  }

  // Validate permissions are array of strings
  if (!Array.isArray(permissions)) {
    throw new ApiError(422, "Permissions must be an array", { permissions });
  }

  const updated = await db.admin.update({
    where: { id: adminId },
    data: { permissions },
  });

  await invalidatePrincipalAuthCache("admin", adminId);

  await db.auditLog.create({
    data: {
      action: "ADMIN_PERMISSIONS_UPDATED",
      entityType: "admin",
      entityId: adminId,
      userId: superAdminId,
      collegeId,
      metadata: { permissionCount: permissions.length },
    },
  });

  return updated;
}

/**
 * Activate/deactivate admin
 */
async function toggleAdminStatus(adminId, collegeId, superAdminId, isActive) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.admin.findUnique({ where: { id: adminId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Admin not found");
  }

  // Validate status
  const validated = await validateDocument(
    UserValidation,
    {
      ...existing,
      role: "ADMIN",
      isActive,
    },
    "Admin status toggle"
  );

  const updated = await db.admin.update({
    where: { id: adminId },
    data: { isActive: validated.isActive },
  });

  if (!validated.isActive) {
    await bumpPrincipalTokenVersion(db, "admin", adminId);
  } else {
    await invalidatePrincipalAuthCache("admin", adminId);
  }

  await db.auditLog.create({
    data: {
      action: isActive ? "ADMIN_ACTIVATED" : "ADMIN_DEACTIVATED",
      entityType: "admin",
      entityId: adminId,
      userId: superAdminId,
      collegeId,
    },
  });

  return updated;
}

module.exports = {
  createAdmin,
  updateAdmin,
  assignPermissions,
  toggleAdminStatus,
};
