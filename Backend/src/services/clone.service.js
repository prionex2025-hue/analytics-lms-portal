const models = require("../models");
const { ApiError } = require("../utils/http");
const { validateDocument, validateDocuments } = require("./model-validation.service");
const {
  TestValidation,
  QuestionValidation,
  CloneMappingValidation,
} = require("../models/validation");
const { resolvePersistedTestConfiguration } = require("../services/test-config.service");
const DEFAULT_STUDENT_YEARS = [1, 2, 3, 4];

const normalizeStudentYears = (years) => {
  const source = Array.isArray(years) ? years : DEFAULT_STUDENT_YEARS;
  const normalized = [...new Set(source
    .map((year) => Number(year))
    .filter((year) => Number.isInteger(year) && year >= 1 && year <= 4))];
  return normalized.length ? normalized.sort((a, b) => a - b) : DEFAULT_STUDENT_YEARS;
};

// Helper to generate a non-colliding title within a college.
async function generateUniqueTitle(tx, baseTitle, collegeId) {
  const existing = await tx.test.findMany({
    where: { collegeId, title: { contains: baseTitle, mode: "insensitive" } },
    select: { title: true },
  });

  const titles = new Set(existing.map((t) => (t.title || "").toLowerCase()));
  if (!titles.has(baseTitle.toLowerCase())) return baseTitle;

  // Try "(Copy)", "(Copy 2)", ...
  const copyBase = `${baseTitle} (Copy)`;
  if (!titles.has(copyBase.toLowerCase())) return copyBase;

  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${baseTitle} (Copy ${i})`;
    if (!titles.has(candidate.toLowerCase())) return candidate;
  }

  // Fallback - append timestamp
  return `${baseTitle} (Copy ${Date.now()})`;
}

/**
 * Clone a test into a destination college (used by super-admin).
 * Ensures deep copy of questions and batch assignments, records clone mapping.
 */
async function cloneTestToCollege({ sourceTestId, destinationCollegeId, assignmentMethod = "batch_wise", departmentIds = [], batchIds = [], years = null, superAdminId }) {
  const m = await models.init();
  const db = m.dbClient;

  const source = await db.test.findUnique({ where: { id: sourceTestId } });
  if (!source) throw new ApiError(404, "Source test not found");

  return db.$transaction(async (tx) => {
    // Ensure destination has an admin — controllers normally check this; keep safe
    const admin = await tx.admin.findFirst({ where: { collegeId: destinationCollegeId, isActive: true } });
    if (!admin) throw new ApiError(400, "Destination college must have an active admin");

    // Resolve batches and departments (controllers may pass pre-validated lists)
    let resolvedBatchIds = [];
    let resolvedDepartmentIds = [];

    if (assignmentMethod === "department_wise") {
      // Validate department IDs provided
      if (!Array.isArray(departmentIds) || departmentIds.length === 0) {
        throw new ApiError(422, "For department-wise assignment, provide at least one departmentId", { assignmentMethod }, "MISSING_DEPARTMENT_IDS");
      }
      
      const departments = await tx.department.findMany({ where: { id: { in: departmentIds }, collegeId: destinationCollegeId } });
      resolvedDepartmentIds = departments.map((d) => d.id);
      if (!resolvedDepartmentIds.length) throw new ApiError(422, "No valid departments found in the destination college", { providedIds: departmentIds }, "INVALID_DEPARTMENT_IDS");

      const eligibleBatches = await tx.batch.findMany({ where: { collegeId: destinationCollegeId, departmentId: { in: resolvedDepartmentIds } } });
      resolvedBatchIds = eligibleBatches.map((b) => b.id);
    } else {
      // Validate batch IDs provided
      if (!Array.isArray(batchIds) || batchIds.length === 0) {
        throw new ApiError(422, "For batch-wise assignment, provide at least one batchId", { assignmentMethod }, "MISSING_BATCH_IDS");
      }
      
      const eligibleBatches = await tx.batch.findMany({ where: { id: { in: batchIds }, collegeId: destinationCollegeId } });
      resolvedBatchIds = eligibleBatches.map((b) => b.id);
      if (!resolvedBatchIds.length) throw new ApiError(422, "No valid batches found in the destination college", { providedIds: batchIds }, "INVALID_BATCH_IDS");
      resolvedDepartmentIds = [...new Set(eligibleBatches.map((b) => b.departmentId).filter(Boolean))];
    }

    const title = await generateUniqueTitle(tx, `${source.title}`, destinationCollegeId);
    const persistedConfig = resolvePersistedTestConfiguration({ existingTest: source }).persistenceFields;

    const clonedTestPayload = await validateDocument(TestValidation, {
      title,
      subject: source.subject,
      description: source.description,
      durationMins: source.durationMins,
      totalMarks: source.totalMarks,
      attemptsAllowed: source.attemptsAllowed,
      evaluationRule: source.evaluationRule,
      negativeMarkingEnabled: Boolean(source.negativeMarkingEnabled),
      negativeMarks: Number(source.negativeMarks || 0),
      shuffleQuestions: Boolean(source.shuffleQuestions),
      shuffleAnswers: Boolean(source.shuffleAnswers),
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      isPublished: false,
      status: "DRAFT",
      isGlobal: source.isGlobal,
      assignmentMethod,
      years: normalizeStudentYears(years || source.years),
      assignedTo: assignmentMethod === "department_wise" ? resolvedDepartmentIds : [],
      sourceTestId: source.id,
      collegeId: destinationCollegeId,
      departmentId: assignmentMethod === "department_wise" && resolvedDepartmentIds.length === 1
        ? resolvedDepartmentIds[0]
        : null,
      batchId: resolvedBatchIds[0] || null,
      createdByAdminId: admin.id,
      assessmentFormat: source.assessmentFormat || "OPEN_TEST",
      modules: Array.isArray(source.modules) ? source.modules : [],
      ...persistedConfig,
    }, "Cloned test");

    const cloned = await tx.test.create({ data: clonedTestPayload });

    // Fetch and copy questions
    const questions = await tx.question.findMany({ where: { testId: sourceTestId } });
    if (Array.isArray(questions) && questions.length > 0) {
      const rows = questions.map((q) => ({
        testId: cloned.id,
        collegeId: destinationCollegeId,
        prompt: q.prompt,
        type: q.type,
        options: q.options || [],
        correctOption: q.correctOption || null,
        correctBoolean: q.correctBoolean ?? null,
        correctText: q.correctText || null,
        marks: q.marks,
        category: q.category ?? null,
        order: q.order,
      }));
      const validatedQuestions = await validateDocuments(QuestionValidation, rows, "Cloned question");
      await tx.question.createMany({ data: validatedQuestions });
    }

    if (resolvedBatchIds.length > 0) {
      await tx.testBatch.createMany({ data: resolvedBatchIds.map((batchId) => ({ testId: cloned.id, batchId, collegeId: destinationCollegeId })) });
    }

    // Record mapping for traceability
    const cloneMappingPayload = await validateDocument(CloneMappingValidation, {
      sourceTestId: source.id,
      clonedTestId: cloned.id,
      targetCollegeId: destinationCollegeId,
      targetDepartmentId: resolvedDepartmentIds[0] || null,
      createdAt: new Date(),
      createdBy: superAdminId || null,
    }, "Clone mapping");

    await tx.cloneMapping.create({ data: cloneMappingPayload });

    return cloned;
  });
}

/**
 * Clone a test within the same college (admin-level clone across departments).
 */
async function cloneTestWithinCollege({ sourceTestId, collegeId, assignmentMethod = "department_wise", departmentId = null, batchIds = [], years = null, adminId }) {
  const m = await models.init();
  const db = m.dbClient;

  const source = await db.test.findUnique({ where: { id: sourceTestId } });
  if (!source) throw new ApiError(404, "Source test not found");
  if (source.collegeId !== collegeId) throw new ApiError(403, "Permission denied to clone test from other college");

  return db.$transaction(async (tx) => {
    // Resolve batch scope
    let resolvedBatchIds = [];
    let resolvedDepartmentId = departmentId;

    if (assignmentMethod === "department_wise") {
      if (!resolvedDepartmentId) throw new ApiError(422, "Select a department for department-wise assignment");
      const batches = await tx.batch.findMany({ where: { collegeId, departmentId: resolvedDepartmentId } });
      resolvedBatchIds = batches.map((b) => b.id);
    } else {
      const batches = await tx.batch.findMany({ where: { id: { in: batchIds }, collegeId } });
      resolvedBatchIds = batches.map((b) => b.id);
      if (!resolvedBatchIds.length) throw new ApiError(422, "No valid batches found in this college");
      if (!resolvedDepartmentId) resolvedDepartmentId = batches[0]?.departmentId || null;
    }

    const title = await generateUniqueTitle(tx, `${source.title}`, collegeId);
    const persistedConfig = resolvePersistedTestConfiguration({ existingTest: source }).persistenceFields;

    const clonedTestPayload = await validateDocument(TestValidation, {
      title,
      subject: source.subject,
      description: source.description,
      durationMins: source.durationMins,
      totalMarks: source.totalMarks,
      attemptsAllowed: source.attemptsAllowed,
      evaluationRule: source.evaluationRule,
      negativeMarkingEnabled: Boolean(source.negativeMarkingEnabled),
      negativeMarks: Number(source.negativeMarks || 0),
      shuffleQuestions: Boolean(source.shuffleQuestions),
      shuffleAnswers: Boolean(source.shuffleAnswers),
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      isPublished: false,
      status: "DRAFT",
      isGlobal: source.isGlobal,
      assignmentMethod,
      years: normalizeStudentYears(years || source.years),
      sourceTestId: source.id,
      collegeId,
      departmentId: resolvedDepartmentId || null,
      batchId: resolvedBatchIds[0] || null,
      createdByAdminId: adminId,
      assessmentFormat: source.assessmentFormat || "OPEN_TEST",
      modules: Array.isArray(source.modules) ? source.modules : [],
      ...persistedConfig,
    }, "Cloned test");

    const cloned = await tx.test.create({ data: clonedTestPayload });

    // Fetch and copy questions
    const questions = await tx.question.findMany({ where: { testId: sourceTestId } });
    if (Array.isArray(questions) && questions.length > 0) {
      const rows = questions.map((q) => ({
        testId: cloned.id,
        collegeId,
        prompt: q.prompt,
        type: q.type,
        options: q.options || [],
        correctOption: q.correctOption || null,
        correctBoolean: q.correctBoolean ?? null,
        correctText: q.correctText || null,
        marks: q.marks,
        category: q.category ?? null,
        order: q.order,
      }));
      const validatedQuestions = await validateDocuments(QuestionValidation, rows, "Cloned question");
      await tx.question.createMany({ data: validatedQuestions });
    }

    if (resolvedBatchIds.length > 0) {
      await tx.testBatch.createMany({ data: resolvedBatchIds.map((batchId) => ({ testId: cloned.id, batchId, collegeId })) });
    }

    const cloneMappingPayload = await validateDocument(CloneMappingValidation, {
      sourceTestId: source.id,
      clonedTestId: cloned.id,
      targetCollegeId: collegeId,
      targetDepartmentId: resolvedDepartmentId || null,
      createdAt: new Date(),
      createdBy: adminId || null,
    }, "Clone mapping");

    await tx.cloneMapping.create({ data: cloneMappingPayload });

    return cloned;
  });
}

module.exports = {
  cloneTestToCollege,
  cloneTestWithinCollege,
};
