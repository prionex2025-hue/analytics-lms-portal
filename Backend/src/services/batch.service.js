const models = require("../models");
const { validateDocument, validateDocuments } = require("./model-validation.service");
const { BatchValidation } = require("../models/validation");
const { ApiError } = require("../utils/http");

/**
 * Create a batch with validation
 *
 * Validates batch data and ensures department belongs to college
 */
async function createBatch(payload, collegeId, adminId) {
  const m = await models.init();
  const db = m.dbClient;

  // Verify department exists and belongs to college
  const department = await db.department.findUnique({
    where: { id: payload.departmentId },
  });

  if (!department || department.collegeId !== collegeId) {
    throw new ApiError(422, "Department not found in this college", { departmentId: payload.departmentId }, "INVALID_DEPARTMENT");
  }

  // Validate batch
  const validated = await validateDocument(
    BatchValidation,
    {
      name: payload.name,
      collegeId,
      departmentId: payload.departmentId,
      capacity: payload.capacity || 100,
      academicYear: payload.academicYear || null,
      section: payload.section || null,
      isActive: payload.isActive !== false,
    },
    "Batch creation"
  );

  // Persist
  const batch = await db.batch.create({
    data: validated,
  });

  // Audit
  await db.auditLog.create({
    data: {
      action: "BATCH_CREATED",
      entityType: "batch",
      entityId: batch.id,
      userId: adminId,
      collegeId,
      metadata: {
        name: validated.name,
        capacity: validated.capacity,
      },
    },
  });

  return batch;
}

/**
 * Update batch with validation
 */
async function updateBatch(batchId, payload, collegeId, adminId) {
  const m = await models.init();
  const db = m.dbClient;

  const existing = await db.batch.findUnique({ where: { id: batchId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Batch not found or access denied");
  }

  // Validate merged data
  const validated = await validateDocument(
    BatchValidation,
    {
      name: payload.name || existing.name,
      collegeId,
      departmentId: payload.departmentId || existing.departmentId,
      capacity: payload.capacity !== undefined ? payload.capacity : existing.capacity,
      academicYear: payload.academicYear !== undefined ? payload.academicYear : existing.academicYear,
      section: payload.section !== undefined ? payload.section : existing.section,
      isActive: payload.isActive !== undefined ? payload.isActive : existing.isActive,
    },
    "Batch update"
  );

  // Persist
  const updated = await db.batch.update({
    where: { id: batchId },
    data: validated,
  });

  await db.auditLog.create({
    data: {
      action: "BATCH_UPDATED",
      entityType: "batch",
      entityId: batchId,
      userId: adminId,
      collegeId,
      metadata: { changes: Object.keys(payload) },
    },
  });

  return updated;
}

/**
 * Bulk create batches with validation
 */
async function bulkCreateBatches(rows, collegeId, adminId) {
  const m = await models.init();
  const db = m.dbClient;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, "No batches provided");
  }

  // Verify all departments belong to college
  const deptIds = [...new Set(rows.map((r) => r.departmentId))];
  const departments = await db.department.findMany({
    where: {
      id: { in: deptIds },
      collegeId,
    },
    select: { id: true },
  });

  const validDeptIds = new Set(departments.map((d) => d.id));
  const invalidRows = rows.filter((r) => !validDeptIds.has(r.departmentId));

  if (invalidRows.length > 0) {
    throw new ApiError(422, "Some departments not found in this college", { invalidCount: invalidRows.length }, "INVALID_DEPARTMENTS");
  }

  // Validate all batches
  const validated = await validateDocuments(
    BatchValidation,
    rows.map((row) => ({
      name: row.name,
      collegeId,
      departmentId: row.departmentId,
      capacity: row.capacity || 100,
      academicYear: row.academicYear || null,
      section: row.section || null,
      isActive: true,
    })),
    "Bulk batch creation"
  );

  // Bulk insert in transaction
  const result = await db.$transaction(async (tx) => {
    const inserted = await tx.batch.createMany({
      data: validated,
    });

    // Audit
    await tx.auditLog.create({
      data: {
        action: "BATCHES_BULK_CREATED",
        entityType: "batch",
        userId: adminId,
        collegeId,
        metadata: {
          count: inserted.count,
        },
      },
    });

    return inserted;
  });

  return result;
}

/**
 * Toggle batch status
 */
async function toggleBatchStatus(batchId, collegeId, adminId, isActive) {
  const m = await models.init();
  const db = m.dbClient;

  const existing = await db.batch.findUnique({ where: { id: batchId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Batch not found");
  }

  const validated = await validateDocument(
    BatchValidation,
    {
      ...existing,
      isActive,
    },
    "Batch status toggle"
  );

  const updated = await db.batch.update({
    where: { id: batchId },
    data: { isActive: validated.isActive },
  });

  await db.auditLog.create({
    data: {
      action: isActive ? "BATCH_ACTIVATED" : "BATCH_DEACTIVATED",
      entityType: "batch",
      entityId: batchId,
      userId: adminId,
      collegeId,
    },
  });

  return updated;
}

module.exports = {
  createBatch,
  updateBatch,
  bulkCreateBatches,
  toggleBatchStatus,
};
