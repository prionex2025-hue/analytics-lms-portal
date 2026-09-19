const models = require("../../models");
const { ApiError, asyncHandler } = require("../../utils/http");
const { createAuditLog } = require("../../services/audit.service");
const { getScopedDepartmentId } = require("../../utils/admin-scope");
const {
  assertAdminCanViewTest,
  assertAdminCanControlTest,
} = require("../../utils/admin-test-access");
const { invalidatePrincipalAuthCache } = require("../../services/auth-revocation.service");

const parseCsv = (csvText) => {
  const rows = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length === 0) return [];

  const headers = rows[0].split(",").map((value) => value.trim().toLowerCase());
  return rows.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    const record = {};
    headers.forEach((key, index) => {
      record[key] = values[index] || "";
    });
    return record;
  });
};

const assertAdminDepartmentScope = (req, departmentId, message = "Cross-department access denied") => {
  const adminDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  if (adminDepartmentId && departmentId && String(departmentId) !== String(adminDepartmentId)) {
    throw new ApiError(403, message, null, "CROSS_DEPARTMENT_ACCESS_DENIED");
  }
  return adminDepartmentId;
};

const getStudentBatchIds = (student) => {
  const existing = Array.isArray(student?.batchIds) ? student.batchIds : [];
  const legacy = student?.batchId ? [student.batchId] : [];
  const merged = [...existing, ...legacy].filter(Boolean).map((id) => String(id));
  return [...new Set(merged)];
};
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId;

const addBatchIdToStudent = (student, batchId) => {
  const merged = [...getStudentBatchIds(student), String(batchId)].filter(Boolean);
  return [...new Set(merged)];
};

const assignBatchToStudents = async ({ db, collegeId, studentIds, batchId, departmentId, isGlobalBatch = false }) => {
  const uniqueIds = [...new Set((studentIds || []).map((id) => String(id)).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { updated: 0 };
  }

  const students = await db.student.findMany({
    where: {
      id: { in: uniqueIds },
      collegeId,
      ...(isGlobalBatch ? {} : { departmentId }),
    },
    select: { id: true, batchIds: true, batchId: true },
  });

  const updates = students.map((student) =>
    db.student.update({
      where: { id: student.id },
      data: {
        batchIds: addBatchIdToStudent(student, batchId),
        batchId,
        ...(isGlobalBatch ? {} : { departmentId }),
      },
    })
  );

  if (updates.length === 0) {
    return { updated: 0 };
  }

  await db.$transaction(updates);
  await Promise.all(students.map((student) => invalidatePrincipalAuthCache("student", student.id)));
  return { updated: updates.length };
};

const getBatches = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;

  const batches = await db.batch.findMany({
    where: { collegeId },
    include: {
      department: true,
      _count: {
        select: {
          students: true,
          testAssignments: true,
        },
      },
    },
    orderBy: [{ year: "desc" }, { name: "asc" }],
  });

  res.status(200).json(batches);
});

const getBatchDetail = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { batchId } = req.params;

  const batch = await db.batch.findFirst({
    where: { id: batchId, collegeId },
    include: {
      department: true,
      students: {
        include: {
          _count: {
            select: { submissions: true },
          },
        },
        orderBy: { fullName: "asc" },
      },
      testAssignments: {
        include: {
          test: {
            select: {
              id: true,
              title: true,
              subject: true,
              startsAt: true,
              endsAt: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }

  res.status(200).json({
    ...batch,
    students: Array.isArray(batch.students)
      ? batch.students.map((student) => ({ ...student, studentId: getStudentNumber(student) }))
      : [],
  });
});

const createBatch = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const scopedDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const requestedDepartmentId = req.body.departmentId || scopedDepartmentId;
  const { name, year, studentIds } = req.body;
  assertAdminDepartmentScope(req, requestedDepartmentId, "Admins can create batches only in their own department");

  if (!requestedDepartmentId) {
    throw new ApiError(422, "departmentId is required for batch creation");
  }

  const duplicate = await db.batch.findFirst({
    where: {
      collegeId,
      departmentId: requestedDepartmentId,
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

  const department = await db.department.findFirst({
    where: { id: requestedDepartmentId, collegeId },
  });

  if (!department) {
    throw new ApiError(422, "Invalid department for this college");
  }

  const batch = await db.batch.create({
    data: {
      name,
      year,
      departmentId: requestedDepartmentId,
      collegeId,
    },
  });

  if (Array.isArray(studentIds) && studentIds.length > 0) {
    await assignBatchToStudents({
      db,
      collegeId,
      studentIds,
      batchId: batch.id,
      departmentId: requestedDepartmentId,
      isGlobalBatch: Boolean(batch.isGlobal),
    });
  }

  await createAuditLog({
    action: "ADMIN_BATCH_CREATED",
    targetType: "BATCH",
    targetId: batch.id,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      name: batch.name,
      year: batch.year,
      departmentId: batch.departmentId,
    },
  });

  res.status(201).json(batch);
});

const assignStudentsToBatch = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { batchId } = req.params;
  const { studentIds } = req.body;

  const batch = await db.batch.findFirst({ where: { id: batchId, collegeId } });
  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }
  assertAdminDepartmentScope(req, batch.departmentId, "Batch is outside the admin department scope");

  const result = await assignBatchToStudents({
    db,
    collegeId,
    studentIds,
    batchId,
    departmentId: batch.departmentId,
    isGlobalBatch: Boolean(batch.isGlobal),
  });

  await createAuditLog({
    action: "ADMIN_BATCH_STUDENTS_ASSIGNED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      studentIds,
      count: result.updated,
    },
  });

  res.status(200).json({ message: "Students assigned", updated: result.updated });
});

const bulkAddStudentsToBatch = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { batchId } = req.params;
  const { csvData, studentIds = [] } = req.body;

  const batch = await db.batch.findFirst({ where: { id: batchId, collegeId } });
  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }
  assertAdminDepartmentScope(req, batch.departmentId, "Batch is outside the admin department scope");

  const parsedRows = csvData ? parseCsv(csvData) : [];
  const fromCsvEmails = parsedRows.map((row) => row.email).filter(Boolean);
  const fromCsvStudentIds = parsedRows.map((row) => row.studentid || row.student_id).filter(Boolean);

  const csvStudents = parsedRows.length
    ? await db.student.findMany({
        where: {
          collegeId,
          OR: [
            ...(fromCsvEmails.length ? [{ email: { in: fromCsvEmails } }] : []),
            ...(fromCsvStudentIds.length ? [{ studentId: { in: fromCsvStudentIds } }] : []),
          ],
        },
      })
    : [];

  const studentPool = new Map();
  csvStudents.forEach((student) => studentPool.set(student.id, student));

  if (Array.isArray(studentIds) && studentIds.length > 0) {
    const byIds = await db.student.findMany({ where: { id: { in: studentIds }, collegeId } });
    byIds.forEach((student) => studentPool.set(student.id, student));
  }

  const finalIds = [...studentPool.keys()];
  if (finalIds.length === 0) {
    throw new ApiError(422, "No valid students found from CSV/IDs");
  }

  const update = await assignBatchToStudents({
    db,
    collegeId,
    studentIds: finalIds,
    batchId,
    departmentId: batch.departmentId,
    isGlobalBatch: Boolean(batch.isGlobal),
  });

  await createAuditLog({
    action: "ADMIN_BATCH_BULK_STUDENTS_ADDED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      updated: update.updated,
      studentCount: finalIds.length,
    },
  });

  res.status(200).json({
    message: "Bulk student assignment completed",
    updated: update.updated,
    requested: finalIds.length,
  });
});

const removeStudentFromBatch = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { batchId, studentId } = req.params;

  const [batch, student] = await Promise.all([
    db.batch.findFirst({ where: { id: batchId, collegeId } }),
    db.student.findFirst({ where: { id: studentId, collegeId } }),
  ]);

  const currentBatchIds = getStudentBatchIds(student);

  if (!batch || !student || !currentBatchIds.includes(String(batchId))) {
    throw new ApiError(404, "Batch or student not found");
  }
  assertAdminDepartmentScope(req, batch.departmentId, "Batch is outside the admin department scope");
  assertAdminDepartmentScope(req, student.departmentId, "Student is outside the admin department scope");

  const activeSubmission = await db.submission.findFirst({
    where: {
      userId: studentId,
      status: "IN_PROGRESS",
      test: {
        OR: [
          { batchId },
          { batchAssignments: { some: { batchId } } },
        ],
      },
    },
    include: {
      test: {
        select: { id: true, title: true },
      },
    },
  });

  if (activeSubmission) {
    return res.status(409).json({
      message: "Cannot remove student with active test",
      details: {
        warning: {
          type: "ACTIVE_TEST_PRESENT",
          testId: activeSubmission.test?.id,
          testTitle: activeSubmission.test?.title,
        },
      },
      warning: {
        type: "ACTIVE_TEST_PRESENT",
        testId: activeSubmission.test?.id,
        testTitle: activeSubmission.test?.title,
      },
    });
  }

  const nextBatchIds = currentBatchIds.filter((id) => String(id) !== String(batchId));
  const nextBatchId = String(student.batchId) === String(batchId)
    ? (nextBatchIds[0] || null)
    : student.batchId || null;

  await db.student.update({
    where: { id: studentId },
    data: { batchIds: nextBatchIds, batchId: nextBatchId },
  });
  await invalidatePrincipalAuthCache("student", studentId);

  await createAuditLog({
    action: "ADMIN_BATCH_STUDENT_REMOVED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId,
    adminId: req.admin.id,
    beforeState: {
      studentId,
      batchId,
    },
    afterState: {
      studentId,
      batchId: nextBatchId,
    },
  });

  res.status(200).json({ message: "Student removed from batch" });
});

const assignTestToBatch = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { testId } = req.params;
  const { batchId } = req.body;

  const [test, batch] = await Promise.all([
    db.test.findFirst({
      where: { id: testId, collegeId },
      include: {
        createdByAdmin: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    }),
    db.batch.findFirst({ where: { id: batchId, collegeId } }),
  ]);

  if (!test || !batch) {
    throw new ApiError(404, "Test or batch not found");
  }
  await assertAdminCanViewTest({ db, req, test });
  assertAdminDepartmentScope(req, batch.departmentId, "Batch is outside the admin department scope");

  assertAdminCanControlTest(req, test);

  await db.testBatch.upsert({
    where: {
      testId_batchId: {
        testId,
        batchId,
      },
    },
    update: {
      collegeId,
    },
    create: {
      testId,
      batchId,
      collegeId,
    },
  });

  await db.test.update({
    where: { id: testId },
    data: {
      assignmentMethod: "batch_wise",
      departmentId: null,
      batchId,
    },
  });

  await createAuditLog({
    action: "ADMIN_TEST_BATCH_ASSIGNED",
    targetType: "TEST",
    targetId: testId,
    collegeId,
    adminId: req.admin.id,
    testId,
    afterState: { batchId },
  });

  res.status(200).json({ message: "Test assigned to batch" });
});

const assignTestToDepartment = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { testId } = req.params;
  const { departmentId } = req.body;

  const [test, department] = await Promise.all([
    db.test.findFirst({
      where: { id: testId, collegeId },
      include: {
        createdByAdmin: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    }),
    db.department.findFirst({ where: { id: departmentId, collegeId } }),
  ]);

  if (!test || !department) {
    throw new ApiError(404, "Test or department not found");
  }
  await assertAdminCanViewTest({ db, req, test });
  assertAdminDepartmentScope(req, department.id, "Department is outside the admin department scope");

  assertAdminCanControlTest(req, test);

  // Get all batches in this department
  const batches = await db.batch.findMany({
    where: { collegeId, departmentId },
    select: { id: true },
  });

  // Delete previous batch assignments for this test
  await db.testBatch.deleteMany({
    where: { testId },
  });

  // Create new batch assignments for all batches in this department
  if (batches.length > 0) {
    await db.testBatch.createMany({
      data: batches.map((batch) => ({
        testId,
        batchId: batch.id,
        collegeId,
      })),
      skipDuplicates: true,
    });
  }

  await db.test.update({
    where: { id: testId },
    data: {
      assignmentMethod: "department_wise",
      departmentId,
      batchId: null,
    },
  });

  await createAuditLog({
    action: "ADMIN_TEST_DEPARTMENT_ASSIGNED",
    targetType: "TEST",
    targetId: testId,
    collegeId,
    adminId: req.admin.id,
    testId,
    afterState: { departmentId, batchCount: batches.length },
  });

  res.status(200).json({ message: "Test assigned to entire department", batchCount: batches.length });
});

const archiveBatch = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { batchId } = req.params;

  const batch = await db.batch.findFirst({ where: { id: batchId, collegeId } });
  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }
  assertAdminDepartmentScope(req, batch.departmentId, "Batch is outside the admin department scope");

  const now = new Date();
  const futureTests = await db.test.findMany({
    where: {
      collegeId,
      startsAt: { gt: now },
      OR: [
        { batchId },
        { batchAssignments: { some: { batchId } } },
      ],
    },
    select: { id: true },
  });

  const futureIds = futureTests.map((item) => item.id);
  if (futureIds.length > 0) {
    await db.testBatch.deleteMany({
      where: {
        batchId,
        testId: { in: futureIds },
      },
    });

    await db.test.updateMany({
      where: {
        id: { in: futureIds },
        batchId,
      },
      data: {
        batchId: null,
      },
    });
  }

  const archived = await db.batch.update({
    where: { id: batchId },
    data: { isArchived: true },
  });

  await createAuditLog({
    action: "ADMIN_BATCH_ARCHIVED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      removedFromFutureTests: futureIds.length,
    },
  });

  res.status(200).json({ message: "Batch archived", batch: archived, detachedFutureTests: futureIds.length });
});

const deleteBatch = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { batchId } = req.params;

  const batch = await db.batch.findFirst({
    where: { id: batchId, collegeId },
    include: {
      _count: {
        select: { testAssignments: true, tests: true, students: true },
      },
    },
  });

  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }
  assertAdminDepartmentScope(req, batch.departmentId, "Batch is outside the admin department scope");

  const result = await db.$transaction(async (tx) => {
    const removedAssignments = await tx.testBatch.deleteMany({
      where: {
        batchId,
        collegeId,
      },
    });

    const detachedLegacyTests = await tx.test.updateMany({
      where: {
        collegeId,
        batchId,
      },
      data: {
        batchId: null,
      },
    });

    const detachedStudents = await tx.student.updateMany({
      where: {
        collegeId,
        batchId,
      },
      data: {
        batchId: null,
      },
    });

    await tx.batch.delete({ where: { id: batchId } });

    return {
      removedAssignments: removedAssignments.count,
      detachedLegacyTests: detachedLegacyTests.count,
      detachedStudents: detachedStudents.count,
    };
  });

  await createAuditLog({
    action: "ADMIN_BATCH_DELETED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId,
    adminId: req.admin.id,
    beforeState: {
      testAssignments: batch._count.testAssignments,
      tests: batch._count.tests,
      students: batch._count.students,
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
  getBatches,
  getBatchDetail,
  createBatch,
  assignStudentsToBatch,
  bulkAddStudentsToBatch,
  removeStudentFromBatch,
  assignTestToBatch,
  assignTestToDepartment,
  archiveBatch,
  deleteBatch,
};
