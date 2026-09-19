const bcrypt = require("bcrypt");
const models = require("../../models");
const { ApiError, asyncHandler } = require("../../utils/http");
const { getPagination } = require("../../utils/pagination");
const { createAuditLog } = require("../../services/audit.service");
const { invalidateRefreshTokenRecord } = require("../../services/refresh-token-cache.service");
const { bumpPrincipalTokenVersion, invalidatePrincipalAuthCache } = require("../../services/auth-revocation.service");
const { ROLES } = require("../../constants/roles");
const { ADMIN_ACCESS_PROFILES, resolvePermissionsFromProfile } = require("../../constants/admin-access-profiles");
const { toPublicAdmin, toPublicAdmins } = require("../../utils/serializers");

const revokeAdminRefreshTokens = async (db, adminId) => {
  await bumpPrincipalTokenVersion(db, "admin", adminId);

  const activeTokens = await db.adminRefreshToken.findMany({
    where: { adminId, revokedAt: null },
  });

  await db.adminRefreshToken.updateMany({
    where: { adminId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await Promise.all(activeTokens.map((record) => invalidateRefreshTokenRecord("admin", record)));
};

const getManagedAdmins = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { page, limit, skip } = getPagination(req.query);
  const search = String(req.query.search || "").trim();
  const departmentId = req.query.departmentId;
  const status = String(req.query.status || "all").trim().toLowerCase();

  const where = {
    collegeId: req.collegeId,
    role: ROLES.ADMIN,
    ...(departmentId ? { departmentId } : {}),
    ...(status === "active"
      ? { isActive: true }
      : status === "inactive"
        ? { isActive: false }
        : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { employeeId: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.admin.findMany({
      where,
      include: {
        department: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.admin.count({ where }),
  ]);

  res.status(200).json({
    data: toPublicAdmins(items),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

const createManagedAdmin = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const {
    fullName,
    email,
    employeeId,
    password,
    departmentId,
    accessProfile = ADMIN_ACCESS_PROFILES.EDITOR,
  } = req.body;

  const department = await db.department.findFirst({
    where: {
      id: departmentId,
      collegeId: req.collegeId,
    },
  });

  if (!department) {
    throw new ApiError(400, "Department not found for this college");
  }

  const duplicate = await db.admin.findFirst({
    where: {
      collegeId: req.collegeId,
      OR: [
        { email: String(email).toLowerCase() },
        { employeeId },
      ],
    },
  });

  if (duplicate) {
    throw new ApiError(409, "Admin with this email or employeeId already exists in this college");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await db.admin.create({
    data: {
      fullName,
      email: String(email).toLowerCase(),
      employeeId,
      passwordHash,
      role: ROLES.ADMIN,
      collegeId: req.collegeId,
      departmentId,
      accessProfile,
      permissions: resolvePermissionsFromProfile(accessProfile),
      isActive: true,
    },
    include: {
      department: {
        select: { id: true, name: true },
      },
    },
  });

  await createAuditLog({
    action: "COLLEGE_ADMIN_CREATE_ADMIN",
    targetType: "ADMIN",
    targetId: admin.id,
    collegeId: req.collegeId,
    adminId: req.admin.id,
    afterState: {
      id: admin.id,
      email: admin.email,
      employeeId: admin.employeeId,
      departmentId: admin.departmentId,
      accessProfile: admin.accessProfile,
      isActive: admin.isActive,
    },
  });

  res.status(201).json(toPublicAdmin(admin));
});

const updateManagedAdmin = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { adminId } = req.params;
  const existing = await db.admin.findFirst({
    where: {
      id: adminId,
      collegeId: req.collegeId,
      role: ROLES.ADMIN,
    },
  });

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  if (req.body.departmentId) {
    const department = await db.department.findFirst({
      where: { id: req.body.departmentId, collegeId: req.collegeId },
      select: { id: true },
    });

    if (!department) {
      throw new ApiError(400, "Department not found for this college");
    }
  }

  const data = {
    ...(req.body.fullName !== undefined ? { fullName: req.body.fullName } : {}),
    ...(req.body.departmentId !== undefined ? { departmentId: req.body.departmentId } : {}),
    ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
    ...(req.body.accessProfile !== undefined
      ? {
          accessProfile: req.body.accessProfile,
          permissions: resolvePermissionsFromProfile(req.body.accessProfile),
        }
      : {}),
  };

  const updated = await db.admin.update({
    where: { id: adminId },
    data,
    include: {
      department: {
        select: { id: true, name: true },
      },
    },
  });
  if (data.isActive === false) {
    await bumpPrincipalTokenVersion(db, "admin", adminId);
  } else {
    await invalidatePrincipalAuthCache("admin", adminId);
  }

  await createAuditLog({
    action: "COLLEGE_ADMIN_UPDATE_ADMIN",
    targetType: "ADMIN",
    targetId: updated.id,
    collegeId: req.collegeId,
    adminId: req.admin.id,
    beforeState: existing,
    afterState: updated,
  });

  res.status(200).json(toPublicAdmin(updated));
});

const resetManagedAdminPassword = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { adminId } = req.params;
  const existing = await db.admin.findFirst({
    where: {
      id: adminId,
      collegeId: req.collegeId,
      role: ROLES.ADMIN,
    },
  });

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const passwordHash = await bcrypt.hash(String(req.body.password || "").trim(), 10);
  await db.admin.update({
    where: { id: adminId },
    data: { passwordHash },
  });
  await revokeAdminRefreshTokens(db, adminId);

  await createAuditLog({
    action: "COLLEGE_ADMIN_RESET_ADMIN_PASSWORD",
    targetType: "ADMIN",
    targetId: adminId,
    collegeId: req.collegeId,
    adminId: req.admin.id,
  });

  res.status(200).json({ message: "Admin password reset" });
});

const deactivateManagedAdmin = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { adminId } = req.params;
  const existing = await db.admin.findFirst({
    where: {
      id: adminId,
      collegeId: req.collegeId,
      role: ROLES.ADMIN,
    },
  });

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const expectedConfirmation = `DEACTIVATE ${existing.employeeId || existing.id}`;
  if (String(req.body.confirmationText || "") !== expectedConfirmation) {
    throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
  }

  await db.admin.update({
    where: { id: adminId },
    data: { isActive: false },
  });
  await revokeAdminRefreshTokens(db, adminId);

  await createAuditLog({
    action: "COLLEGE_ADMIN_DEACTIVATE_ADMIN",
    targetType: "ADMIN",
    targetId: adminId,
    collegeId: req.collegeId,
    adminId: req.admin.id,
    beforeState: { isActive: existing.isActive },
    afterState: { isActive: false },
  });

  res.status(200).json({ message: "Admin deactivated" });
});

module.exports = {
  getManagedAdmins,
  createManagedAdmin,
  updateManagedAdmin,
  resetManagedAdminPassword,
  deactivateManagedAdmin,
};
