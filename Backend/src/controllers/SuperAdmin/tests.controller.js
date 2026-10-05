const models = require("../../models");
const env = require("../../config/env");
const { createAuditLog } = require("../../services/audit.service");
const { completeSubmission } = require("../../services/test.service");
const { emitToCollege, emitToTestRoom } = require("../../realtime/socket");
const { ApiError, asyncHandler } = require("../../utils/http");
const { getExamState } = require("../../services/exam-state-cache.service");
const { getExamRateLimitMetricsSnapshot } = require("../../services/rate-limit-metrics.service");
const {
  attachResolvedTestConfiguration,
  resolvePersistedTestConfiguration,
  ASSESSMENT_FORMATS,
  normalizeAssessmentFormat,
  resolveModules,
  sumModuleDurations,
  normalizeQuestionCategory,
  validateModuleAssessment,
} = require("../../services/test-config.service");
const { cloneTestToCollege: cloneServiceToCollege } = require("../../services/clone.service");
const { getPagination } = require("../../utils/pagination");
const {
  detectDuplicatesInTest,
  detectDuplicatesAcrossQuestionBank,
} = require("../../services/duplicate-detection.service");

const TEST_STATUS = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  LIVE: "LIVE",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
};

const LEGACY_STATUS = {
  UPCOMING: "UPCOMING",
  PUBLISHED: "PUBLISHED",
};

const TRANSITION_ACTION = {
  SCHEDULE: "SCHEDULE",
  GO_LIVE: "GO_LIVE",
  COMPLETE: "COMPLETE",
  ARCHIVE: "ARCHIVE",
};

const PUBLISH_STATE = {
  DRAFT: "DRAFT",
  UPCOMING: "UPCOMING",
  PUBLISH: "PUBLISH",
};

const ALLOWED_TRANSITIONS = {
  [TEST_STATUS.DRAFT]: [TEST_STATUS.SCHEDULED, TEST_STATUS.LIVE, TEST_STATUS.ARCHIVED],
  [TEST_STATUS.SCHEDULED]: [TEST_STATUS.LIVE, TEST_STATUS.ARCHIVED],
  [TEST_STATUS.LIVE]: [TEST_STATUS.COMPLETED, TEST_STATUS.ARCHIVED],
  [TEST_STATUS.COMPLETED]: [TEST_STATUS.ARCHIVED],
  [TEST_STATUS.ARCHIVED]: [],
};
const DEFAULT_STUDENT_YEARS = [1, 2, 3, 4];

const normalizeOptionalUrl = (value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const normalizeStudentYears = (years) => {
  const source = Array.isArray(years) ? years : DEFAULT_STUDENT_YEARS;
  const normalized = [...new Set(source
    .map((year) => Number(year))
    .filter((year) => Number.isInteger(year) && year >= 1 && year <= 4))];
  return normalized.length ? normalized.sort((a, b) => a - b) : DEFAULT_STUDENT_YEARS;
};

function normalizeText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s\u00A0\u2000-\u200B\u3000]+/g, " ")
    .replace(/[.,;:!?+\-*/=()\[\]{}]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt) => normalizeText(opt))
    .filter((opt) => opt.length > 0)
    .sort();
}

function normalizeCorrectAnswer(answer, type) {
  if (answer === null || answer === undefined) return "";
  const normalized = normalizeText(String(answer));
  if (type === "TRUE_FALSE" || type === "BOOLEAN") {
    return normalized === "true" ? "true" : "false";
  }
  return normalized;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function generateQuestionFingerprint(doc) {
  const normalizedPrompt = normalizeText(doc.prompt);
  const normalizedOpts = normalizeOptions(doc.options);
  const normalizedCorrect = normalizeCorrectAnswer(
    doc.correctOption || doc.correctText || doc.correctBoolean,
    doc.type
  );

  const promptHash = hashString(normalizedPrompt);
  const optionsHash = hashString(normalizedOpts.join("|"));
  const correctHash = hashString(normalizedCorrect);

  return `${promptHash}:${optionsHash}:${correctHash}`;
}

function buildQuestionData(question, index, testId, collegeId, isModuleAssessment) {
  const prompt = question.prompt;
  const type = question.type;
  const options = question.options || [];
  const correctOption = question.correctOption || null;
  const correctBoolean = question.correctBoolean ?? null;
  const correctText = question.correctText || null;

  const questionDoc = {
    testId,
    collegeId,
    prompt,
    type,
    options,
    correctOption,
    correctBoolean,
    correctText,
    marks: question.marks || 1,
    difficulty: question.difficulty || "MEDIUM",
    topic: question.topic || null,
    category: isModuleAssessment ? normalizeQuestionCategory(question.category) : null,
    explanationVideoUrl: normalizeOptionalUrl(question.explanationVideoUrl),
    order: index + 1,
  };

  questionDoc.normalizedPrompt = normalizeText(prompt);
  questionDoc.fingerprint = generateQuestionFingerprint(questionDoc);

  return questionDoc;
}

const isPublishNow = (publishState) => publishState === PUBLISH_STATE.PUBLISH;
const isUpcoming = (publishState) => publishState === PUBLISH_STATE.UPCOMING;

const resolveStatus = (publishState, startsAt) => {
  if (isPublishNow(publishState)) {
    return startsAt > new Date() ? TEST_STATUS.SCHEDULED : TEST_STATUS.LIVE;
  }

  if (isUpcoming(publishState)) {
    return TEST_STATUS.SCHEDULED;
  }

  return TEST_STATUS.DRAFT;
};

const resolvePublicationUpdateFields = ({ existing, currentStatus, publishState, startsAt, endsAt }) => {
  if (!publishState) {
    return {
      status: deriveLifecycleStatus({ ...existing, startsAt, endsAt }, new Date()),
      isPublished: existing.isPublished,
    };
  }

  const now = new Date();

  if (publishState === PUBLISH_STATE.DRAFT) {
    if (currentStatus === TEST_STATUS.LIVE) {
      throw new ApiError(409, "Live tests cannot be moved back to draft", null, "LIVE_TO_DRAFT_BLOCKED");
    }

    return {
      status: TEST_STATUS.DRAFT,
      isPublished: false,
    };
  }

  if (publishState === PUBLISH_STATE.UPCOMING) {
    if (startsAt <= now) {
      throw new ApiError(422, "Scheduled tests require a future start date", null, "SCHEDULE_REQUIRES_FUTURE_START");
    }

    return {
      status: TEST_STATUS.SCHEDULED,
      isPublished: true,
    };
  }

  if (publishState === PUBLISH_STATE.PUBLISH) {
    if (startsAt > now) {
      throw new ApiError(422, "Cannot publish live before start date", null, "LIVE_BEFORE_START_NOT_ALLOWED");
    }

    return {
      status: TEST_STATUS.LIVE,
      isPublished: true,
    };
  }

  throw new ApiError(422, `Unsupported publish state ${publishState}`, null, "INVALID_PUBLISH_STATE");
};

const deriveLifecycleStatus = (test, now = new Date()) => {
  const status = String(test?.status || "").toUpperCase();

  if (status === TEST_STATUS.ARCHIVED) {
    return TEST_STATUS.ARCHIVED;
  }

  if (status === TEST_STATUS.DRAFT) {
    return TEST_STATUS.DRAFT;
  }

  if (status === LEGACY_STATUS.UPCOMING) {
    return TEST_STATUS.SCHEDULED;
  }

  if (
    status === TEST_STATUS.SCHEDULED
    || status === TEST_STATUS.LIVE
    || status === TEST_STATUS.COMPLETED
    || status === LEGACY_STATUS.PUBLISHED
  ) {
    const startsAt = test?.startsAt ? new Date(test.startsAt) : null;
    const endsAt = test?.endsAt ? new Date(test.endsAt) : null;

    if (startsAt && startsAt > now) {
      return TEST_STATUS.SCHEDULED;
    }

    if (endsAt && endsAt < now) {
      return TEST_STATUS.COMPLETED;
    }

    return TEST_STATUS.LIVE;
  }

  if (test?.isPublished) {
    const startsAt = test?.startsAt ? new Date(test.startsAt) : null;
    const endsAt = test?.endsAt ? new Date(test.endsAt) : null;

    if (startsAt && startsAt > now) {
      return TEST_STATUS.SCHEDULED;
    }

    if (endsAt && endsAt < now) {
      return TEST_STATUS.COMPLETED;
    }

    return TEST_STATUS.LIVE;
  }

  return TEST_STATUS.DRAFT;
};

const assertTransition = (currentStatus, nextStatus) => {
  if (currentStatus === nextStatus) {
    return;
  }

  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw new ApiError(
      409,
      `Invalid test status transition from ${currentStatus} to ${nextStatus}`,
      { currentStatus, nextStatus, allowedTransitions: allowed },
      "INVALID_TEST_STATUS_TRANSITION"
    );
  }
};

const resolveTransitionTarget = (action) => {
  switch (action) {
    case TRANSITION_ACTION.SCHEDULE:
      return TEST_STATUS.SCHEDULED;
    case TRANSITION_ACTION.GO_LIVE:
      return TEST_STATUS.LIVE;
    case TRANSITION_ACTION.COMPLETE:
      return TEST_STATUS.COMPLETED;
    case TRANSITION_ACTION.ARCHIVE:
      return TEST_STATUS.ARCHIVED;
    default:
      throw new ApiError(422, `Unsupported transition action ${action}`, null, "INVALID_TRANSITION_ACTION");
  }
};

const transitionAuditAction = (action) => {
  switch (action) {
    case TRANSITION_ACTION.SCHEDULE:
      return "SUPER_ADMIN_TEST_SCHEDULED";
    case TRANSITION_ACTION.GO_LIVE:
      return "SUPER_ADMIN_TEST_LIVE";
    case TRANSITION_ACTION.COMPLETE:
      return "SUPER_ADMIN_TEST_COMPLETED";
    case TRANSITION_ACTION.ARCHIVE:
      return "SUPER_ADMIN_TEST_ARCHIVED";
    default:
      return "SUPER_ADMIN_TEST_STATUS_CHANGED";
  }
};

const getTestsGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { page, limit, skip } = getPagination(req.query);
  const collegeId = req.query.collegeId;
  const search = (req.query.search || "").trim();
  const status = (req.query.status || "").trim().toUpperCase();

  const statusFilter = !status || status === "ALL"
    ? {}
    : status === TEST_STATUS.SCHEDULED
      ? { status: { in: [TEST_STATUS.SCHEDULED, LEGACY_STATUS.UPCOMING] } }
      : status === TEST_STATUS.LIVE
        ? { status: { in: [TEST_STATUS.LIVE, LEGACY_STATUS.PUBLISHED] } }
        : { status };

  const where = {
    ...(collegeId ? { collegeId } : {}),
    ...statusFilter,
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { subject: { contains: search, mode: "insensitive" } },
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
    db.test.findMany({
      where,
      include: {
        college: true,
        department: true,
        batch: true,
        _count: {
          select: {
            questions: true,
            submissions: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.test.count({ where }),
  ]);

  res.status(200).json({
    data: items.map((item) => attachResolvedTestConfiguration(item)),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

const getGlobalTestById = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;

  const test = await db.test.findUnique({
    where: { id: testId },
    include: {
      college: true,
      department: true,
      questions: {
        orderBy: { order: "asc" },
      },
      batchAssignments: {
        select: {
          batchId: true,
          batch: {
            select: {
              id: true,
              name: true,
              year: true,
              departmentId: true,
              collegeId: true,
            },
          },
        },
      },
      _count: {
        select: {
          questions: true,
          submissions: true,
        },
      },
    },
  });

  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  const lifecycleStatus = deriveLifecycleStatus(test);
  if (lifecycleStatus !== test.status) {
    await db.test.update({
      where: { id: test.id },
      data: { status: lifecycleStatus },
    });
  }

  res.status(200).json({
    ...attachResolvedTestConfiguration(test),
    status: lifecycleStatus,
  });
});

const createGlobalTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const payload = req.body;
  let collegeIds = Array.isArray(payload.collegeIds) ? payload.collegeIds : [];
  const assignmentMethod = payload.assignmentMethod || "department_wise";
  const years = normalizeStudentYears(payload.years);
  const publishState = payload.publishState || PUBLISH_STATE.UPCOMING;
  const startsAtDate = new Date(payload.startsAt);
  const endsAtDate = new Date(payload.endsAt);
  const requestedBatchIds = Array.isArray(payload.batchIds) ? payload.batchIds : [];
  const requestedDepartmentIds = assignmentMethod === "department_wise"
    ? (Array.isArray(payload.departmentIds) ? payload.departmentIds : [])
    : [];
  const resolvedTestConfiguration = resolvePersistedTestConfiguration({
    testType: payload.testType,
    proctoringPreset: payload.proctoringPreset,
    proctoringConfig: payload.proctoringConfig,
    restrictions: payload.restrictions,
  });

  // Resolve assessment format (OPEN_TEST default). MODULE_TEST derives duration
  // from module durations and requires categorized questions.
  const resolvedAssessmentFormat = normalizeAssessmentFormat(payload.assessmentFormat);
  const isModuleAssessment = resolvedAssessmentFormat === ASSESSMENT_FORMATS.MODULE_TEST;
  let resolvedModules = [];
  let resolvedDurationMins = payload.durationMins;
  if (isModuleAssessment) {
    const moduleValidation = validateModuleAssessment({ modules: payload.modules, questions: payload.questions });
    if (moduleValidation.errors.length > 0) {
      throw new ApiError(
        422,
        "Module test validation failed",
        { errors: moduleValidation.errors, perCategoryCounts: moduleValidation.perCategoryCounts },
        "MODULE_TEST_VALIDATION_FAILED"
      );
    }
    resolvedModules = resolveModules(payload.modules);
    resolvedDurationMins = sumModuleDurations(resolvedModules);
  }

  if (Number.isNaN(startsAtDate.getTime()) || Number.isNaN(endsAtDate.getTime())) {
    throw new ApiError(422, "Invalid startsAt/endsAt values");
  }

  if (endsAtDate <= startsAtDate) {
    throw new ApiError(422, "End date/time must be after start date/time", null, "INVALID_END_DATE");
  }

  if (isPublishNow(publishState) && startsAtDate > new Date()) {
    throw new ApiError(422, "Cannot publish live before start date", null, "LIVE_BEFORE_START_NOT_ALLOWED");
  }

  if (payload.allColleges) {
    const colleges = await db.college.findMany({ where: { isActive: true }, select: { id: true } });
    collegeIds = colleges.map((item) => item.id);
  }

  if (!collegeIds.length) {
    throw new ApiError(400, "At least one college must be targeted");
  }

  const normalizedCollegeIds = [...new Set(collegeIds.filter(Boolean))];

  let scopedDepartmentIds = [];
  let scopedBatchIds = [];

  if (assignmentMethod === "department_wise") {
    const normalizedDepartmentIds = [...new Set(requestedDepartmentIds.filter(Boolean))];

    if (!normalizedDepartmentIds.length) {
      throw new ApiError(422, "Select at least one department for department-wise assignment");
    }

    const scopedDepartments = await db.department.findMany({
      where: {
        id: { in: normalizedDepartmentIds },
        collegeId: { in: normalizedCollegeIds },
      },
      select: { id: true, collegeId: true },
    });

    scopedDepartmentIds = scopedDepartments.map((item) => item.id);

    const missingDepartmentIds = normalizedDepartmentIds.filter((id) => !scopedDepartmentIds.includes(id));
    if (missingDepartmentIds.length > 0) {
      throw new ApiError(
        422,
        "Some selected departments are invalid for the selected colleges",
        { missingDepartmentIds },
        "INVALID_DEPARTMENT_SCOPE"
      );
    }
  }

  if (assignmentMethod === "batch_wise") {
    const normalizedBatchIds = [...new Set(requestedBatchIds.filter(Boolean))];

    if (!normalizedBatchIds.length) {
      throw new ApiError(422, "Select at least one batch for batch-wise assignment");
    }

    const scopedBatches = await db.batch.findMany({
      where: {
        id: { in: normalizedBatchIds },
        collegeId: { in: normalizedCollegeIds },
      },
      select: { id: true },
    });

    scopedBatchIds = scopedBatches.map((item) => item.id);

    const missingBatchIds = normalizedBatchIds.filter((id) => !scopedBatchIds.includes(id));
    if (missingBatchIds.length > 0) {
      throw new ApiError(
        422,
        "Some selected batches are invalid for the selected colleges",
        { missingBatchIds },
        "INVALID_BATCH_SCOPE"
      );
    }
  }

  const admins = await db.admin.findMany({
    where: {
      collegeId: { in: normalizedCollegeIds },
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      collegeId: true,
    },
  });

  const adminByCollege = new Map();
  admins.forEach((admin) => {
    if (!adminByCollege.has(admin.collegeId)) {
      adminByCollege.set(admin.collegeId, admin);
    }
  });

  const candidateBatches = await db.batch.findMany({
    where: {
      collegeId: { in: normalizedCollegeIds },
      ...(assignmentMethod === "batch_wise"
        ? { id: { in: scopedBatchIds } }
        : scopedDepartmentIds.length
          ? { departmentId: { in: scopedDepartmentIds } }
          : {}),
    },
    select: {
      id: true,
      collegeId: true,
      departmentId: true,
    },
  });

  const batchesByCollege = new Map();
  candidateBatches.forEach((batch) => {
    const existing = batchesByCollege.get(batch.collegeId) || [];
    existing.push(batch);
    batchesByCollege.set(batch.collegeId, existing);
  });

  const departmentsByCollege = new Map();
  if (assignmentMethod === "department_wise") {
    const scopedDepartments = await db.department.findMany({
      where: {
        id: { in: scopedDepartmentIds },
        collegeId: { in: normalizedCollegeIds },
      },
      select: {
        id: true,
        collegeId: true,
      },
    });

    scopedDepartments.forEach((department) => {
      const existing = departmentsByCollege.get(department.collegeId) || [];
      existing.push(department);
      departmentsByCollege.set(department.collegeId, existing);
    });
  }

  const created = [];

  for (const collegeId of normalizedCollegeIds) {
    const eligibleBatches = batchesByCollege.get(collegeId) || [];
    const resolvedBatchIds = eligibleBatches.map((item) => item.id);
    const scopedDepartmentsForCollege = departmentsByCollege.get(collegeId) || [];

    if (assignmentMethod === "batch_wise" && !resolvedBatchIds.length) {
      continue;
    }

    if (assignmentMethod === "department_wise" && !scopedDepartmentsForCollege.length) {
      continue;
    }

    const admin = adminByCollege.get(collegeId);

    if (!admin) {
      continue;
    }

    const assignedDepartmentIds = assignmentMethod === "department_wise"
      ? scopedDepartmentsForCollege.map((department) => department.id)
      : [];

    const resolvedDepartmentId =
      assignmentMethod === "department_wise" && assignedDepartmentIds.length === 1
        ? assignedDepartmentIds[0]
        : null;

    const test = await db.test.create({
      data: {
        title: payload.title,
        subject: payload.subject,
        description: payload.description || null,
        instructions: payload.instructions || null,
        durationMins: resolvedDurationMins,
        totalMarks: payload.totalMarks,
        attemptsAllowed: payload.attemptsAllowed,
        evaluationRule: payload.evaluationRule,
        negativeMarkingEnabled: Boolean(payload.negativeMarkingEnabled),
        negativeMarks: Number(payload.negativeMarks || 0),
        shuffleQuestions: Boolean(payload.shuffleQuestions),
        shuffleAnswers: Boolean(payload.shuffleAnswers),
        startsAt: startsAtDate,
        endsAt: endsAtDate,
        isPublished: publishState !== PUBLISH_STATE.DRAFT,
        status: resolveStatus(publishState, startsAtDate),
        isGlobal: true,
        assignmentMethod,
        years,
        assignedTo: assignedDepartmentIds,
        collegeId,
        batchId: resolvedBatchIds[0] || null,
        createdByAdminId: admin.id,
        departmentId: resolvedDepartmentId,
        assessmentFormat: resolvedAssessmentFormat,
        modules: resolvedModules,
        ...resolvedTestConfiguration.persistenceFields,
      },
    });

    if (resolvedBatchIds.length > 0) {
      await db.testBatch.createMany({
        data: resolvedBatchIds.map((batchId) => ({
          testId: test.id,
          batchId,
          collegeId,
        })),
        skipDuplicates: true,
      });
    }

    const questionRows = payload.questions.map((question, index) => buildQuestionData(question, index, test.id, collegeId, isModuleAssessment));
    const duplicateCheck = await detectDuplicatesInTest(collegeId, test.id, questionRows);
    if (!duplicateCheck.valid) {
      const validationSummary = {
        total: payload.questions.length,
        valid: duplicateCheck.summary.valid,
        exactDuplicates: duplicateCheck.summary.exactDuplicates,
        potentialSemanticDuplicates: duplicateCheck.summary.semanticDuplicates,
        optionErrors: duplicateCheck.summary.optionErrors,
      };
      const errorResponse = {
        valid: false,
        duplicate: true,
        message: "Duplicate questions detected in test",
        details: duplicateCheck.results,
        validation: validationSummary,
      };
      throw new ApiError(409, "Duplicate questions detected in test", errorResponse, "DUPLICATE_QUESTIONS_IN_TEST");
    }

    if (questionRows.length > 0) {
      await db.question.createMany({ data: questionRows });
    }

    created.push(test);
  }

  if (!created.length) {
    throw new ApiError(422, "No eligible college/batch scope found for assignment selection");
  }

  await createAuditLog({
    action: "SUPER_ADMIN_CREATE_GLOBAL_TEST",
    targetType: "TEST",
    targetId: created[0]?.id || "multi",
    superAdminId: req.superAdmin.id,
    afterState: {
      title: payload.title,
      colleges: normalizedCollegeIds,
      createdCount: created.length,
      publishState,
      testType: resolvedTestConfiguration.testType,
      proctoringPreset: resolvedTestConfiguration.proctoringPreset,
    },
  });

  res.status(201).json({
    message: "Global test created",
    data: created.map((item) => attachResolvedTestConfiguration(item)),
  });
});

const cloneTestToCollege = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const { destinationCollegeId, assignmentMethod = "batch_wise", departmentIds = [], batchIds = [], years } = req.body;

  // Validate destination college is provided
  if (!destinationCollegeId) {
    throw new ApiError(422, "destinationCollegeId is required", null, "MISSING_DESTINATION_COLLEGE");
  }

  // Validate assignment parameters based on method
  if (assignmentMethod === "department_wise" && (!Array.isArray(departmentIds) || departmentIds.length === 0)) {
    throw new ApiError(422, "For department-wise assignment, provide departmentIds array with at least one ID", { assignmentMethod }, "MISSING_DEPARTMENT_IDS");
  }
  if (assignmentMethod === "batch_wise" && (!Array.isArray(batchIds) || batchIds.length === 0)) {
    throw new ApiError(422, "For batch-wise assignment, provide batchIds array with at least one ID", { assignmentMethod }, "MISSING_BATCH_IDS");
  }

  const cloned = await cloneServiceToCollege({
    sourceTestId: testId,
    destinationCollegeId,
    assignmentMethod,
    departmentIds: Array.isArray(departmentIds) ? departmentIds : [],
    batchIds: Array.isArray(batchIds) ? batchIds : [],
    years,
    superAdminId: req.superAdmin.id,
  });

  await createAuditLog({
    action: "SUPER_ADMIN_CLONE_TEST",
    targetType: "TEST",
    targetId: cloned.id,
    collegeId: destinationCollegeId,
    superAdminId: req.superAdmin.id,
    beforeState: { sourceTestId: testId },
    afterState: {
      clonedTestId: cloned.id,
      sourceTestId: cloned.sourceTestId,
      destinationCollegeId,
      assignmentMethod,
      status: cloned.status,
      isPublished: cloned.isPublished,
    },
  });

  res.status(201).json({
    id: cloned.id,
    title: cloned.title,
    status: cloned.status,
    isPublished: cloned.isPublished,
    sourceTestId: cloned.sourceTestId,
    collegeId: cloned.collegeId,
    assignmentMethod: cloned.assignmentMethod,
    message: "Test cloned successfully to destination college and kept in DRAFT status",
    data: attachResolvedTestConfiguration(cloned),
  });
});

const updateGlobalTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const payload = req.body;

  const existing = await db.test.findUnique({
    where: { id: testId },
    include: {
      questions: true,
      batchAssignments: true,
    },
  });

  if (!existing) {
    throw new ApiError(404, "Test not found");
  }

  const currentStatus = deriveLifecycleStatus(existing);

  if (currentStatus === TEST_STATUS.COMPLETED || currentStatus === TEST_STATUS.ARCHIVED) {
    throw new ApiError(409, `Test is ${currentStatus.toLowerCase()} and immutable`, { currentStatus }, "TEST_IMMUTABLE");
  }

  const startsAt = new Date(payload.startsAt);
  const endsAt = new Date(payload.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new ApiError(422, "Invalid startsAt/endsAt values");
  }
  if (endsAt <= startsAt) {
    throw new ApiError(422, "End date/time must be after start date/time", null, "INVALID_END_DATE");
  }

  const publicationFields = resolvePublicationUpdateFields({
    existing,
    currentStatus,
    publishState: payload.publishState,
    startsAt,
    endsAt,
  });
  const resolvedTestConfiguration = resolvePersistedTestConfiguration({
    existingTest: existing,
    testType: payload.testType,
    proctoringPreset: payload.proctoringPreset,
    proctoringConfig: payload.proctoringConfig,
    restrictions: payload.restrictions,
  });

  // Resolve MODULE_TEST configuration. In settings-only (non-DRAFT) updates the
  // questions are locked, so only module durations are validated.
  const effectiveAssessmentFormat = normalizeAssessmentFormat(payload.assessmentFormat ?? existing.assessmentFormat);
  const isModuleAssessment = effectiveAssessmentFormat === ASSESSMENT_FORMATS.MODULE_TEST;
  let resolvedModules = Array.isArray(existing.modules) ? existing.modules : [];
  let moduleDurationMins = null;
  if (isModuleAssessment) {
    const modulesSource = typeof payload.modules !== "undefined" ? payload.modules : existing.modules;
    const questionsLocked = currentStatus !== TEST_STATUS.DRAFT;
    const moduleValidation = validateModuleAssessment({
      modules: modulesSource,
      questions: questionsLocked ? undefined : payload.questions,
      validateQuestions: !questionsLocked,
    });
    if (moduleValidation.errors.length > 0) {
      throw new ApiError(
        422,
        "Module test validation failed",
        { errors: moduleValidation.errors, perCategoryCounts: moduleValidation.perCategoryCounts },
        "MODULE_TEST_VALIDATION_FAILED"
      );
    }
    resolvedModules = resolveModules(modulesSource);
    moduleDurationMins = sumModuleDurations(resolvedModules);
  }

  const rootSourceId = existing.sourceTestId || existing.id;

  // Once a test leaves DRAFT its questions and assignment scope are locked, so
  // in-progress attempts and already-recorded grades are never mutated. Super
  // admins can still edit test *settings* (schedule, proctoring, attempts,
  // marking, shuffle, etc.), which propagate across the whole global-test family
  // without touching questions or batch/department assignments.
  if (currentStatus !== TEST_STATUS.DRAFT) {
    const familyTests = await db.test.findMany({
      where: { OR: [{ id: rootSourceId }, { sourceTestId: rootSourceId }] },
      select: { id: true, collegeId: true },
    });

    const settingsData = {
      title: payload.title,
      subject: payload.subject,
      description: payload.description || null,
      durationMins: isModuleAssessment ? moduleDurationMins : payload.durationMins,
      totalMarks: payload.totalMarks,
      attemptsAllowed: payload.attemptsAllowed,
      evaluationRule: payload.evaluationRule,
      negativeMarkingEnabled: Boolean(payload.negativeMarkingEnabled),
      negativeMarks: Number(payload.negativeMarks || 0),
      shuffleQuestions: Boolean(payload.shuffleQuestions),
      shuffleAnswers: Boolean(payload.shuffleAnswers),
      startsAt,
      endsAt,
      status: publicationFields.status,
      isPublished: publicationFields.isPublished,
      assessmentFormat: effectiveAssessmentFormat,
      modules: isModuleAssessment ? resolvedModules : [],
      ...resolvedTestConfiguration.persistenceFields,
    };

    await db.$transaction(
      familyTests.map((item) =>
        db.test.update({ where: { id: item.id }, data: settingsData })
      )
    );

    await createAuditLog({
      action: "SUPER_ADMIN_UPDATE_TEST_SETTINGS",
      targetType: "TEST",
      targetId: existing.id,
      collegeId: existing.collegeId,
      superAdminId: req.superAdmin.id,
      beforeState: existing,
      afterState: {
        title: payload.title,
        subject: payload.subject,
        status: publicationFields.status,
        settingsOnly: true,
        currentStatus,
        updatedTestIds: familyTests.map((item) => item.id),
        testType: resolvedTestConfiguration.testType,
        proctoringPreset: resolvedTestConfiguration.proctoringPreset,
      },
      testId: existing.id,
    });

    const hydrated = await db.test.findUnique({
      where: { id: existing.id },
      include: {
        college: true,
        department: true,
        questions: { orderBy: { order: "asc" } },
        batchAssignments: {
          select: {
            batchId: true,
            batch: {
              select: { id: true, name: true, year: true, departmentId: true, collegeId: true },
            },
          },
        },
        _count: { select: { questions: true, submissions: true } },
      },
    });

    return res.status(200).json({
      ...attachResolvedTestConfiguration(hydrated),
      propagation: {
        updatedCollegeIds: familyTests.map((item) => item.collegeId),
        createdCollegeIds: [],
        skippedColleges: [],
        settingsOnly: true,
      },
    });
  }

  let targetCollegeIds = Array.isArray(payload.collegeIds)
    ? payload.collegeIds.filter(Boolean)
    : [];

  if (payload.allColleges) {
    const colleges = await db.college.findMany({ where: { isActive: true }, select: { id: true } });
    targetCollegeIds = colleges.map((item) => item.id);
  }

  if (!targetCollegeIds.length) {
    targetCollegeIds = [existing.collegeId];
  }

  if (!targetCollegeIds.includes(existing.collegeId)) {
    targetCollegeIds.push(existing.collegeId);
  }

  targetCollegeIds = [...new Set(targetCollegeIds.filter(Boolean))];

  const assignmentMethod = payload.assignmentMethod || "department_wise";
  const years = normalizeStudentYears(payload.years);
  const selectedDepartmentIds = assignmentMethod === "department_wise"
    ? [...new Set((Array.isArray(payload.departmentIds) ? payload.departmentIds : []).filter(Boolean))]
    : [];
  const selectedBatchIds = assignmentMethod === "batch_wise"
    ? [...new Set((Array.isArray(payload.batchIds) ? payload.batchIds : []).filter(Boolean))]
    : [];

  if (assignmentMethod === "department_wise" && !selectedDepartmentIds.length) {
    throw new ApiError(422, "Select at least one department for department-wise assignment");
  }

  if (assignmentMethod === "batch_wise" && !selectedBatchIds.length) {
    throw new ApiError(422, "Select at least one batch for batch-wise assignment");
  }

  const [familyTests, admins] = await Promise.all([
    db.test.findMany({
      where: {
        collegeId: { in: targetCollegeIds },
        OR: [{ id: rootSourceId }, { sourceTestId: rootSourceId }],
      },
      select: { id: true, collegeId: true },
    }),
    db.admin.findMany({
      where: {
        collegeId: { in: targetCollegeIds },
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, collegeId: true },
    }),
  ]);

  const familyTestByCollege = new Map();
  familyTests.forEach((item) => {
    if (!familyTestByCollege.has(item.collegeId)) {
      familyTestByCollege.set(item.collegeId, item);
    }
  });

  // The test actually being edited must be the target for its OWN college — never
  // a sibling clone or the source test that merely shares this college. Without
  // this, editing a draft clone would resolve to the source/original test (which
  // may be completed) and overwrite ITS questions and scope, corrupting the
  // original while leaving the clone unchanged.
  familyTestByCollege.set(existing.collegeId, { id: existing.id, collegeId: existing.collegeId });

  const adminByCollege = new Map();
  admins.forEach((item) => {
    if (!adminByCollege.has(item.collegeId)) {
      adminByCollege.set(item.collegeId, item.id);
    }
  });

  const normalizedQuestions = Array.isArray(payload.questions) ? payload.questions : [];
  if (!normalizedQuestions.length) {
    throw new ApiError(422, "At least one question is required");
  }

  const scopeByCollege = new Map();
  const skippedColleges = [];

  for (const collegeId of targetCollegeIds) {
    if (assignmentMethod === "department_wise") {
      const scopedDepartments = await db.department.findMany({
        where: {
          id: { in: selectedDepartmentIds },
          collegeId,
        },
        select: { id: true },
      });

      const scopedDepartmentIds = scopedDepartments.map((item) => item.id);
      if (!scopedDepartmentIds.length) {
        skippedColleges.push({ collegeId, reason: "NO_MATCHING_DEPARTMENTS" });
        continue;
      }

      const batches = await db.batch.findMany({
        where: {
          collegeId,
          departmentId: { in: scopedDepartmentIds },
        },
        select: {
          id: true,
        },
      });

      const resolvedBatchIds = batches.map((item) => item.id);
      scopeByCollege.set(collegeId, {
        batchIds: resolvedBatchIds,
        departmentId: scopedDepartmentIds.length === 1 ? scopedDepartmentIds[0] : null,
        assignedTo: scopedDepartmentIds,
      });
      continue;
    }

    const batches = await db.batch.findMany({
      where: {
        id: { in: selectedBatchIds },
        collegeId,
      },
      select: { id: true, departmentId: true },
    });

    const resolvedBatchIds = batches.map((item) => item.id);
    if (!resolvedBatchIds.length) {
      skippedColleges.push({ collegeId, reason: "NO_MATCHING_BATCHES" });
      continue;
    }

    scopeByCollege.set(collegeId, {
      batchIds: resolvedBatchIds,
      departmentId: null,
      assignedTo: [],
    });
  }

  if (!scopeByCollege.has(existing.collegeId)) {
    throw new ApiError(
      422,
      "Selected assignment scope does not include the current test college",
      {
        collegeId: existing.collegeId,
        assignmentMethod,
        selectedDepartmentIds,
        selectedBatchIds,
        skippedColleges,
      },
      "CURRENT_COLLEGE_SCOPE_MISSING"
    );
  }

  let primaryUpdated = null;
  const updatedCollegeIds = [];
  const createdCollegeIds = [];

  await db.$transaction(async (tx) => {
    for (const [collegeId, resolvedScope] of scopeByCollege.entries()) {
      let targetTest = familyTestByCollege.get(collegeId);

      if (targetTest) {
        targetTest = await tx.test.update({
          where: { id: targetTest.id },
          data: {
            title: payload.title,
            subject: payload.subject,
            description: payload.description || null,
            durationMins: payload.durationMins,
            totalMarks: payload.totalMarks,
            attemptsAllowed: payload.attemptsAllowed,
            evaluationRule: payload.evaluationRule,
            negativeMarkingEnabled: Boolean(payload.negativeMarkingEnabled),
            negativeMarks: Number(payload.negativeMarks || 0),
            shuffleQuestions: Boolean(payload.shuffleQuestions),
            shuffleAnswers: Boolean(payload.shuffleAnswers),
            assignmentMethod,
            years,
            assignedTo: resolvedScope.assignedTo || [],
            startsAt,
            endsAt,
            status: publicationFields.status,
            isPublished: publicationFields.isPublished,
            departmentId: assignmentMethod === "department_wise" ? resolvedScope.departmentId : null,
            batchId: resolvedScope.batchIds[0] || null,
            durationMins: isModuleAssessment ? moduleDurationMins : payload.durationMins,
            assessmentFormat: effectiveAssessmentFormat,
            modules: isModuleAssessment ? resolvedModules : [],
            ...resolvedTestConfiguration.persistenceFields,
          },
        });
        updatedCollegeIds.push(collegeId);
      } else {
        const adminId = adminByCollege.get(collegeId);
        if (!adminId) {
          skippedColleges.push({ collegeId, reason: "NO_ACTIVE_ADMIN" });
          continue;
        }

        targetTest = await tx.test.create({
          data: {
            title: payload.title,
            subject: payload.subject,
            description: payload.description || null,
            durationMins: payload.durationMins,
            totalMarks: payload.totalMarks,
            attemptsAllowed: payload.attemptsAllowed,
            evaluationRule: payload.evaluationRule,
            negativeMarkingEnabled: Boolean(payload.negativeMarkingEnabled),
            negativeMarks: Number(payload.negativeMarks || 0),
            shuffleQuestions: Boolean(payload.shuffleQuestions),
            shuffleAnswers: Boolean(payload.shuffleAnswers),
            startsAt,
            endsAt,
            isPublished: publicationFields.isPublished,
            status: publicationFields.status,
            isGlobal: true,
            sourceTestId: rootSourceId,
            assignmentMethod,
            years,
            assignedTo: resolvedScope.assignedTo || [],
            collegeId,
            departmentId: assignmentMethod === "department_wise" ? resolvedScope.departmentId : null,
            batchId: resolvedScope.batchIds[0] || null,
            createdByAdminId: adminId,
            durationMins: isModuleAssessment ? moduleDurationMins : payload.durationMins,
            assessmentFormat: effectiveAssessmentFormat,
            modules: isModuleAssessment ? resolvedModules : [],
            ...resolvedTestConfiguration.persistenceFields,
          },
        });
        createdCollegeIds.push(collegeId);
      }

      await tx.testBatch.deleteMany({ where: { testId: targetTest.id } });
      if (resolvedScope.batchIds.length > 0) {
        await tx.testBatch.createMany({
          data: resolvedScope.batchIds.map((batchId) => ({
            testId: targetTest.id,
            batchId,
            collegeId,
          })),
          skipDuplicates: true,
        });
      }

      const questionRows = normalizedQuestions.map((question, index) => buildQuestionData(question, index, targetTest.id, collegeId, isModuleAssessment));
      const duplicateCheck = await detectDuplicatesInTest(collegeId, targetTest.id, questionRows);
      if (!duplicateCheck.valid) {
        const validationSummary = {
          total: normalizedQuestions.length,
          valid: duplicateCheck.summary.valid,
          exactDuplicates: duplicateCheck.summary.exactDuplicates,
          potentialSemanticDuplicates: duplicateCheck.summary.semanticDuplicates,
          optionErrors: duplicateCheck.summary.optionErrors,
        };
        const errorResponse = {
          valid: false,
          duplicate: true,
          message: "Duplicate questions detected in test",
          details: duplicateCheck.results,
          validation: validationSummary,
        };
        throw new ApiError(409, "Duplicate questions detected in test", errorResponse, "DUPLICATE_QUESTIONS_IN_TEST");
      }

      await tx.question.deleteMany({ where: { testId: targetTest.id } });
      await tx.question.createMany({
        data: questionRows,
      });

      if (collegeId === existing.collegeId) {
        primaryUpdated = targetTest;
      }
    }
  });

  if (!primaryUpdated) {
    throw new ApiError(500, "Failed to update primary test record", null, "PRIMARY_UPDATE_FAILED");
  }

  await createAuditLog({
    action: "SUPER_ADMIN_UPDATE_TEST",
    targetType: "TEST",
    targetId: primaryUpdated.id,
    collegeId: primaryUpdated.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: {
      title: primaryUpdated.title,
      subject: primaryUpdated.subject,
      status: primaryUpdated.status,
      assignmentMethod,
      publishState: payload.publishState || null,
      updatedCollegeIds,
      createdCollegeIds,
      skippedColleges,
      questionCount: normalizedQuestions.length,
      testType: resolvedTestConfiguration.testType,
      proctoringPreset: resolvedTestConfiguration.proctoringPreset,
    },
    testId: primaryUpdated.id,
  });

  const hydrated = await db.test.findUnique({
    where: { id: primaryUpdated.id },
    include: {
      college: true,
      department: true,
      questions: {
        orderBy: { order: "asc" },
      },
      batchAssignments: {
        select: {
          batchId: true,
          batch: {
            select: {
              id: true,
              name: true,
              year: true,
              departmentId: true,
              collegeId: true,
            },
          },
        },
      },
      _count: {
        select: {
          questions: true,
          submissions: true,
        },
      },
    },
  });

  res.status(200).json({
    ...attachResolvedTestConfiguration(hydrated),
    propagation: {
      updatedCollegeIds,
      createdCollegeIds,
      skippedColleges,
    },
  });
});

const transitionGlobalTestStatus = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const { action } = req.body;

  const existing = await db.test.findUnique({ where: { id: testId } });
  if (!existing) {
    throw new ApiError(404, "Test not found");
  }

  const currentStatus = deriveLifecycleStatus(existing);
  const nextStatus = resolveTransitionTarget(action);

  if (action === TRANSITION_ACTION.SCHEDULE && existing.startsAt && new Date(existing.startsAt) <= new Date()) {
    throw new ApiError(409, "Scheduled transition requires a future start date", null, "SCHEDULE_REQUIRES_FUTURE_START");
  }

  assertTransition(currentStatus, nextStatus);
  const transitionedAt = new Date();

  const updated = await db.test.update({
    where: { id: testId },
    data: {
      status: nextStatus,
      isPublished: nextStatus !== TEST_STATUS.ARCHIVED,
      startsAt: action === TRANSITION_ACTION.GO_LIVE && existing.startsAt > transitionedAt ? transitionedAt : existing.startsAt,
      endsAt: action === TRANSITION_ACTION.COMPLETE ? transitionedAt : existing.endsAt,
    },
  });
  const completedSubmissions = action === TRANSITION_ACTION.COMPLETE
    ? await db.submission.findMany({
        where: { testId, status: "IN_PROGRESS" },
        select: { id: true },
      })
    : [];

  if (completedSubmissions.length > 0) {
    await Promise.all(
      completedSubmissions.map((submission) =>
        completeSubmission({ submissionId: submission.id, autoSubmitted: true })
      )
    );
  }

  await createAuditLog({
    action: transitionAuditAction(action),
    targetType: "TEST",
    targetId: updated.id,
    collegeId: updated.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      status: currentStatus,
      isPublished: existing.isPublished,
      endsAt: existing.endsAt,
    },
    afterState: {
      status: updated.status,
      isPublished: updated.isPublished,
      endsAt: updated.endsAt,
      autoSubmittedAttempts: completedSubmissions.length,
      transitionAction: action,
    },
    testId: updated.id,
  });

  res.status(200).json(updated);
});

const getLiveMonitoring = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;

  const test = await db.test.findUnique({
    where: { id: testId },
    select: {
      id: true,
      title: true,
      durationMins: true,
      status: true,
      startsAt: true,
      endsAt: true,
      collegeId: true,
      isGlobal: true,
    },
  });

  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  const [inProgress, questionCount, rateLimits] = await Promise.all([
    db.submission.findMany({
      where: { testId, status: "IN_PROGRESS" },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            studentId: true,
            department: { select: { name: true } },
            batch: { select: { name: true } },
          },
        },
        violations: {
          select: { id: true, type: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        _count: {
          select: { answers: true, violations: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.question.count({ where: { testId } }),
    getExamRateLimitMetricsSnapshot({ limit: 5, collegeId: test.collegeId }),
  ]);

  const scopedSubmissionIds = inProgress.map((submission) => submission.id).filter(Boolean);
  const sessions = scopedSubmissionIds.length > 0
    ? await db.testSession.findMany({
        where: { testId, submissionId: { in: scopedSubmissionIds } },
        select: { userId: true, submissionId: true, expiresAt: true, lastHeartbeatAt: true, connectionStatus: true },
      })
    : [];

  const nowMs = Date.now();
  const sessionMap = new Map(sessions.map((item) => [item.submissionId, item]));
  const examStates = await Promise.all(
    inProgress.map(async (submission) => ({
      submissionId: submission.id,
      state: await getExamState({ userId: submission.userId, testId }),
    }))
  );
  const examStateMap = new Map(examStates.map((item) => [item.submissionId, item.state]));
  const studentTable = inProgress.map((submission) => {
    const answered = Number(submission?._count?.answers || 0);
    const state = examStateMap.get(submission.id);
    const progress = questionCount > 0 ? Math.min(100, Math.round((answered / questionCount) * 100)) : 0;
    const session = sessionMap.get(submission.id);
    const baselineExpiry = submission.startedAt
      ? new Date(new Date(submission.startedAt).getTime() + Number(test.durationMins || 0) * 60 * 1000)
      : new Date(nowMs);
    const expiresAt = session?.expiresAt || baselineExpiry;
    const timeLeftSec = Math.max(0, Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000));
    const heartbeatCandidates = [
      state?.lastHeartbeatAt,
      session?.lastHeartbeatAt,
      submission.lastHeartbeat,
      submission.lastAutoSavedAt,
      submission.updatedAt,
    ]
      .map((value) => new Date(value || 0).getTime())
      .filter((value) => Number.isFinite(value) && value > 0);
    const lastHeartbeat = heartbeatCandidates.length ? Math.max(...heartbeatCandidates) : 0;
    const idleSeconds = lastHeartbeat > 0 ? Math.max(0, Math.floor((nowMs - lastHeartbeat) / 1000)) : Number.POSITIVE_INFINITY;
    const connectionStatus = idleSeconds <= 45 ? "ONLINE" : idleSeconds <= 120 ? "UNSTABLE" : "OFFLINE";
    const cachedViolations = Number(state?.violationCount);
    const persistedViolations = Number(submission?._count?.violations || 0);

    return {
      submissionId: submission.id,
      studentId: submission.userId,
      name: submission.user?.fullName || "Student",
      department: submission.user?.department?.name || "-",
      batch: submission.user?.batch?.name || "-",
      progress,
      timeLeftSec,
      violations: Number.isFinite(cachedViolations) ? Math.max(cachedViolations, persistedViolations) : persistedViolations,
      connectionStatus,
      lastHeartbeatAt: lastHeartbeat > 0 ? new Date(lastHeartbeat).toISOString() : null,
      idleSeconds: Number.isFinite(idleSeconds) ? idleSeconds : null,
      status: submission.status,
      startedAt: submission.startedAt,
    };
  });

  const violationFeed = inProgress.flatMap((submission) =>
    (submission.violations || []).map((violation) => ({
      id: violation.id,
      submissionId: submission.id,
      studentId: submission.userId,
      studentName: submission.user?.fullName || "Student",
      type: violation.type,
      at: violation.createdAt,
    }))
  ).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 100);

  res.status(200).json({
    test: {
      ...test,
      activeStudents: studentTable.length,
      questionCount,
      canAdminControl: true,
      canAdminOperate: true,
    },
    canAdminControl: true,
    canAdminOperate: true,
    rateLimits,
    studentTable,
    violationFeed,
    generatedAt: new Date().toISOString(),
  });
});

const forceSubmitAttempt = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const { submissionId, reason } = req.body;

  const submission = await db.submission.findFirst({
    where: { id: submissionId, testId },
    include: {
      user: { select: { fullName: true, departmentId: true } },
      test: { select: { id: true, collegeId: true } },
    },
  });

  if (!submission) {
    throw new ApiError(404, "Submission not found");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Submission is already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  const completed = await completeSubmission({ submissionId, autoSubmitted: true });

  await createAuditLog({
    action: "SUPER_ADMIN_FORCE_SUBMIT",
    targetType: "SUBMISSION",
    targetId: submissionId,
    collegeId: submission.test?.collegeId || null,
    superAdminId: req.superAdmin.id,
    testId,
    afterState: {
      reason,
      studentId: submission.userId,
      status: completed.status,
    },
  });

  const payload = {
    testId,
    submissionId,
    studentId: submission.userId,
    studentName: submission.user?.fullName || "Student",
    action: "FORCE_SUBMIT",
    reason,
  };

  emitToTestRoom(testId, "test_status_change", payload);
  emitToCollege(submission.test?.collegeId, "test_status_change", payload, { departmentId: submission.user?.departmentId || null });

  res.status(200).json({ message: "Submission force-submitted", submission: completed });
});

const extendAttemptTime = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const { submissionId, minutes } = req.body;

  const submission = await db.submission.findFirst({
    where: { id: submissionId, testId },
    include: {
      user: { select: { fullName: true, departmentId: true } },
      test: { select: { id: true, collegeId: true } },
    },
  });

  if (!submission) {
    throw new ApiError(404, "Submission not found");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Only in-progress attempts can be extended", null, "SUBMISSION_NOT_ACTIVE");
  }

  const session = await db.testSession.findFirst({ where: { testId, submissionId, userId: submission.userId } });
  if (!session) {
    throw new ApiError(404, "Active test session not found", null, "SESSION_NOT_FOUND");
  }

  const mins = Math.max(1, Number(minutes || 0));
  const nextExpiry = new Date(new Date(session.expiresAt).getTime() + mins * 60 * 1000);
  const updated = await db.testSession.update({
    where: { userId_testId: { userId: submission.userId, testId } },
    data: { expiresAt: nextExpiry },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_EXTEND_TIME",
    targetType: "SUBMISSION",
    targetId: submissionId,
    collegeId: submission.test?.collegeId || null,
    superAdminId: req.superAdmin.id,
    testId,
    afterState: {
      minutesAdded: mins,
      expiresAt: updated.expiresAt,
      studentId: submission.userId,
    },
  });

  const payload = {
    testId,
    submissionId,
    studentId: submission.userId,
    studentName: submission.user?.fullName || "Student",
    action: "TIME_EXTENDED",
    minutesAdded: mins,
    expiresAt: updated.expiresAt,
    timeLeftSec: Math.max(0, Math.floor((new Date(updated.expiresAt).getTime() - Date.now()) / 1000)),
  };

  emitToTestRoom(testId, "student_status_update", payload);
  emitToCollege(submission.test?.collegeId, "student_status_update", payload, { departmentId: submission.user?.departmentId || null });

  res.status(200).json({ message: "Time extended", session: updated });
});

const deactivateTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const existing = await db.test.findUnique({ where: { id: testId } });

  if (!existing) {
    throw new ApiError(404, "Test not found");
  }

  const currentStatus = deriveLifecycleStatus(existing);
  const submissionCount = await db.submission.count({ where: { testId } });
  if (currentStatus !== TEST_STATUS.DRAFT || submissionCount > 0) {
    throw new ApiError(
      409,
      "Only draft tests with zero submissions can be deleted. Archive this test instead.",
      { testId, currentStatus, submissionCount, suggestedAction: TRANSITION_ACTION.ARCHIVE },
      "TEST_DELETE_BLOCKED"
    );
  }

  await db.$transaction(async (tx) => {
    const submissions = await tx.submission.findMany({
      where: { testId },
      select: { id: true },
    });
    const submissionIds = submissions.map((item) => item.id);

    await tx.testSession.deleteMany({ where: { testId } });
    if (submissionIds.length > 0) {
      await tx.answer.deleteMany({ where: { submissionId: { in: submissionIds } } });
      await tx.violation.deleteMany({ where: { submissionId: { in: submissionIds } } });
    }
    await tx.submission.deleteMany({ where: { testId } });
    await tx.question.deleteMany({ where: { testId } });
    await tx.testBatch.deleteMany({ where: { testId } });
    await tx.test.delete({ where: { id: testId } });
  });

  await createAuditLog({
    action: "SUPER_ADMIN_DELETE_TEST",
    targetType: "TEST",
    targetId: existing.id,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: { deleted: true },
    testId: existing.id,
  });

  res.status(200).json({ message: "Test deleted", id: existing.id });
});

const buildStudentTestLink = (testId) => {
  const baseUrl = String(env.frontendOrigin || "").replace(/\/+$/, "");
  return `${baseUrl || "http://localhost:5173"}/tests/${encodeURIComponent(testId)}/instructions`;
};

const getGlobalTestShareLink = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;

  const test = await db.test.findUnique({
    where: { id: testId },
    include: {
      _count: { select: { questions: true, submissions: true } },
    },
  });

  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  res.status(200).json({
    testId: test.id,
    title: test.title,
    status: deriveLifecycleStatus(test),
    isPublished: Boolean(test.isPublished),
    startsAt: test.startsAt,
    endsAt: test.endsAt,
    questionCount: Number(test?._count?.questions || 0),
    submissionCount: Number(test?._count?.submissions || 0),
    shareLink: buildStudentTestLink(test.id),
  });
});

module.exports = {
  getTestsGlobal,
  getGlobalTestById,
  createGlobalTest,
  cloneTestToCollege,
  updateGlobalTest,
  transitionGlobalTestStatus,
  getLiveMonitoring,
  forceSubmitAttempt,
  extendAttemptTime,
  deactivateTest,
  getGlobalTestShareLink,
};
