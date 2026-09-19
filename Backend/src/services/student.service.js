const models = require("../models");
const bcrypt = require("bcrypt");
const { validateDocument, validateDocuments } = require("./model-validation.service");
const { validateUniqueEmail } = require("./cross-field-validators.service");
const { UserValidation } = require("../models/validation");
const { ApiError } = require("../utils/http");
const { bumpPrincipalTokenVersion, invalidatePrincipalAuthCache } = require("./auth-revocation.service");
const { isAlumniStatus, STUDENT_LIFECYCLE_STATUS } = require("./student-lifecycle.service");

const resolveStudentId = (enrollmentNumber) => String(enrollmentNumber || "").trim();

/**
 * Create a single student with validation
 *
 * Pattern:
 *   1. Validate using Mongoose schema
 *   2. Hash password
 *   3. Persist using modelClient
 *   4. Audit (optional)
 */
async function createStudent(payload, collegeId, adminId) {
  const m = await models.init();
  const db = m.dbClient;
  // Verify college exists
  const college = await db.college.findUnique({ where: { id: collegeId } });
  if (!college) {
    throw new ApiError(422, "College not found", { collegeId }, "COLLEGE_NOT_FOUND");
  }

  // If called by an admin, fetch admin to enforce department scope
  let admin = null;
  if (adminId) {
    admin = await db.admin.findUnique({ where: { id: adminId } });
  }

  // Validate student using Mongoose schema
  const validated = await validateDocument(
    UserValidation,
    {
      fullName: payload.fullName,
      email: (payload.email || "").toLowerCase(),
      role: "STUDENT",
      collegeId,
      departmentId: payload.departmentId || null,
      batchId: payload.batchId || null,
      year: payload.year ?? null,
      isActive: payload.isActive !== false,
    },
    "Student creation"
  );

  const requestedBatchIds = Array.isArray(payload.batchIds) ? payload.batchIds.filter(Boolean) : [];
  const resolvedBatchIds = requestedBatchIds.length > 0
    ? requestedBatchIds
    : (validated.batchId ? [validated.batchId] : []);

  await validateUniqueEmail(validated.email, collegeId);

  const studentId = resolveStudentId(payload.enrollmentNumber || payload.enrollNumber);
  const duplicateStudentId = await db.student.findFirst({ where: { collegeId, studentId } });
  if (duplicateStudentId) {
    throw new ApiError(409, "Student with this enroll number already exists");
  }

  // Enforce department scoping for admins (defense-in-depth)
  if (admin && admin.departmentId) {
    if (validated.departmentId && String(validated.departmentId) !== String(admin.departmentId)) {
      throw new ApiError(403, "Cross-department access denied");
    }
    // Default missing department to admin's department
    if (!validated.departmentId) {
      validated.departmentId = admin.departmentId;
    }
  }

  // Hash password if provided
  const passwordHash = payload.password ? await bcrypt.hash(payload.password, 10) : null;

  // Persist using modelClient
  const student = await db.student.create({
    data: {
      ...validated,
      batchIds: resolvedBatchIds,
      studentId,
      enrollmentNumber: studentId,
      passwordHash,
      // Additional fields not in validation schema
      phoneNumber: payload.phoneNumber || null,
      preferences: payload.preferences || {},
    },
    include: {
      college: true,
      department: true,
    },
  });

  // Audit
  await db.auditLog.create({
    data: {
      action: "STUDENT_CREATED",
      entityType: "student",
      entityId: student.id,
      userId: adminId,
      collegeId,
      metadata: {
        fullName: validated.fullName,
        email: validated.email,
        enrollmentNumber: student.enrollmentNumber,
      },
    },
  });

  return student;
}

/**
 * Update student with validation
 */
async function updateStudent(studentId, payload, collegeId, adminId) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.student.findUnique({ where: { id: studentId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Student not found or access denied");
  }

  // Validate merged data
  const validated = await validateDocument(
    UserValidation,
    {
      fullName: payload.fullName || existing.fullName,
      email: payload.email ? (payload.email || "").toLowerCase() : existing.email,
      role: "STUDENT",
      collegeId,
      departmentId: payload.departmentId !== undefined ? payload.departmentId : existing.departmentId,
      batchId: payload.batchId !== undefined ? payload.batchId : existing.batchId,
      year: payload.year !== undefined ? payload.year : existing.year,
      isActive: payload.isActive !== undefined ? payload.isActive : existing.isActive,
    },
    "Student update"
  );

  await validateUniqueEmail(validated.email, collegeId, studentId);

  const nextEnrollmentNumber = payload.enrollmentNumber || payload.enrollNumber || null;
  const nextStudentId = nextEnrollmentNumber ? resolveStudentId(nextEnrollmentNumber) : null;
  if (nextStudentId && nextStudentId !== existing.studentId) {
    const duplicateStudentId = await db.student.findFirst({ where: { collegeId, studentId: nextStudentId } });
    if (duplicateStudentId) {
      throw new ApiError(409, "Student with this enroll number already exists");
    }
  }

  // Persist
  const incomingBatchIds = Array.isArray(payload.batchIds) ? payload.batchIds.filter(Boolean) : null;
  const mergedBatchIds = incomingBatchIds !== null
    ? incomingBatchIds
    : (payload.batchId
      ? [...new Set([
          ...(Array.isArray(existing.batchIds) ? existing.batchIds : []),
          existing.batchId,
          payload.batchId,
        ].filter(Boolean).map((id) => String(id)))]
      : (Array.isArray(existing.batchIds) ? existing.batchIds : []));

  const updated = await db.student.update({
    where: { id: studentId },
    data: {
      ...validated,
      batchIds: mergedBatchIds,
      ...(nextStudentId ? { studentId: nextStudentId, enrollmentNumber: nextStudentId } : {}),
    },
  });

  if (payload.isActive === false) {
    await bumpPrincipalTokenVersion(db, "student", studentId);
  } else {
    await invalidatePrincipalAuthCache("student", studentId);
  }

  await db.auditLog.create({
    data: {
      action: "STUDENT_UPDATED",
      entityType: "student",
      entityId: studentId,
      userId: adminId,
      collegeId,
      metadata: { changes: Object.keys(payload) },
    },
  });

  return updated;
}

/**
 * Bulk import students with validation
 *
 * Validates each row, then bulk-creates them in a transaction
 */
async function bulkImportStudents(rows, collegeId, adminId) {
  const m = await models.init();
  const db = m.dbClient;
  const college = await db.college.findUnique({ where: { id: collegeId } });
  if (!college) {
    throw new ApiError(422, "College not found");
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, "No students provided", { count: rows?.length });
  }

  // Validate all rows
  const validatedRows = await validateDocuments(
    UserValidation,
    rows.map((row) => ({
      fullName: row.fullName,
      email: (row.email || "").toLowerCase(),
      role: "STUDENT",
      collegeId,
      departmentId: row.departmentId || null,
      batchId: row.batchId || null,
      year: row.year ?? null,
      isActive: true,
    })),
    "Bulk student import"
  );

  // Fetch admin to enforce department scoping
  let admin = null;
  if (adminId) {
    admin = await db.admin.findUnique({ where: { id: adminId } });
  }

  const report = { created: 0, failed: 0, duplicates: 0, errors: [] };
  const toInsert = [];

  for (let i = 0; i < validatedRows.length; i++) {
    const validated = validatedRows[i];
    const original = rows[i] || {};
    const rowNum = i + 1;

    // Enforce department scope: admin can only create inside their department
    if (admin && admin.departmentId) {
      if (!validated.departmentId) {
        validated.departmentId = admin.departmentId;
      } else if (String(validated.departmentId) !== String(admin.departmentId)) {
        report.failed += 1;
        report.errors.push({ row: rowNum, reason: "Cross-department row - not permitted" });
        continue;
      }
    }

    // Prevent duplicate email/studentId
    const existingByEmail = await db.student.findFirst({ where: { collegeId, email: validated.email } });
    const studentId = resolveStudentId(original.enrollmentNumber);
    const existingByEnroll = studentId
      ? await db.student.findFirst({ where: { collegeId, studentId } })
      : null;

    if (existingByEmail || existingByEnroll) {
      report.duplicates += 1;
      report.errors.push({ row: rowNum, reason: existingByEmail ? "Duplicate email" : "Duplicate enrollmentNumber" });
      continue;
    }

    // Prepare record for insertion
    const passwordHash = original.password ? bcrypt.hashSync(original.password, 10) : null;
    const mergedBatchIds = validated.batchId ? [validated.batchId] : [];
    toInsert.push({
      ...validated,
      batchIds: mergedBatchIds,
      studentId,
      enrollmentNumber: studentId,
      passwordHash,
      phoneNumber: original.phoneNumber || null,
      preferences: {},
    });
  }

  if (toInsert.length === 0) {
    return report;
  }

  // Insert permitted rows in a transaction
  const result = await db.$transaction(async (tx) => {
    const inserted = await tx.student.createMany({ data: toInsert });

    await tx.auditLog.create({
      data: {
        action: "STUDENTS_BULK_IMPORTED",
        entityType: "student",
        userId: adminId,
        collegeId,
        metadata: { count: inserted.count },
      },
    });

    return inserted;
  });

  report.created = result.count || toInsert.length;
  return report;
}

/**
 * Activate/deactivate student
 */
async function toggleStudentStatus(studentId, collegeId, adminId, isActive) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.student.findUnique({ where: { id: studentId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Student not found");
  }

  if (isActive && isAlumniStatus(existing.lifecycleStatus)) {
    throw new ApiError(409, "Alumni accounts cannot be reactivated from status toggle", null, "ALUMNI_STUDENT_REACTIVATION_BLOCKED");
  }

  // Simple validation for status change
  const validated = await validateDocument(
    UserValidation,
    {
      ...existing,
      isActive,
    },
    "Student status toggle"
  );

  const updated = await db.student.update({
    where: { id: studentId },
    data: {
      isActive: validated.isActive,
      ...(validated.isActive
        ? { lifecycleStatus: STUDENT_LIFECYCLE_STATUS.ACTIVE, disabledReason: null, disabledAt: null }
        : { lifecycleStatus: STUDENT_LIFECYCLE_STATUS.SUSPENDED, disabledReason: "MANUAL_SUSPEND", disabledAt: new Date() }),
    },
  });

  if (!validated.isActive) {
    await bumpPrincipalTokenVersion(db, "student", studentId);
  } else {
    await invalidatePrincipalAuthCache("student", studentId);
  }

  await db.auditLog.create({
    data: {
      action: isActive ? "STUDENT_ACTIVATED" : "STUDENT_DEACTIVATED",
      entityType: "student",
      entityId: studentId,
      userId: adminId,
      collegeId,
    },
  });

  return updated;
}

module.exports = {
  createStudent,
  updateStudent,
  bulkImportStudents,
  toggleStudentStatus,
};
