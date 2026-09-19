const models = require("../models");
const { validateDocument } = require("./model-validation.service");
const { DepartmentValidation } = require("../models/validation");
const { ApiError } = require("../utils/http");

/**
 * Create department with validation
 */
async function createDepartment(payload, collegeId, superAdminId) {
  const m = await models.init();
  const db = m.dbClient;
  // Verify college exists
  const college = await db.college.findUnique({ where: { id: collegeId } });
  if (!college) {
    throw new ApiError(422, "College not found", { collegeId }, "COLLEGE_NOT_FOUND");
  }

  // Validate department
  const validated = await validateDocument(
    DepartmentValidation,
    {
      name: payload.name,
      collegeId,
      headId: payload.headId || null,
      isActive: payload.isActive !== false,
    },
    "Department creation"
  );

  // Persist
  const department = await db.department.create({
    data: validated,
    include: {
      college: true,
    },
  });

  // Audit
  await db.auditLog.create({
    data: {
      action: "DEPARTMENT_CREATED",
      entityType: "department",
      entityId: department.id,
      userId: superAdminId,
      collegeId,
      metadata: {
        name: validated.name,
      },
    },
  });

  return department;
}

/**
 * Update department with validation
 */
async function updateDepartment(departmentId, payload, collegeId, superAdminId) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.department.findUnique({ where: { id: departmentId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Department not found or access denied");
  }

  // Validate merged data
  const validated = await validateDocument(
    DepartmentValidation,
    {
      name: payload.name || existing.name,
      collegeId,
      headId: payload.headId !== undefined ? payload.headId : existing.headId,
      isActive: payload.isActive !== undefined ? payload.isActive : existing.isActive,
    },
    "Department update"
  );

  // Persist
  const updated = await db.department.update({
    where: { id: departmentId },
    data: validated,
  });

  await db.auditLog.create({
    data: {
      action: "DEPARTMENT_UPDATED",
      entityType: "department",
      entityId: departmentId,
      userId: superAdminId,
      collegeId,
      metadata: { changes: Object.keys(payload) },
    },
  });

  return updated;
}

/**
 * Assign department head with validation
 *
 * Validates:
 * - Admin exists and is in same college
 * - Admin can manage this department
 */
async function assignDepartmentHead(departmentId, adminId, collegeId, superAdminId) {
  const m = await models.init();
  const db = m.dbClient;
  const department = await db.department.findUnique({ where: { id: departmentId } });

  if (!department || department.collegeId !== collegeId) {
    throw new ApiError(403, "Department not found");
  }

  // Verify admin exists in same college
  const admin = await db.admin.findUnique({ where: { id: adminId } });

  if (!admin || admin.collegeId !== collegeId) {
    throw new ApiError(422, "Admin not found in this college", { adminId }, "ADMIN_NOT_FOUND");
  }

  if (!admin.isActive) {
    throw new ApiError(422, "Admin is not active", { adminId }, "ADMIN_INACTIVE");
  }

  // If department-specific, validate admin is in same department
  if (department.departmentId && admin.departmentId !== department.departmentId) {
    throw new ApiError(422, "Admin must be in the same department", { adminDept: admin.departmentId, deptId: department.departmentId }, "ADMIN_NOT_IN_DEPARTMENT");
  }

  // Validate with new head
  const validated = await validateDocument(
    DepartmentValidation,
    {
      ...department,
      headId: adminId,
    },
    "Department head assignment"
  );

  // Persist
  const updated = await db.department.update({
    where: { id: departmentId },
    data: validated,
  });

  await db.auditLog.create({
    data: {
      action: "DEPARTMENT_HEAD_ASSIGNED",
      entityType: "department",
      entityId: departmentId,
      userId: superAdminId,
      collegeId,
      metadata: {
        newHeadId: adminId,
        adminName: admin.fullName,
      },
    },
  });

  return updated;
}

/**
 * Remove department head
 */
async function removeDepartmentHead(departmentId, collegeId, superAdminId) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.department.findUnique({ where: { id: departmentId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Department not found");
  }

  // Validate with no head
  const validated = await validateDocument(
    DepartmentValidation,
    {
      ...existing,
      headId: null,
    },
    "Department head removal"
  );

  // Persist
  const updated = await db.department.update({
    where: { id: departmentId },
    data: validated,
  });

  await db.auditLog.create({
    data: {
      action: "DEPARTMENT_HEAD_REMOVED",
      entityType: "department",
      entityId: departmentId,
      userId: superAdminId,
      collegeId,
    },
  });

  return updated;
}

/**
 * Toggle department status
 */
async function toggleDepartmentStatus(departmentId, collegeId, superAdminId, isActive) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.department.findUnique({ where: { id: departmentId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Department not found");
  }

  const validated = await validateDocument(
    DepartmentValidation,
    {
      ...existing,
      isActive,
    },
    "Department status toggle"
  );

  const updated = await db.department.update({
    where: { id: departmentId },
    data: { isActive: validated.isActive },
  });

  await db.auditLog.create({
    data: {
      action: isActive ? "DEPARTMENT_ACTIVATED" : "DEPARTMENT_DEACTIVATED",
      entityType: "department",
      entityId: departmentId,
      userId: superAdminId,
      collegeId,
    },
  });

  return updated;
}

module.exports = {
  createDepartment,
  updateDepartment,
  assignDepartmentHead,
  removeDepartmentHead,
  toggleDepartmentStatus,
};
