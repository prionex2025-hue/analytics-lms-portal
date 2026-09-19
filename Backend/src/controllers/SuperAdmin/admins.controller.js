const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { invalidateRefreshTokenRecord } = require("../../services/refresh-token-cache.service");
const { bumpPrincipalTokenVersion, invalidatePrincipalAuthCache } = require("../../services/auth-revocation.service");
const { ApiError, asyncHandler } = require("../../utils/http");
const {
  ADMIN_ACCESS_PROFILES,
  resolvePermissionsForRole,
} = require("../../constants/admin-access-profiles");
const { ROLES, normalizeRole } = require("../../constants/roles");
const { getPagination } = require("../../utils/pagination");
const { toPublicAdmin, toPublicAdmins } = require("../../utils/serializers");

const MAX_ACTIVE_COLLEGE_ADMINS_PER_COLLEGE = 5;

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

const resolveAdminById = async (Admin, adminId) => {
  const byId = await Admin.findUnique({ where: { id: adminId } });
  if (byId) return byId;
  const byStringObjectId = await Admin.findFirst({ where: { _id: adminId } });
  if (byStringObjectId) return byStringObjectId;
  if (mongoose.isValidObjectId(adminId)) {
    return Admin.findFirst({ where: { _id: new mongoose.Types.ObjectId(adminId) } });
  }
  return null;
};

const resolveAdminUpdateWhere = (adminId, existing) => {
  if (existing?.id) {
    return { id: existing.id };
  }
  if (mongoose.isValidObjectId(adminId)) {
    return { _id: new mongoose.Types.ObjectId(adminId) };
  }
  return { _id: adminId };
};

const assertCollegeAdminLimitAvailable = async (Admin, collegeId, excludeAdminId = null) => {
  const activeCollegeAdminCount = await Admin.count({
    where: {
      collegeId,
      role: ROLES.COLLEGE_ADMIN,
      isActive: true,
      ...(excludeAdminId ? { id: { not: excludeAdminId } } : {}),
    },
  });

  if (activeCollegeAdminCount >= MAX_ACTIVE_COLLEGE_ADMINS_PER_COLLEGE) {
    throw new ApiError(
      409,
      `A college can have up to ${MAX_ACTIVE_COLLEGE_ADMINS_PER_COLLEGE} active college admins`,
      { limit: MAX_ACTIVE_COLLEGE_ADMINS_PER_COLLEGE, activeCollegeAdminCount },
      "COLLEGE_ADMIN_LIMIT_REACHED"
    );
  }
};

const parseCsvRecords = (csvText) => {
  const records = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const text = String(csvText || "");

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) records.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) records.push(row);
  return records;
};

const parseCsv = (csvText) => {
  const rows = parseCsvRecords(csvText);

  if (rows.length === 0) return [];

  const headers = rows[0].map((value) => value.trim().toLowerCase());
  return rows.slice(1).map((values, rowIndex) => {
    const record = { __row: rowIndex + 2 };
    headers.forEach((key, index) => {
      record[key] = values[index] || "";
    });
    return record;
  });
};

const normalizeColumnKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getRowValue = (row, aliases = []) => {
  const aliasSet = new Set(aliases.map(normalizeColumnKey));
  for (const [key, value] of Object.entries(row || {})) {
    if (aliasSet.has(normalizeColumnKey(key))) {
      return String(value || "").trim();
    }
  }
  return "";
};

const getAdmins = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const search = (req.query.search || "").trim();
  const collegeId = req.query.collegeId;
  const status = String(req.query.status || "").trim().toLowerCase();
  const role = req.query.role ? normalizeRole(req.query.role) : null;

  const statusFilter =
    status === "active"
      ? { isActive: true }
      : status === "inactive"
        ? { isActive: false }
        : {};

  const where = {
    ...statusFilter,
    ...(collegeId ? { collegeId } : {}),
    ...(role ? { role } : {}),
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
    (async () => {
      const m = await models.init();
      return m.dbClient.admin.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      });
    })(),
    (async () => {
      const m = await models.init();
      return m.dbClient.admin.count({ where });
    })(),
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

const createAdmin = asyncHandler(async (req, res) => {
  const {
    fullName,
    email,
    employeeId,
    password,
    role = ROLES.ADMIN,
    collegeId,
    departmentId,
    accessProfile = ADMIN_ACCESS_PROFILES.EDITOR,
  } = req.body;
  const normalizedRole = normalizeRole(role);

  const m = await models.init();
  const College = m.dbClient.college;
  const Admin = m.dbClient.admin;
  const Department = m.dbClient.department;

  const college = await College.findUnique({ where: { id: collegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Admin cannot be created for inactive or missing college");
  }

  if (normalizedRole !== ROLES.ADMIN && normalizedRole !== ROLES.COLLEGE_ADMIN) {
    throw new ApiError(422, "Invalid role for admin creation");
  }

  if (normalizedRole === ROLES.ADMIN && !departmentId) {
    throw new ApiError(422, "Department is required for admin", null, "MISSING_DEPARTMENT_ID");
  }

  if (normalizedRole === ROLES.ADMIN) {
    const department = await Department.findFirst({
      where: { id: departmentId, collegeId },
    });
    if (!department) {
      throw new ApiError(400, "Department not found for selected college");
    }
  }

  if (normalizedRole === ROLES.COLLEGE_ADMIN) {
    await assertCollegeAdminLimitAvailable(Admin, collegeId);
  }

  const existing = await Admin.findFirst({
    where: {
      OR: [
        { email, collegeId },
        { employeeId, collegeId },
      ],
    },
  });

  if (existing) {
    throw new ApiError(409, "Admin with this email or employeeId already exists in college");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await Admin.create({
    data: {
      fullName,
      email,
      employeeId,
      passwordHash,
      role: normalizedRole,
      collegeId,
      departmentId: normalizedRole === ROLES.ADMIN ? departmentId : null,
      accessProfile,
      permissions: resolvePermissionsForRole(normalizedRole, accessProfile),
      isActive: true,
    },
  });

  await createAuditLog({
    action: normalizedRole === ROLES.COLLEGE_ADMIN ? "SUPER_ADMIN_CREATE_COLLEGE_ADMIN" : "SUPER_ADMIN_CREATE_ADMIN",
    targetType: "ADMIN",
    targetId: admin.id,
    collegeId: admin.collegeId,
    superAdminId: req.superAdmin.id,
    afterState: {
      id: admin.id,
      email: admin.email,
      employeeId: admin.employeeId,
      role: admin.role,
      accessProfile: admin.accessProfile,
      isActive: admin.isActive,
    },
  });

  res.status(201).json(toPublicAdmin(admin));
});

const updateAdmin = asyncHandler(async (req, res) => {
  const { adminId } = req.params;
  const m = await models.init();
  const Admin = m.dbClient.admin;
  const College = m.dbClient.college;
  const Department = m.dbClient.department;
  const existing = await resolveAdminById(Admin, adminId);

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const nextRole = normalizeRole(req.body.role || existing.role || ROLES.ADMIN);
  const nextCollegeId = req.body.collegeId ?? existing.collegeId;
  const hasDepartmentUpdate = Object.prototype.hasOwnProperty.call(req.body || {}, "departmentId");
  const requestedDepartmentId = hasDepartmentUpdate ? req.body.departmentId : existing.departmentId;
  const nextDepartmentId = nextRole === ROLES.COLLEGE_ADMIN ? null : requestedDepartmentId;

  if (!nextCollegeId) {
    throw new ApiError(422, "Admin must belong to a college", null, "COLLEGE_SCOPE_REQUIRED");
  }

  if (nextRole !== ROLES.ADMIN && nextRole !== ROLES.COLLEGE_ADMIN) {
    throw new ApiError(422, "Unsupported admin role");
  }

  if (nextRole === ROLES.ADMIN && !nextDepartmentId) {
    throw new ApiError(422, "Department is required for admin", null, "MISSING_DEPARTMENT_ID");
  }

  const college = await College.findUnique({ where: { id: nextCollegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Admin cannot be assigned to inactive or missing college");
  }

  if (nextRole === ROLES.ADMIN) {
    const department = await Department.findFirst({
      where: { id: nextDepartmentId, collegeId: nextCollegeId },
    });
    if (!department) {
      throw new ApiError(400, "Department not found for selected college");
    }
  }

  const nextIsActive = req.body.isActive !== undefined ? req.body.isActive : existing.isActive;
  if (nextRole === ROLES.COLLEGE_ADMIN && nextIsActive) {
    await assertCollegeAdminLimitAvailable(Admin, nextCollegeId, existing.id);
  }

  const nextAccessProfile = req.body.accessProfile ?? existing.accessProfile ?? ADMIN_ACCESS_PROFILES.EDITOR;
  const data = {
    ...(req.body.fullName !== undefined ? { fullName: req.body.fullName } : {}),
    ...(req.body.role !== undefined ? { role: nextRole } : {}),
    ...(req.body.collegeId !== undefined ? { collegeId: req.body.collegeId } : {}),
    ...(hasDepartmentUpdate || nextRole === ROLES.COLLEGE_ADMIN ? { departmentId: nextDepartmentId } : {}),
    ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
    ...((req.body.accessProfile !== undefined || req.body.role !== undefined)
      ? {
          accessProfile: nextAccessProfile,
          permissions: resolvePermissionsForRole(nextRole, nextAccessProfile),
        }
      : {}),
  };

  const updated = await Admin.update({
    where: resolveAdminUpdateWhere(adminId, existing),
    data,
  });

  if (!updated) {
    throw new ApiError(404, "Admin not found");
  }

  if (data.isActive === false) {
    await bumpPrincipalTokenVersion(m.dbClient, "admin", existing.id);
  } else {
    await invalidatePrincipalAuthCache("admin", existing.id);
  }

  await createAuditLog({
    action: "SUPER_ADMIN_UPDATE_ADMIN",
    targetType: "ADMIN",
    targetId: updated.id,
    collegeId: updated.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: updated,
  });

  res.status(200).json(toPublicAdmin(updated));
});

const resetAdminPassword = asyncHandler(async (req, res) => {
  const { adminId } = req.params;
  const m = await models.init();
  const db = m.dbClient;
  const Admin = db.admin;
  const existing = await resolveAdminById(Admin, adminId);

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const newPassword = String(req.body.password || "").trim();
  if (newPassword.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await Admin.update({
    where: resolveAdminUpdateWhere(adminId, existing),
    data: { passwordHash },
  });
  await revokeAdminRefreshTokens(db, existing.id);

  await createAuditLog({
    action: "SUPER_ADMIN_RESET_ADMIN_PASSWORD",
    targetType: "ADMIN",
    targetId: adminId,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
  });

  res.status(200).json({
    message: "Admin password reset",
  });
});

const deleteAdmin = asyncHandler(async (req, res) => {
  const { adminId } = req.params;

  const m = await models.init();
  const db = m.dbClient;
  const Admin = db.admin;

  const existing = await resolveAdminById(Admin, adminId);
  const existingWithCount = await Admin.findUnique({
    where: resolveAdminUpdateWhere(adminId, existing),
    include: { _count: { select: { createdTests: true } } },
  });

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const expectedConfirmation = `DEACTIVATE ${existing.employeeId || existing.id}`;
  if (req.body?.confirmationText !== expectedConfirmation) {
    throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
  }

  await Admin.update({
    where: resolveAdminUpdateWhere(adminId, existing),
    data: { isActive: false },
  });
  await revokeAdminRefreshTokens(db, existing.id);

  await createAuditLog({
    action: "SUPER_ADMIN_DEACTIVATE_ADMIN",
    targetType: "ADMIN",
    targetId: adminId,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      isActive: existing.isActive,
      createdTests: existingWithCount?._count?.createdTests || 0,
    },
    afterState: { isActive: false },
  });

  res.status(200).json({
    message: "Admin deactivated",
    note: existingWithCount?._count?.createdTests > 0 ? "Reassign admin's tests if needed" : null,
  });
});

const bulkImportAdmins = asyncHandler(async (req, res) => {
  const { csvData, defaultCollegeId } = req.body;
  const rows = parseCsv(csvData);

  if (!rows.length) {
    throw new ApiError(400, "No admin rows found in import file");
  }

  const m = await models.init();
  const College = m.dbClient.college;
  const Admin = m.dbClient.admin;
  const Department = m.dbClient.department;

  const colleges = await College.findMany({
    where: { isActive: true },
  });

  const byId = new Map(colleges.map((college) => [String(college.id), college]));
  const byCode = new Map(colleges.map((college) => [String(college.code || "").toLowerCase(), college]));
  const byName = new Map(colleges.map((college) => [String(college.name || "").toLowerCase(), college]));

  const fallbackCollege = defaultCollegeId ? byId.get(String(defaultCollegeId)) : null;
  if (defaultCollegeId && !fallbackCollege) {
    throw new ApiError(400, "Default college is missing or inactive");
  }

  const result = {
    created: 0,
    failed: 0,
    duplicates: 0,
    errors: [],
  };

  for (const row of rows) {
    const fullName = getRowValue(row, ["fullName", "full_name", "name", "adminName", "admin_name"]);
    const email = getRowValue(row, ["email", "emailAddress"]);
    const employeeId = getRowValue(row, ["employeeId", "employee_id", "staffId", "staff_id"]);
    const passwordInput = getRowValue(row, ["password"]);
    const collegeIdInput = getRowValue(row, ["collegeId", "college_id"]);
    const collegeCodeInput = getRowValue(row, ["collegeCode", "college_code", "code"]);
    const collegeNameInput = getRowValue(row, ["collegeName", "college_name", "college"]);
    const departmentInput = getRowValue(row, ["department", "departmentName", "department_name", "departmentId", "department_id"]);

    if (!fullName || !email || !employeeId) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Missing required columns: fullName, email, employeeId" });
      continue;
    }

    const resolvedCollege =
      (collegeIdInput ? byId.get(String(collegeIdInput)) : null)
      || (collegeCodeInput ? byCode.get(String(collegeCodeInput).toLowerCase()) : null)
      || (collegeNameInput ? byName.get(String(collegeNameInput).toLowerCase()) : null)
      || fallbackCollege
      || null;

    if (!resolvedCollege) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Unable to resolve college (collegeId/collegeCode/collegeName/defaultCollegeId)" });
      continue;
    }

    if (!departmentInput) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Missing required column: department" });
      continue;
    }

    const duplicate = await Admin.findFirst({
      where: {
        collegeId: resolvedCollege.id,
        OR: [
          { email },
          { employeeId },
        ],
      },
    });

    if (duplicate) {
      result.duplicates += 1;
      result.errors.push({ row: row.__row, reason: "Duplicate admin email or employeeId for selected college" });
      continue;
    }

    const byDepartmentId = await Department.findFirst({
      where: {
        id: departmentInput,
        collegeId: resolvedCollege.id,
      },
    });

    const resolvedDepartment = byDepartmentId || await Department.findFirst({
      where: {
        collegeId: resolvedCollege.id,
        name: {
          equals: departmentInput,
          mode: "insensitive",
        },
      },
    });

    if (!resolvedDepartment) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Department not found for selected college" });
      continue;
    }

    const plainPassword = passwordInput || "Admin@12345";
    if (plainPassword.length < 8) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Password must be at least 8 characters" });
      continue;
    }

    const passwordHash = await bcrypt.hash(plainPassword, 10);
    await Admin.create({
      data: {
        fullName,
        email,
        employeeId,
        passwordHash,
        role: "ADMIN",
        collegeId: resolvedCollege.id,
        departmentId: resolvedDepartment.id,
        isActive: true,
      },
    });

    result.created += 1;
  }

  await createAuditLog({
    action: "SUPER_ADMIN_BULK_IMPORT_ADMINS",
    targetType: "ADMIN_IMPORT",
    targetId: `ADMIN_IMPORT_${Date.now()}`,
    superAdminId: req.superAdmin.id,
    afterState: {
      defaultCollegeId: fallbackCollege?.id || null,
      summary: result,
    },
  });

  res.status(200).json({
    message: "Admin bulk import processed",
    result,
  });
});

module.exports = {
  getAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
  deleteAdmin,
  bulkImportAdmins,
};
