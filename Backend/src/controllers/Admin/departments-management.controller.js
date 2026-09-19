const models = require("../../models");
const { ApiError, asyncHandler } = require("../../utils/http");
const { createAuditLog } = require("../../services/audit.service");

const getScopedDepartments = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;

  const departments = await db.department.findMany({
    where: {
      collegeId: req.collegeId,
    },
    include: {
      head: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      _count: {
        select: {
          batches: true,
          students: true,
          tests: true,
          admins: true,
        },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  res.status(200).json(departments);
});

const createScopedDepartment = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const name = String(req.body.name || "").trim();

  const duplicate = await db.department.findFirst({
    where: {
      collegeId: req.collegeId,
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
  });

  if (duplicate) {
    throw new ApiError(409, "Department already exists in this college");
  }

  const department = await db.department.create({
    data: {
      name,
      collegeId: req.collegeId,
      isActive: true,
    },
  });

  await createAuditLog({
    action: "COLLEGE_ADMIN_CREATE_DEPARTMENT",
    targetType: "DEPARTMENT",
    targetId: department.id,
    collegeId: req.collegeId,
    adminId: req.admin.id,
    afterState: {
      id: department.id,
      name: department.name,
      isActive: department.isActive,
    },
  });

  res.status(201).json(department);
});

const updateScopedDepartment = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { departmentId } = req.params;

  const existing = await db.department.findFirst({
    where: {
      id: departmentId,
      collegeId: req.collegeId,
    },
  });

  if (!existing) {
    throw new ApiError(404, "Department not found");
  }

  if (req.body.name) {
    const duplicate = await db.department.findFirst({
      where: {
        collegeId: req.collegeId,
        id: { not: departmentId },
        name: {
          equals: req.body.name,
          mode: "insensitive",
        },
      },
    });

    if (duplicate) {
      throw new ApiError(409, "Department with this name already exists in this college");
    }
  }

  const updated = await db.department.update({
    where: { id: departmentId },
    data: {
      ...(req.body.name !== undefined ? { name: req.body.name } : {}),
      ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
    },
  });

  await createAuditLog({
    action: "COLLEGE_ADMIN_UPDATE_DEPARTMENT",
    targetType: "DEPARTMENT",
    targetId: updated.id,
    collegeId: req.collegeId,
    adminId: req.admin.id,
    beforeState: existing,
    afterState: updated,
  });

  res.status(200).json(updated);
});

const deleteScopedDepartment = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { departmentId } = req.params;

  const existing = await db.department.findFirst({
    where: {
      id: departmentId,
      collegeId: req.collegeId,
    },
    include: {
      _count: {
        select: {
          admins: true,
          batches: true,
          students: true,
          tests: true,
        },
      },
    },
  });

  if (!existing) {
    throw new ApiError(404, "Department not found");
  }

  const expectedConfirmation = `DELETE ${existing.name}`;
  if (String(req.body.confirmationText || "") !== expectedConfirmation) {
    throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
  }

  const linkedCounts = {
    admins: Number(existing?._count?.admins || 0),
    batches: Number(existing?._count?.batches || 0),
    students: Number(existing?._count?.students || 0),
    tests: Number(existing?._count?.tests || 0),
  };

  if (Object.values(linkedCounts).some((count) => count > 0)) {
    throw new ApiError(
      409,
      "Cannot delete department with linked records",
      { linkedCounts },
      "DEPARTMENT_DELETE_BLOCKED"
    );
  }

  await db.department.delete({
    where: { id: departmentId },
  });

  await createAuditLog({
    action: "COLLEGE_ADMIN_DELETE_DEPARTMENT",
    targetType: "DEPARTMENT",
    targetId: existing.id,
    collegeId: req.collegeId,
    adminId: req.admin.id,
    beforeState: {
      id: existing.id,
      name: existing.name,
    },
  });

  res.status(200).json({ message: "Department deleted" });
});

module.exports = {
  getScopedDepartments,
  createScopedDepartment,
  updateScopedDepartment,
  deleteScopedDepartment,
};
