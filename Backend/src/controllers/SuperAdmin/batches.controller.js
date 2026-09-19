const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");
const { getPagination } = require("../../utils/pagination");
const { invalidatePrincipalAuthCache } = require("../../services/auth-revocation.service");

const normalizeIdList = (ids = []) => [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean))];

const assignStudentsToBatchRecord = async ({ db, batch, studentIds }) => {
  const requestedStudentIds = normalizeIdList(studentIds);
  if (!requestedStudentIds.length) {
    return { requested: 0, updated: 0, invalidStudentIds: [] };
  }

  const students = await db.student.findMany({
    where: {
      id: { in: requestedStudentIds },
      collegeId: batch.collegeId,
      ...(batch.isGlobal && Array.isArray(batch.departmentIds) && batch.departmentIds.length > 0
        ? { departmentId: { in: batch.departmentIds } }
        : batch.isGlobal
          ? {}
          : { departmentId: batch.departmentId }),
    },
    select: { id: true, batchId: true, batchIds: true },
  });

  const validStudentIds = new Set(students.map((student) => String(student.id)));
  const invalidStudentIds = requestedStudentIds.filter((id) => !validStudentIds.has(String(id)));

  if (students.length > 0) {
    await db.$transaction(students.map((student) => {
      const batchIds = [...new Set([
        ...(Array.isArray(student.batchIds) ? student.batchIds : []),
        student.batchId,
        batch.id,
      ].filter(Boolean).map((id) => String(id)))];

      return db.student.update({
        where: { id: student.id },
        data: {
          batchId: batch.id,
          batchIds,
          ...(batch.isGlobal ? {} : { departmentId: batch.departmentId }),
        },
      });
    }));
    await Promise.all(students.map((student) => invalidatePrincipalAuthCache("student", student.id)));
  }

  return {
    requested: requestedStudentIds.length,
    updated: students.length,
    invalidStudentIds,
  };
};

const getBatchesGlobal = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const collegeId = req.query.collegeId;
  const search = (req.query.search || "").trim();

  const where = {
    ...(collegeId ? { collegeId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            {
              department: {
                name: { contains: search, mode: "insensitive" },
              },
            },
            {
              college: {
                name: { contains: search, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    (async () => {
      const m = await models.init();
      return m.dbClient.batch.findMany({
        where,
        include: {
          college: true,
          department: true,
          departments: true,
          _count: {
            select: { students: true, tests: true, testAssignments: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      });
    })(),
    (async () => {
      const m = await models.init();
      return m.dbClient.batch.count({ where });
    })(),
  ]);

  res.status(200).json({
    data: items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

const assignTestToBatches = asyncHandler(async (req, res) => {
  const { testId, batchIds = [] } = req.body;

  if (!testId) {
    throw new ApiError(400, "testId is required");
  }

  const requestedBatchIds = [...new Set((Array.isArray(batchIds) ? batchIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!requestedBatchIds.length) {
    throw new ApiError(400, "At least one batchId is required");
  }

  const m = await models.init();
  const Test = m.dbClient.test;
  const Batch = m.dbClient.batch;

  const test = await Test.findUnique({ where: { id: testId } });
  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  const validBatches = await Batch.findMany({
    where: {
      id: { in: requestedBatchIds },
      collegeId: test.collegeId,
    },
  });

  const validBatchIds = new Set(validBatches.map((batch) => String(batch.id)));
  const invalidBatchIds = requestedBatchIds.filter((id) => !validBatchIds.has(String(id)));

  if (!validBatches.length) {
    throw new ApiError(400, "No valid batches found in the test college", { invalidBatchIds, collegeId: test.collegeId });
  }

  const TestBatch = m.dbClient.testBatch;
  const existingAssignments = await TestBatch.findMany({
    where: {
      testId,
      batchId: { in: [...validBatchIds] },
    },
  });

  const existingBatchIds = new Set(existingAssignments.map((item) => String(item.batchId)));

  const assignments = validBatches
    .filter((batch) => !existingBatchIds.has(String(batch.id)))
    .map((batch) => ({
    testId,
    batchId: batch.id,
    collegeId: batch.collegeId,
    }));

  if (assignments.length > 0) {
    const m2 = await models.init();
    const TestBatch = m2.dbClient.testBatch;
    await TestBatch.createMany({
      data: assignments,
    });
  }

  res.status(200).json({
    message: "Batch assignments updated",
    collegeId: test.collegeId,
    requested: requestedBatchIds.length,
    assigned: assignments.length,
    alreadyAssigned: existingBatchIds.size,
    invalidBatchIds,
  });
});

const createBatchGlobal = asyncHandler(async (req, res) => {
  const { name, year, collegeId, departmentId, studentIds = [], isGlobal = false } = req.body;
  const requestedDepartmentIds = normalizeIdList(req.body.departmentIds);

  const m = await models.init();
  const College = m.dbClient.college;
  const Department = m.dbClient.department;
  const Batch = m.dbClient.batch;

  const college = await College.findUnique({ where: { id: collegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Batch cannot be created for inactive or missing college");
  }

  const finalDepartmentIds = isGlobal ? requestedDepartmentIds : [departmentId].filter(Boolean);
  const departments = await Department.findMany({
    where: {
      id: { in: finalDepartmentIds },
      collegeId,
    },
    select: { id: true, name: true },
  });

  if (departments.length !== finalDepartmentIds.length) {
    const foundIds = new Set(departments.map((department) => String(department.id)));
    throw new ApiError(422, "Invalid departments for selected college", {
      invalidDepartmentIds: finalDepartmentIds.filter((id) => !foundIds.has(String(id))),
      collegeId,
    });
  }

  if (isGlobal && finalDepartmentIds.length < 2) {
    throw new ApiError(422, "Select at least two departments for a global batch");
  }

  const primaryDepartmentId = isGlobal ? finalDepartmentIds[0] : departmentId;

  const duplicate = await Batch.findFirst({
    where: {
      collegeId,
      ...(isGlobal ? { isGlobal: true } : { departmentId: primaryDepartmentId, isGlobal: { not: true } }),
      year,
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
  });

  if (duplicate) {
    throw new ApiError(409, "Duplicate batch name for the same department and academic year", null, "BATCH_DUPLICATE_NAME");
  }

  const batch = await Batch.create({
    data: {
      name,
      year,
      collegeId,
      departmentId: primaryDepartmentId,
      departmentIds: finalDepartmentIds,
      isGlobal: Boolean(isGlobal),
    },
  });

  if (Array.isArray(studentIds) && studentIds.length > 0) {
    await assignStudentsToBatchRecord({ db: m.dbClient, batch, studentIds });
  }

  await createAuditLog({
    action: "SUPER_ADMIN_BATCH_CREATED",
    targetType: "BATCH",
    targetId: batch.id,
    collegeId,
    superAdminId: req.superAdmin.id,
    afterState: {
      name: batch.name,
      year: batch.year,
      departmentId: batch.departmentId,
      departmentIds: batch.departmentIds,
      isGlobal: batch.isGlobal,
    },
  });

  res.status(201).json(batch);
});

const updateBatchGlobal = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  const m = await models.init();
  const db = m.dbClient;
  
  const existing = await db.batch.findUnique({ where: { id: batchId } });

  if (!existing) {
    throw new ApiError(404, "Batch not found");
  }

  const nextName = req.body.name !== undefined ? String(req.body.name).trim() : existing.name;
  const nextYear = req.body.year !== undefined ? Number(req.body.year) : existing.year;
  const nextIsGlobal = req.body.isGlobal !== undefined ? Boolean(req.body.isGlobal) : Boolean(existing.isGlobal);
  const requestedDepartmentIds = req.body.departmentIds !== undefined
    ? normalizeIdList(req.body.departmentIds)
    : normalizeIdList(existing.departmentIds);
  const nextDepartmentId = req.body.departmentId !== undefined ? req.body.departmentId : existing.departmentId;
  const finalDepartmentIds = nextIsGlobal ? requestedDepartmentIds : [nextDepartmentId].filter(Boolean);

  const departments = await db.department.findMany({
    where: {
      id: { in: finalDepartmentIds },
      collegeId: existing.collegeId,
    },
    select: { id: true },
  });

  if (departments.length !== finalDepartmentIds.length) {
    throw new ApiError(422, "Invalid departments for selected batch college");
  }

  if (nextIsGlobal && finalDepartmentIds.length < 2) {
    throw new ApiError(422, "Select at least two departments for a global batch");
  }

  const primaryDepartmentId = nextIsGlobal ? finalDepartmentIds[0] : nextDepartmentId;

  const duplicate = await db.batch.findFirst({
    where: {
      id: { not: batchId },
      collegeId: existing.collegeId,
      ...(nextIsGlobal ? { isGlobal: true } : { departmentId: primaryDepartmentId, isGlobal: { not: true } }),
      year: nextYear,
      name: {
        equals: nextName,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new ApiError(409, "Duplicate batch name for the same department and academic year", null, "BATCH_DUPLICATE_NAME");
  }

  const updated = await db.batch.update({
    where: { id: batchId },
    data: {
      ...(req.body.name !== undefined ? { name: nextName } : {}),
      ...(req.body.year !== undefined ? { year: nextYear } : {}),
      ...(req.body.departmentId !== undefined || req.body.departmentIds !== undefined || req.body.isGlobal !== undefined ? { departmentId: primaryDepartmentId } : {}),
      ...(req.body.departmentId !== undefined || req.body.departmentIds !== undefined || req.body.isGlobal !== undefined ? { departmentIds: finalDepartmentIds } : {}),
      ...(req.body.isGlobal !== undefined ? { isGlobal: nextIsGlobal } : {}),
      ...(req.body.isArchived !== undefined ? { isArchived: req.body.isArchived } : {}),
    },
    include: {
      college: true,
      department: true,
      departments: true,
      _count: {
        select: { students: true, tests: true },
      },
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_BATCH_UPDATED",
    targetType: "BATCH",
    targetId: updated.id,
    collegeId: updated.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      name: existing.name,
      year: existing.year,
      departmentId: existing.departmentId,
      departmentIds: existing.departmentIds,
      isGlobal: existing.isGlobal,
      isArchived: existing.isArchived,
    },
    afterState: {
      name: updated.name,
      year: updated.year,
      departmentId: updated.departmentId,
      departmentIds: updated.departmentIds,
      isGlobal: updated.isGlobal,
      isArchived: updated.isArchived,
    },
  });

  res.status(200).json(updated);
});

const assignStudentsToBatchGlobal = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  const { studentIds = [] } = req.body;
  const m = await models.init();
  const db = m.dbClient;

  const batch = await db.batch.findUnique({ where: { id: batchId } });
  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }

  const result = await assignStudentsToBatchRecord({ db, batch, studentIds });
  if (result.updated === 0) {
    throw new ApiError(422, "No selected students are eligible for this batch", {
      collegeId: batch.collegeId,
      batchId,
      invalidStudentIds: result.invalidStudentIds,
    });
  }

  await createAuditLog({
    action: "SUPER_ADMIN_BATCH_STUDENTS_ASSIGNED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId: batch.collegeId,
    superAdminId: req.superAdmin.id,
    afterState: {
      requested: result.requested,
      updated: result.updated,
      invalidStudentIds: result.invalidStudentIds,
      isGlobalBatch: Boolean(batch.isGlobal),
    },
  });

  res.status(200).json({
    message: "Students assigned to batch",
    ...result,
  });
});

const deleteBatchGlobal = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  const { confirmationText } = req.body;
  const m = await models.init();
  const db = m.dbClient;

  const existing = await db.batch.findUnique({
    where: { id: batchId },
    include: {
      _count: {
        select: { students: true, tests: true, testAssignments: true },
      },
    },
  });

  if (!existing) {
    throw new ApiError(404, "Batch not found");
  }

  const expectedConfirmation = `DELETE ${existing.name}`;
  if (confirmationText !== expectedConfirmation) {
    throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
  }

  // Perform delete operations sequentially (no transaction support in native MongoDB client wrapper)
  const removedAssignments = await db.testBatch.deleteMany({ where: { batchId } });

  const detachedLegacyTests = await db.test.updateMany({
    where: { batchId },
    data: { batchId: null },
  });

  const studentsWithLegacyBatch = await db.student.findMany({
    where: { collegeId: existing.collegeId, batchId },
    select: { id: true },
  });
  const detachedStudents = await db.student.updateMany({
    where: { batchId },
    data: { batchId: null },
  });
  await Promise.all(studentsWithLegacyBatch.map((student) => invalidatePrincipalAuthCache("student", student.id)));

  const studentsWithBatchArray = await db.student.findMany({
    where: {
      collegeId: existing.collegeId,
      batchIds: { in: [batchId] },
    },
    select: { id: true, batchId: true, batchIds: true },
  });

  for (const student of studentsWithBatchArray) {
    const nextBatchIds = (Array.isArray(student.batchIds) ? student.batchIds : [])
      .filter((id) => String(id) !== String(batchId));
    const nextBatchId = String(student.batchId || "") === String(batchId)
      ? nextBatchIds[0] || null
      : student.batchId || null;

    await db.student.update({
      where: { id: student.id },
      data: {
        batchIds: nextBatchIds,
        batchId: nextBatchId,
      },
    });
    await invalidatePrincipalAuthCache("student", student.id);
  }

  await db.batch.delete({ where: { id: batchId } });

  const result = {
    removedAssignments: removedAssignments.count || 0,
    detachedLegacyTests: detachedLegacyTests.count || 0,
    detachedStudents: Math.max(detachedStudents.count || 0, studentsWithBatchArray.length),
  };

  await createAuditLog({
    action: "SUPER_ADMIN_BATCH_DELETED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      name: existing.name,
      testAssignments: existing._count.testAssignments,
      tests: existing._count.tests,
      students: existing._count.students,
    },
    afterState: {
      deleted: true,
      ...result,
    },
  });

  res.status(200).json({
    message: "Batch deleted",
    ...result,
  });
});

module.exports = {
  getBatchesGlobal,
  assignTestToBatches,
  createBatchGlobal,
  updateBatchGlobal,
  assignStudentsToBatchGlobal,
  deleteBatchGlobal,
};
