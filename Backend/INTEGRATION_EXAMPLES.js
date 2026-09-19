/**
 * INTEGRATION EXAMPLES: Hybrid Validation + ModelClient
 * 
 * This file shows production-ready patterns for applying the hybrid
 * validation layer to existing services.
 * 
 * Pattern:
 *   1. Validate using Mongoose schema
 *   2. Persist using modelClient (unchanged)
 *   3. Audit if needed
 * 
 * No ODM overhead. No schema enforcement on reads. Pure validation before writes.
 */

// ============================================================================
// EXAMPLE 1: Student Creation Service
// ============================================================================

const studentServiceExample = `
// src/services/Students/student.service.js

const models = require("./src/models");
const { validateDocument } = require("../model-validation.service");
const { UserValidation } = require("../../models/validation");
const { ApiError } = require("../../utils/http");

async function createStudent(payload, collegeId, adminId) {
  // Step 1: Validate using Mongoose schema
  const validated = await validateDocument(UserValidation, {
    fullName: payload.fullName,
    email: payload.email.toLowerCase(),
    role: "STUDENT",
    collegeId,
    departmentId: payload.departmentId || null,
    batchId: payload.batchId || null,
    isActive: true,
  }, "Student creation");

  // Step 2: Persist using modelClient (NOT Mongoose)
  const created = await dbClient.student.create({
    data: {
      ...validated,
      // Add fields not in validation schema
      enrollmentNumber: payload.enrollmentNumber,
      phoneNumber: payload.phoneNumber,
    },
    include: {
      college: true,
      department: true,
    },
  });

  // Step 3: Audit (optional)
  await dbClient.auditLog.create({
    data: {
      action: "STUDENT_CREATED",
      userId: adminId,
      targetId: created.id,
      collegeId,
      metadata: { email: validated.email },
    },
  });

  return created;
}

async function updateStudent(studentId, payload, collegeId) {
  // Fetch current to validate against existing
  const existing = await dbClient.student.findUnique({
    where: { id: studentId },
  });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Student not found or access denied");
  }

  // Validate merged payload
  const validated = await validateDocument(UserValidation, {
    ...existing,
    fullName: payload.fullName || existing.fullName,
    email: payload.email ? payload.email.toLowerCase() : existing.email,
    role: "STUDENT",
    collegeId,
  }, "Student update");

  // Persist changes
  return dbClient.student.update({
    where: { id: studentId },
    data: validated,
  });
}

async function bulkImportStudents(rows, collegeId, adminId) {
  const { validateDocuments } = require("../model-validation.service");

  // Validate all rows
  const validated = await validateDocuments(
    UserValidation,
    rows.map(row => ({
      fullName: row.fullName,
      email: row.email.toLowerCase(),
      role: "STUDENT",
      collegeId,
      departmentId: row.departmentId || null,
      batchId: row.batchId || null,
      isActive: true,
    })),
    "Bulk student import"
  );

  // Bulk insert
  const result = await dbClient.student.createMany({
    data: validated.map((v, i) => ({
      ...v,
      enrollmentNumber: rows[i].enrollmentNumber,
    })),
  });

  return result;
}

module.exports = {
  createStudent,
  updateStudent,
  bulkImportStudents,
};
`;

// ============================================================================
// EXAMPLE 2: Admin Creation Service
// ============================================================================

const adminServiceExample = `
// src/services/Admin/admin.service.js

const models = require("./src/models");
const { validateDocument } = require("../model-validation.service");
const { UserValidation } = require("../../models/validation");
const { ApiError } = require("../../utils/http");

async function createAdmin(payload, collegeId, superAdminId) {
  // Validate: role must be ADMIN
  const validated = await validateDocument(UserValidation, {
    fullName: payload.fullName,
    email: payload.email.toLowerCase(),
    role: "ADMIN",  // Enforced by validation
    collegeId,
    departmentId: payload.departmentId || null,
    isActive: true,
  }, "Admin creation");

  // Create with additional fields
  const created = await dbClient.admin.create({
    data: {
      ...validated,
      permissions: payload.permissions || [],
      accessLevel: payload.accessLevel || "STANDARD",
    },
  });

  // Log for audit
  await dbClient.auditLog.create({
    data: {
      action: "ADMIN_CREATED",
      initiatedById: superAdminId,
      targetId: created.id,
      collegeId,
      metadata: { adminEmail: validated.email },
    },
  });

  return created;
}

module.exports = { createAdmin };
`;

// ============================================================================
// EXAMPLE 3: Test Cloning (Already Implemented - Reference)
// ============================================================================

const cloneServiceExample = `
// src/services/clone.service.js (EXISTING - Reference)

const dbClient = require("../config/db");
const { validateDocument, validateDocuments } = require("./model-validation.service");
const { TestValidation, QuestionValidation, CloneMappingValidation } = require("../models/validation");
const { ApiError } = require("../utils/http");

/**
 * Clone test across colleges (Super Admin)
 * 
 * Validates:
 * - Source test exists
 * - Destination college exists
 * - Batches/departments are valid
 * 
 * Then safely clones with full audit trail
 */
async function cloneTestToCollege({
  sourceTestId,
  destinationCollegeId,
  assignmentMethod = "batch_wise",
  batchIds = [],
  superAdminId,
}) {
  const source = await dbClient.test.findUnique({
    where: { id: sourceTestId },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  if (!source) throw new ApiError(404, "Source test not found");

  return dbClient.$transaction(async (tx) => {
    // Validate destination college
    const destCollege = await tx.college.findUnique({
      where: { id: destinationCollegeId },
    });
    if (!destCollege) throw new ApiError(422, "Destination college not found");

    // Validate batches exist in destination college
    const batches = await tx.batch.findMany({
      where: {
        id: { in: batchIds },
        collegeId: destinationCollegeId,
      },
      select: { id: true, departmentId: true },
    });

    if (batches.length === 0) {
      throw new ApiError(422, "No valid batches in destination college", { batchIds });
    }

    // Validate test payload using Mongoose
    const clonedTestPayload = await validateDocument(TestValidation, {
      title: \`\${source.title} (Copy)\`,
      subject: source.subject,
      description: source.description,
      durationMins: source.durationMins,
      totalMarks: source.totalMarks,
      status: "DRAFT",
      isPublished: false,
      assignmentMethod,
      collegeId: destinationCollegeId,
      sourceTestId: source.id,
      createdByAdminId: batches[0] ? null : null, // Admin user required
    }, "Cloned test");

    // Create cloned test using modelClient
    const cloned = await tx.test.create({ data: clonedTestPayload });

    // Validate and bulk-insert questions
    if (source.questions.length > 0) {
      const validatedQuestions = await validateDocuments(
        QuestionValidation,
        source.questions.map(q => ({
          testId: cloned.id,
          collegeId: destinationCollegeId,
          prompt: q.prompt,
          type: q.type,
          options: q.options || [],
          marks: q.marks,
          order: q.order,
        })),
        "Cloned questions"
      );

      await tx.question.createMany({ data: validatedQuestions });
    }

    // Create batch assignments
    await tx.testBatch.createMany({
      data: batches.map(b => ({
        testId: cloned.id,
        batchId: b.id,
        collegeId: destinationCollegeId,
      })),
      skipDuplicates: true,
    });

    // Validate and log clone mapping
    const cloneMappingPayload = await validateDocument(
      CloneMappingValidation,
      {
        sourceTestId: source.id,
        clonedTestId: cloned.id,
        targetCollegeId: destinationCollegeId,
        targetDepartmentId: batches[0]?.departmentId || null,
        createdBy: superAdminId,
      },
      "Clone mapping"
    );

    await tx.cloneMapping.create({ data: cloneMappingPayload });

    return cloned;
  });
}

module.exports = { cloneTestToCollege };
`;

// ============================================================================
// EXAMPLE 4: Test Update Service
// ============================================================================

const testUpdateExample = `
// src/services/Admin/test.service.js - UPDATE METHOD

const models = require("./src/models");
const { validateDocument } = require("../model-validation.service");
const { TestValidation } = require("../../models/validation");
const { ApiError } = require("../../utils/http");

async function updateTest(testId, payload, collegeId, adminId) {
  // Fetch existing test
  const existing = await dbClient.test.findUnique({
    where: { id: testId },
  });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Test not found or access denied");
  }

  // Validate merged payload (existing + updates)
  const validated = await validateDocument(TestValidation, {
    ...existing,
    title: payload.title || existing.title,
    description: payload.description || existing.description,
    durationMins: payload.durationMins || existing.durationMins,
    status: payload.status || existing.status,
    // Other fields...
  }, "Test update");

  // Update using modelClient
  return dbClient.test.update({
    where: { id: testId },
    data: validated,
  });
}

async function publishTest(testId, collegeId, adminId) {
  const existing = await dbClient.test.findUnique({
    where: { id: testId },
  });

  if (!existing) throw new ApiError(404, "Test not found");
  if (existing.collegeId !== collegeId) throw new ApiError(403, "Access denied");
  if (existing.status !== "DRAFT") {
    throw new ApiError(422, "Cannot publish test not in DRAFT status");
  }

  // Validate status transition
  const validated = await validateDocument(TestValidation, {
    ...existing,
    status: "PUBLISHED",
    isPublished: true,
  }, "Test publish");

  return dbClient.test.update({
    where: { id: testId },
    data: validated,
  });
}

module.exports = {
  updateTest,
  publishTest,
};
`;

// ============================================================================
// EXAMPLE 5: Batch Operations
// ============================================================================

const batchOperationExample = `
// src/services/Admin/batch.service.js

const models = require("./src/models");
const { validateDocument, validateDocuments } = require("../model-validation.service");
const { BatchValidation } = require("../../models/validation");
const { ApiError } = require("../../utils/http");

// Note: Assuming BatchValidation schema exists. If not, create it:
// src/models/validation/batch.schema.js

async function createBatch(payload, collegeId, adminId) {
  const validated = await validateDocument(
    BatchValidation || require("../../models/validation").BatchValidation,
    {
      name: payload.name,
      collegeId,
      departmentId: payload.departmentId,
      capacity: payload.capacity || 100,
    },
    "Batch creation"
  );

  return dbClient.batch.create({ data: validated });
}

async function bulkCreateBatches(payloads, collegeId, adminId) {
  const BatchValidation = require("../../models/validation").BatchValidation;

  const validated = await validateDocuments(
    BatchValidation,
    payloads.map(p => ({
      name: p.name,
      collegeId,
      departmentId: p.departmentId,
      capacity: p.capacity || 100,
    })),
    "Bulk batch creation"
  );

  const result = await dbClient.batch.createMany({
    data: validated,
  });

  // Audit
  await dbClient.auditLog.create({
    data: {
      action: "BATCHES_CREATED",
      initiatedById: adminId,
      collegeId,
      metadata: { count: result.count },
    },
  });

  return result;
}

module.exports = {
  createBatch,
  bulkCreateBatches,
};
`;

// ============================================================================
// EXAMPLE 6: Department Service
// ============================================================================

const departmentServiceExample = `
// src/services/Admin/department.service.js

const models = require("./src/models");
const { validateDocument } = require("../model-validation.service");
const { DepartmentValidation } = require("../../models/validation");
const { ApiError } = require("../../utils/http");

async function createDepartment(payload, collegeId, superAdminId) {
  // Verify college exists
  const college = await dbClient.college.findUnique({
    where: { id: collegeId },
  });

  if (!college) throw new ApiError(422, "College not found");

  // Validate department
  const validated = await validateDocument(DepartmentValidation, {
    name: payload.name,
    collegeId,
    headId: payload.headId || null,
    isActive: true,
  }, "Department creation");

  // Create
  return dbClient.department.create({
    data: validated,
  });
}

async function assignDepartmentHead(departmentId, adminId, collegeId) {
  const existing = await dbClient.department.findUnique({
    where: { id: departmentId },
  });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Department not found");
  }

  // Validate admin exists and is in same college
  const admin = await dbClient.admin.findUnique({
    where: { id: adminId },
  });

  if (!admin || admin.collegeId !== collegeId) {
    throw new ApiError(422, "Admin not found in this college");
  }

  // Validate with head assignment
  const validated = await validateDocument(DepartmentValidation, {
    ...existing,
    headId: adminId,
  }, "Department head assignment");

  return dbClient.department.update({
    where: { id: departmentId },
    data: validated,
  });
}

module.exports = {
  createDepartment,
  assignDepartmentHead,
};
`;

// ============================================================================
// SUMMARY: Validation + ModelClient Pattern
// ============================================================================

const pattern = `
HYBRID PATTERN: Validation + ModelClient

┌─────────────────────────────────────────────────┐
│ 1. VALIDATE (Mongoose)                          │
│    - Check required fields                       │
│    - Validate enums (role, status, type)        │
│    - Check field ranges (min, max)              │
│    - Verify references (collegeId, adminId)     │
│    ~ 1-2ms per document                         │
└─────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────┐
│ 2. PERSIST (ModelClient)                        │
│    - Use validated data as-is                   │
│    - No Mongoose schema enforcement             │
│    - Direct MongoDB collection insert/update    │
│    - Native performance (5-50ms)                │
└─────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────┐
│ 3. AUDIT (Optional)                             │
│    - Log action to auditLog collection          │
│    - Track who, what, when, why                 │
│    - Use modelClient for audit records too      │
└─────────────────────────────────────────────────┘

FLOW:
  Request
    ↓
  Route Validation (Zod) ← Basic format checks
    ↓
  Service Layer
    ├─ validateDocument(Model, payload) ← Schema checks
    │  └─ Check enums, ranges, references
    ├─ modelClient.create(data) ← Direct DB insert
    │  └─ Uses validated data unchanged
    └─ Audit (optional)
    ↓
  Response

KEY POINTS:
✓ No breaking changes to modelClient
✓ Validation optional (backward compatible)
✓ Minimal performance overhead
✓ Clear error messages
✓ Easy to extend to new services
✓ Safe bulk operations
✓ No ODM coupling
`;

module.exports = {
  studentServiceExample,
  adminServiceExample,
  cloneServiceExample,
  testUpdateExample,
  batchOperationExample,
  departmentServiceExample,
  pattern,
};
