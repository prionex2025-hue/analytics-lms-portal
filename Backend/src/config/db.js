const mongoose = require("mongoose");
const env = require("./env");
const { SYSTEM_DEFAULT_TEST_SETTINGS } = require("../services/test-config.service");

const uri = env.mongoUri;
if (!uri) {
  throw new Error("MONGODB_URI is required");
}

let db;
let connectPromise = null;

const MODEL_TO_COLLECTION = {
  college: "college",
  superAdmin: "superAdmin",
  superAdminRefreshToken: "superAdminRefreshToken",
  passwordResetToken: "passwordResetToken",
  department: "department",
  batch: "batch",
  admin: "admin",
  user: "user",
  student: "student",
  test: "test",
  question: "question",
  questionBank: "questionBank",
  subject: "subject",
  resource: "resource",
  resourceView: "resourceView",
  resourceDownload: "resourceDownload",
  cloneMapping: "cloneMapping",
  submission: "submission",
  answer: "answer",
  violation: "violation",
  event: "event",
  studentRefreshToken: "studentRefreshToken",
  adminRefreshToken: "adminRefreshToken",
  testSession: "testSession",
  testInstructionAgreement: "testInstructionAgreement",
  testBatch: "testBatch",
  studentPassoutCohort: "studentPassoutCohort",
  studentStatusEvent: "studentStatusEvent",
  reportJob: "reportJob",
  superReportJob: "superReportJob",
  platformSetting: "platformSetting",
  auditLog: "auditLog",
};

const RELATIONS = {
  college: {
    departments: { model: "department", type: "many", sourceField: "id", targetField: "collegeId" },
    admins: { model: "admin", type: "many", sourceField: "id", targetField: "collegeId" },
    students: { model: "student", type: "many", sourceField: "id", targetField: "collegeId" },
    passoutCohorts: { model: "studentPassoutCohort", type: "many", sourceField: "id", targetField: "collegeId" },
    studentStatusEvents: { model: "studentStatusEvent", type: "many", sourceField: "id", targetField: "collegeId" },
    reportJobs: { model: "reportJob", type: "many", sourceField: "id", targetField: "collegeId" },
    auditLogs: { model: "auditLog", type: "many", sourceField: "id", targetField: "collegeId" },
    events: { model: "event", type: "many", sourceField: "id", targetField: "collegeId" },
    tests: { model: "test", type: "many", sourceField: "id", targetField: "collegeId" },
    submissions: { model: "submission", type: "many", sourceField: "id", targetField: "collegeId" },
    questionBankItems: { model: "questionBank", type: "many", sourceField: "id", targetField: "collegeId" },
    subjects: { model: "subject", type: "many", sourceField: "id", targetField: "collegeId" },
    resources: { model: "resource", type: "many", sourceField: "id", targetField: "collegeId" },
    batches: { model: "batch", type: "many", sourceField: "id", targetField: "collegeId" },
  },
  superAdmin: {
    refreshTokens: { model: "superAdminRefreshToken", type: "many", sourceField: "id", targetField: "superAdminId" },
    reportJobs: { model: "superReportJob", type: "many", sourceField: "id", targetField: "initiatedById" },
    auditLogs: { model: "auditLog", type: "many", sourceField: "id", targetField: "superAdminId" },
    settings: { model: "platformSetting", type: "many", sourceField: "id", targetField: "updatedById" },
    questionBankItems: { model: "questionBank", type: "many", sourceField: "id", targetField: "createdBySuperAdminId" },
    createdSubjects: { model: "subject", type: "many", sourceField: "id", targetField: "createdBySuperAdminId" },
  },
  superAdminRefreshToken: {
    superAdmin: { model: "superAdmin", type: "one", sourceField: "superAdminId", targetField: "id" },
  },
  passwordResetToken: {},
  department: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    batches: { model: "batch", type: "many", sourceField: "id", targetField: "departmentId" },
    admins: { model: "admin", type: "many", sourceField: "id", targetField: "departmentId" },
    students: { model: "student", type: "many", sourceField: "id", targetField: "departmentId" },
    tests: { model: "test", type: "many", sourceField: "id", targetField: "departmentId" },
  },
  batch: {
    department: { model: "department", type: "one", sourceField: "departmentId", targetField: "id" },
    departments: { model: "department", type: "many", sourceField: "departmentIds", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    students: { model: "student", type: "many", sourceField: "id", targetField: "batchIds" },
    tests: { model: "test", type: "many", sourceField: "id", targetField: "batchId" },
    testAssignments: { model: "testBatch", type: "many", sourceField: "id", targetField: "batchId" },
  },
  admin: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    department: { model: "department", type: "one", sourceField: "departmentId", targetField: "id" },
    createdTests: { model: "test", type: "many", sourceField: "id", targetField: "createdByAdminId" },
    questionBankItems: { model: "questionBank", type: "many", sourceField: "id", targetField: "createdByAdminId" },
    createdSubjects: { model: "subject", type: "many", sourceField: "id", targetField: "createdByAdminId" },
    events: { model: "event", type: "many", sourceField: "id", targetField: "createdByAdminId" },
    refreshTokens: { model: "adminRefreshToken", type: "many", sourceField: "id", targetField: "adminId" },
    reportJobs: { model: "reportJob", type: "many", sourceField: "id", targetField: "adminId" },
    auditLogs: { model: "auditLog", type: "many", sourceField: "id", targetField: "adminId" },
  },
  student: {
    batches: { model: "batch", type: "many", sourceField: "batchIds", targetField: "id" },
    department: { model: "department", type: "one", sourceField: "departmentId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    submissions: { model: "submission", type: "many", sourceField: "id", targetField: "userId" },
    passoutCohort: { model: "studentPassoutCohort", type: "one", sourceField: "passoutCohortId", targetField: "id" },
    refreshTokens: { model: "studentRefreshToken", type: "many", sourceField: "id", targetField: "userId" },
    testSessions: { model: "testSession", type: "many", sourceField: "id", targetField: "userId" },
  },
  test: {
    createdByAdmin: { model: "admin", type: "one", sourceField: "createdByAdminId", targetField: "id" },
    batch: { model: "batch", type: "one", sourceField: "batchId", targetField: "id" },
    department: { model: "department", type: "one", sourceField: "departmentId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    batchAssignments: { model: "testBatch", type: "many", sourceField: "id", targetField: "testId" },
    questions: { model: "question", type: "many", sourceField: "id", targetField: "testId" },
    submissions: { model: "submission", type: "many", sourceField: "id", targetField: "testId" },
    testSessions: { model: "testSession", type: "many", sourceField: "id", targetField: "testId" },
    auditLogs: { model: "auditLog", type: "many", sourceField: "id", targetField: "testId" },
  },
  question: {
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
    answers: { model: "answer", type: "many", sourceField: "id", targetField: "questionId" },
  },
  questionBank: {
    createdByAdmin: { model: "admin", type: "one", sourceField: "createdByAdminId", targetField: "id" },
    createdBySuperAdmin: { model: "superAdmin", type: "one", sourceField: "createdBySuperAdminId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    subjectRef: { model: "subject", type: "one", sourceField: "subjectId", targetField: "id" },
  },
  subject: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    createdByAdmin: { model: "admin", type: "one", sourceField: "createdByAdminId", targetField: "id" },
    createdBySuperAdmin: { model: "superAdmin", type: "one", sourceField: "createdBySuperAdminId", targetField: "id" },
    resources: { model: "resource", type: "many", sourceField: "id", targetField: "subjectId" },
  },
  resource: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    subjectRef: { model: "subject", type: "one", sourceField: "subjectId", targetField: "id" },
    views: { model: "resourceView", type: "many", sourceField: "id", targetField: "resourceId" },
    downloads: { model: "resourceDownload", type: "many", sourceField: "id", targetField: "resourceId" },
  },
  resourceView: {
    resource: { model: "resource", type: "one", sourceField: "resourceId", targetField: "id" },
    user: { model: "student", type: "one", sourceField: "userId", targetField: "id" },
  },
  resourceDownload: {
    resource: { model: "resource", type: "one", sourceField: "resourceId", targetField: "id" },
    user: { model: "student", type: "one", sourceField: "userId", targetField: "id" },
  },
  submission: {
    user: { model: "student", type: "one", sourceField: "userId", targetField: "id" },
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    passoutCohort: { model: "studentPassoutCohort", type: "one", sourceField: "passoutCohortId", targetField: "id" },
    answers: { model: "answer", type: "many", sourceField: "id", targetField: "submissionId" },
    violations: { model: "violation", type: "many", sourceField: "id", targetField: "submissionId" },
  },
  answer: {
    submission: { model: "submission", type: "one", sourceField: "submissionId", targetField: "id" },
    question: { model: "question", type: "one", sourceField: "questionId", targetField: "id" },
  },
  violation: {
    submission: { model: "submission", type: "one", sourceField: "submissionId", targetField: "id" },
  },
  event: {
    createdByAdmin: { model: "admin", type: "one", sourceField: "createdByAdminId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
  },
  studentRefreshToken: {
    user: { model: "student", type: "one", sourceField: "userId", targetField: "id" },
  },
  adminRefreshToken: {
    admin: { model: "admin", type: "one", sourceField: "adminId", targetField: "id" },
  },
  testSession: {
    user: { model: "student", type: "one", sourceField: "userId", targetField: "id" },
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
  },
  testInstructionAgreement: {
    user: { model: "student", type: "one", sourceField: "userId", targetField: "id" },
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
  },
  testBatch: {
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
    batch: { model: "batch", type: "one", sourceField: "batchId", targetField: "id" },
  },
  studentPassoutCohort: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    students: { model: "student", type: "many", sourceField: "id", targetField: "passoutCohortId" },
    submissions: { model: "submission", type: "many", sourceField: "id", targetField: "passoutCohortId" },
  },
  studentStatusEvent: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    changedByAdmin: { model: "admin", type: "one", sourceField: "changedByAdminId", targetField: "id" },
    changedBySuperAdmin: { model: "superAdmin", type: "one", sourceField: "changedBySuperAdminId", targetField: "id" },
  },
  reportJob: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    admin: { model: "admin", type: "one", sourceField: "adminId", targetField: "id" },
  },
  superReportJob: {
    initiatedBy: { model: "superAdmin", type: "one", sourceField: "initiatedById", targetField: "id" },
  },
  platformSetting: {
    updatedBy: { model: "superAdmin", type: "one", sourceField: "updatedById", targetField: "id" },
  },
  auditLog: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    admin: { model: "admin", type: "one", sourceField: "adminId", targetField: "id" },
    superAdmin: { model: "superAdmin", type: "one", sourceField: "superAdminId", targetField: "id" },
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
  },
};

const DEFAULTS = {
  college: { isActive: true },
  superAdmin: { role: "SUPER_ADMIN", isActive: true },
  department: {},
  batch: { status: "ACTIVE", isArchived: false, isActive: true },
  admin: { role: "ADMIN", isActive: true },
  student: {
    role: "STUDENT",
    isActive: true,
    lifecycleStatus: "ACTIVE",
    disabledReason: null,
    disabledAt: null,
    passoutYear: null,
    passoutCohortId: null,
  },
  test: {
    status: "DRAFT",
    attemptsAllowed: 1,
    evaluationRule: "BEST_ATTEMPT",
    negativeMarkingEnabled: false,
    negativeMarks: 0,
    shuffleQuestions: false,
    shuffleAnswers: false,
    isPublished: false,
    testType: SYSTEM_DEFAULT_TEST_SETTINGS.testType,
    proctoringPreset: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringPreset,
    proctoringEnabled: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.enabled,
    restrictTabSwitch: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.tabSwitch === "monitored",
    restrictCopyPaste: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.copyPaste === "monitored",
    restrictRightClick: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.rightClickDisabled,
    requireFullscreen: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.fullscreenRequired,
    violationLimit: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.violationThreshold,
    monitorWindowBlur: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.windowBlur,
    detectScreenshot: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.screenshotDetection,
    detectDevtools: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.devtoolsDetection,
    autoNextSingle: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.autoNextSingle,
    paragraphWordLimit: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.paragraphWordLimit,
    proctoringConfig: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig,
    isGlobal: false,
    assignedTo: [],
    instructions: null,
    assessmentFormat: "OPEN_TEST",
    modules: [],
  },
  question: { options: [], marks: 1, category: null },
  questionBank: { options: [], marks: 1, difficulty: "MEDIUM", category: null },
  subject: {},
  resource: {
    departmentIds: [],
    batchIds: [],
    studentIds: [],
    downloadCount: 0,
    viewCount: 0,
    tags: [],
    isActive: true,
  },
  resourceView: { viewedAt: () => new Date(), batchIds: [] },
  resourceDownload: { downloadedAt: () => new Date(), batchIds: [] },
  submission: {
    attemptNumber: 1,
    score: 0,
    accuracy: 0,
    status: "IN_PROGRESS",
    startedAt: () => new Date(),
    timeSpentSeconds: 0,
    violationCount: 0,
    agreedToInstructions: false,
    agreedAt: null,
  },
  answer: { markedForReview: false },
  event: { isGlobal: false },
  studentRefreshToken: {},
  adminRefreshToken: {},
  superAdminRefreshToken: {},
  passwordResetToken: {},
  testSession: { startedAt: () => new Date() },
  testInstructionAgreement: { agreedAt: () => new Date() },
  testBatch: {},
  studentPassoutCohort: { status: "PROCESSING", studentIds: [], departmentStats: [], batchStats: [] },
  studentStatusEvent: {},
  violation: { metadata: null },
  reportJob: { status: "QUEUED" },
  superReportJob: { status: "QUEUED" },
  platformSetting: {},
  auditLog: {},
};

const OBJECT_ID_FIELDS = new Set([
  "_id",
  "id",
  "collegeId",
  "departmentId",
  "departmentIds",
  "headId",
  "batchId",
  "batchIds",
  "assignedTo",
  "createdByAdminId",
  "createdBySuperAdminId",
  "subjectId",
  "resourceId",
  "uploadedBy",
  "studentIds",
  "sourceTestId",
  "clonedTestId",
  "targetCollegeId",
  "targetDepartmentId",
  "userId",
  "testId",
  "questionId",
  "submissionId",
  "adminId",
  "superAdminId",
  "principalId",
  "initiatedById",
  "updatedById",
  "promotedById",
  "passoutCohortId",
  "changedByAdminId",
  "changedBySuperAdminId",
  "archivedByAdminId",
  "archivedBySuperAdminId",
]);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof mongoose.Types.ObjectId);

const isObjectIdString = (value) => typeof value === "string" && mongoose.Types.ObjectId.isValid(value.trim());

const toObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (isObjectIdString(value)) {
    return new mongoose.Types.ObjectId(String(value).trim());
  }

  return value;
};

const isObjectIdField = (field) => OBJECT_ID_FIELDS.has(field);

const normalizeStoredValue = (field, value) => {
  if (value === null || typeof value === "undefined") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeStoredValue(field, item));
  }

  if (isPlainObject(value)) {
    const out = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      out[key] = normalizeStoredValue(key, nestedValue);
    }
    return out;
  }

  if (isObjectIdField(field)) {
    const normalized = toObjectId(value);
    if (normalized instanceof mongoose.Types.ObjectId) {
      return normalized;
    }
  }

  return value;
};

const normalizeDocumentForWrite = (input) => {
  if (!isPlainObject(input)) {
    return input;
  }

  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "id") {
      const normalizedId = toObjectId(value);
      if (normalizedId instanceof mongoose.Types.ObjectId) {
        out._id = normalizedId;
      }
      continue;
    }

    out[key] = normalizeStoredValue(key, value);
  }

  return out;
};

const serializeValueForApi = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValueForApi(item));
  }

  if (isPlainObject(value)) {
    const out = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === "_id") {
        out.id = serializeValueForApi(nestedValue);
        continue;
      }

      out[key] = serializeValueForApi(nestedValue);
    }

    if (!Object.prototype.hasOwnProperty.call(out, "id") && Object.prototype.hasOwnProperty.call(value, "id")) {
      out.id = serializeValueForApi(value.id);
    }

    return out;
  }

  return value;
};

const normalizeLookupValue = (field, value) => normalizeStoredValue(field, value);
const toDocumentFieldName = (field) => (field === "id" ? "_id" : field);

const buildRelationLookupFilter = (relation, doc) => {
  const lookupValue = normalizeLookupValue(relation.sourceField, doc[relation.sourceField]);
  const targetField = toDocumentFieldName(relation.targetField);

  if (Array.isArray(lookupValue)) {
    return { [targetField]: { $in: lookupValue } };
  }

  return { [targetField]: lookupValue };
};

// --- Unique compound key definitions for models that use compound findUnique ---
const COMPOUND_UNIQUE_KEYS = {
  testSession: { userId_testId: ["userId", "testId"] },
  testInstructionAgreement: { userId_testId: ["userId", "testId"] },
  answer: { submissionId_questionId: ["submissionId", "questionId"] },
};

function materializeDefaults(modelName) {
  const source = DEFAULTS[modelName] || {};
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    out[k] = typeof v === "function" ? v() : v;
  }
  return out;
}

// Log driver connection transitions once per transition (the driver
// reconnects automatically; requests made while it is down fail fast with a
// 503 after serverSelectionTimeoutMS).
let connectionLoggingAttached = false;
let intentionalDisconnect = false;
function attachConnectionLogging() {
  if (connectionLoggingAttached) return;
  connectionLoggingAttached = true;
  const { logger } = require("../utils/logger");
  const conn = mongoose.connection;
  conn.on("disconnected", () => {
    // Deliberate disconnects (graceful shutdown, scripts) are not incidents.
    if (require("../utils/lifecycle").isShuttingDown() || intentionalDisconnect) return;
    logger.error("mongodb.disconnected", { impact: "API requests return 503 until reconnected" });
  });
  conn.on("reconnected", () => logger.info("mongodb.reconnected"));
  conn.on("error", (error) => logger.error("mongodb.connection_error", { reason: error?.message, code: error?.code }));
}

async function ensureConnected() {
  const activeDb = mongoose.connection?.db || null;

  // Reuse an existing healthy connection.
  if (mongoose.connection.readyState === 1 && activeDb) {
    db = activeDb;
    return db;
  }

  // Avoid spawning parallel connect attempts under load.
  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    try {
      if (mongoose.connection.readyState === 2) {
        await new Promise((resolve, reject) => {
          mongoose.connection.once("connected", resolve);
          mongoose.connection.once("error", reject);
        });
      } else {
        attachConnectionLogging();
        await mongoose.connect(uri, {
          dbName: env.mongoDbName || undefined,
          maxPoolSize: env.database.maxPoolSize,
          minPoolSize: Math.min(env.database.minPoolSize, env.database.maxPoolSize),
          serverSelectionTimeoutMS: env.database.serverSelectionTimeoutMs,
          retryWrites: true,
        });
      }

      const resolvedDb = mongoose.connection?.db || null;
      if (!resolvedDb) {
        throw new Error("MongoDB connected but database handle is unavailable");
      }

      db = resolvedDb;
      return db;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

function getCollection(modelName) {
  const collectionName = MODEL_TO_COLLECTION[modelName] || modelName;
  const activeDb = db || mongoose.connection?.db;
  if (!activeDb) {
    throw new Error(`MongoDB is not connected. Unable to access collection ${collectionName}`);
  }
  return activeDb.collection(collectionName);
}

// ---------------------------------------------------------------------------
// Convert ORM-style where clauses to a native MongoDB filter.
//
// This handles:
//   - scalar equality:   { field: value }
//   - operators:         { field: { in: [...], contains: "...", gt/gte/lt/lte, not, equals, mode } }
//   - logical:           { OR: [...], AND: [...], NOT: [...] }
//   - nested compound keys that controllers pass as { userId_testId: { userId, testId } }
//   - relation filters:  { batchAssignments: { some: { batchId: "..." } } }
// ---------------------------------------------------------------------------

function normalizeCompoundWhere(modelName, where) {
  if (!where || typeof where !== "object" || Array.isArray(where)) {
    return where;
  }

  const compounds = COMPOUND_UNIQUE_KEYS[modelName] || {};
  const out = {};

  for (const [key, value] of Object.entries(where)) {
    if (compounds[key] && value && typeof value === "object" && !Array.isArray(value)) {
      // Expand compound key: { userId_testId: { userId, testId } } → { userId, testId }
      Object.assign(out, value);
      continue;
    }

    // Also handle the legacy inline-relation flattening where key contains "_" and
    // value is a plain object that is NOT an operator.
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      key.includes("_") &&
      !isOperatorObject(value) &&
      !["OR", "AND", "NOT"].includes(key)
    ) {
      Object.assign(out, value);
      continue;
    }

    out[key] = value;
  }

  return out;
}

function isOperatorObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.some((k) => ["in", "contains", "mode", "gt", "gte", "lt", "lte", "not", "equals"].includes(k));
}

// Defense-in-depth against NoSQL operator injection. The ORM `where` contract
// never uses raw Mongo operators ($in/$ne/$gt/$regex/$where/...) — those are
// constructed internally by toMongoFilter from ORM words (in/not/gt/...) and
// OR/AND/NOT. So any $-prefixed key in an incoming `where` can only come from
// untrusted input that reached a query un-coerced (e.g. a JSON body or a
// `?field[$ne]=` query param). Strip them here so a value like { "$ne": null }
// degrades to an (empty) equality match instead of a live operator, closing the
// class even on a route that forgot to validate. Legitimate values (scalars,
// Dates, ObjectIds, arrays, nested plain objects) pass through unchanged.
function stripDollarKeys(value) {
  if (Array.isArray(value)) {
    return value.map(stripDollarKeys);
  }
  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !(value instanceof mongoose.Types.ObjectId)
  ) {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (typeof key === "string" && key.startsWith("$")) {
        continue;
      }
      out[key] = stripDollarKeys(nested);
    }
    return out;
  }
  return value;
}

function toMongoFilter(modelName, where) {
  if (!where || typeof where !== "object") {
    return {};
  }

  const normalized = normalizeCompoundWhere(modelName, stripDollarKeys(where));
  const filter = {};

  for (const [key, value] of Object.entries(normalized)) {
    const dbField = toDocumentFieldName(key);

    if (key === "OR") {
      const conditions = Array.isArray(value) ? value : [];
      if (conditions.length > 0) {
        filter.$or = conditions.map((c) => toMongoFilter(modelName, c));
      }
      continue;
    }

    if (key === "AND") {
      const conditions = Array.isArray(value) ? value : [];
      if (conditions.length > 0) {
        filter.$and = conditions.map((c) => toMongoFilter(modelName, c));
      }
      continue;
    }

    if (key === "NOT") {
      const conditions = Array.isArray(value) ? value : [value];
      for (const condition of conditions) {
        const sub = toMongoFilter(modelName, condition);
        for (const [sk, sv] of Object.entries(sub)) {
          filter[sk] = { $not: sv && typeof sv === "object" ? sv : { $eq: sv } };
        }
      }
      continue;
    }

    // Check if this key refers to a relation (for some/none/every filters)
    const relation = RELATIONS[modelName] && RELATIONS[modelName][key];
    if (relation && value && typeof value === "object" && !Array.isArray(value)) {
      // Relation filters like { batchAssignments: { some: { batchId: "..." } } }
      // These need to be resolved at query time via separate queries
      // We mark them for post-processing by the caller
      filter[`__rel__${key}`] = value;
      continue;
    }

    if (value === null || value === undefined) {
      filter[dbField] = null;
      continue;
    }

    if (typeof value !== "object" || value instanceof Date) {
      filter[dbField] = normalizeStoredValue(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      filter[dbField] = normalizeStoredValue(key, value);
      continue;
    }

    // Operator object
    if (isOperatorObject(value)) {
      const mongoCondition = {};

      if (Object.prototype.hasOwnProperty.call(value, "equals")) {
        filter[dbField] = normalizeStoredValue(key, value.equals);
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(value, "in")) {
        mongoCondition.$in = normalizeStoredValue(key, value.in);
      }

      if (Object.prototype.hasOwnProperty.call(value, "not")) {
        if (value.not && typeof value.not === "object" && value.not.in) {
          mongoCondition.$nin = normalizeStoredValue(key, value.not.in);
        } else {
          mongoCondition.$ne = normalizeStoredValue(key, value.not);
        }
      }

      if (Object.prototype.hasOwnProperty.call(value, "contains")) {
        const escapedNeedle = String(value.contains).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const flags = value.mode === "insensitive" ? "i" : "";
        mongoCondition.$regex = escapedNeedle;
        if (flags) {
          mongoCondition.$options = flags;
        }
      }

      if (Object.prototype.hasOwnProperty.call(value, "gt")) {
        mongoCondition.$gt = normalizeStoredValue(key, value.gt);
      }
      if (Object.prototype.hasOwnProperty.call(value, "gte")) {
        mongoCondition.$gte = normalizeStoredValue(key, value.gte);
      }
      if (Object.prototype.hasOwnProperty.call(value, "lt")) {
        mongoCondition.$lt = normalizeStoredValue(key, value.lt);
      }
      if (Object.prototype.hasOwnProperty.call(value, "lte")) {
        mongoCondition.$lte = normalizeStoredValue(key, value.lte);
      }

      filter[dbField] = Object.keys(mongoCondition).length > 0 ? mongoCondition : normalizeStoredValue(key, value);
      continue;
    }

    // Plain object value (likely a simple equality or nested object)
    filter[dbField] = normalizeStoredValue(key, value);
  }

  return filter;
}

/**
 * Extract relation filter keys from the mongo filter (prefixed with __rel__)
 * and return them separately so the caller can resolve them.
 */
function extractRelationFilters(filter) {
  const relations = {};
  const cleanFilter = {};

  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith("__rel__")) {
      relations[key.slice(7)] = value;
    } else {
      cleanFilter[key] = value;
    }
  }

  return { cleanFilter, relations };
}

const hasFilterKeys = (filter) => filter && typeof filter === "object" && Object.keys(filter).length > 0;

const andFilters = (filters) => {
  const present = filters.filter(hasFilterKeys);
  if (present.length === 0) {
    return {};
  }
  if (present.length === 1) {
    return present[0];
  }
  return { $and: present };
};

async function relationSpecToParentFilter(modelName, relationName, filterSpec) {
  const relation = RELATIONS[modelName] && RELATIONS[modelName][relationName];
  if (!relation || !filterSpec || typeof filterSpec !== "object" || Array.isArray(filterSpec)) {
    return {};
  }

  const relCollection = getCollection(relation.model);
  const sourceField = toDocumentFieldName(relation.sourceField);
  const targetField = toDocumentFieldName(relation.targetField);
  const conditions = [];

  const matchingParentValues = async (where) => {
    const subFilter = await resolveRelationFilters(relation.model, toMongoFilter(relation.model, where || {}));
    return relCollection.distinct(targetField, subFilter);
  };

  if (Object.prototype.hasOwnProperty.call(filterSpec, "some")) {
    const parentValues = await matchingParentValues(filterSpec.some);
    conditions.push({ [sourceField]: { $in: normalizeLookupValue(relation.sourceField, parentValues) } });
  }

  if (Object.prototype.hasOwnProperty.call(filterSpec, "none")) {
    const parentValues = await matchingParentValues(filterSpec.none);
    if (parentValues.length > 0) {
      conditions.push({ [sourceField]: { $nin: normalizeLookupValue(relation.sourceField, parentValues) } });
    }
  }

  if (Object.prototype.hasOwnProperty.call(filterSpec, "every")) {
    const matchingFilter = await resolveRelationFilters(relation.model, toMongoFilter(relation.model, filterSpec.every || {}));
    const violatingFilter = hasFilterKeys(matchingFilter) ? { $nor: [matchingFilter] } : { $expr: { $eq: [1, 0] } };
    const violatingParentValues = await relCollection.distinct(targetField, violatingFilter);
    if (violatingParentValues.length > 0) {
      conditions.push({ [sourceField]: { $nin: normalizeLookupValue(relation.sourceField, violatingParentValues) } });
    }
  }

  if (
    relation.type === "one" &&
    !Object.prototype.hasOwnProperty.call(filterSpec, "some") &&
    !Object.prototype.hasOwnProperty.call(filterSpec, "none") &&
    !Object.prototype.hasOwnProperty.call(filterSpec, "every")
  ) {
    const parentValues = await matchingParentValues(filterSpec);
    conditions.push({ [sourceField]: { $in: normalizeLookupValue(relation.sourceField, parentValues) } });
  }

  return andFilters(conditions);
}

async function resolveRelationFilters(modelName, filter) {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    return filter || {};
  }

  const cleanFilter = {};
  const relationFilters = [];

  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith("__rel__")) {
      relationFilters.push(await relationSpecToParentFilter(modelName, key.slice(7), value));
      continue;
    }

    if (["$and", "$or", "$nor"].includes(key) && Array.isArray(value)) {
      cleanFilter[key] = await Promise.all(value.map((item) => resolveRelationFilters(modelName, item)));
      continue;
    }

    if (key === "$not" && value && typeof value === "object") {
      cleanFilter[key] = await resolveRelationFilters(modelName, value);
      continue;
    }

    cleanFilter[key] = value;
  }

  return andFilters([cleanFilter, ...relationFilters]);
}

function toMongoSort(orderBy) {
  if (!orderBy) {
    return undefined;
  }

  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  const sort = {};

  for (const clause of clauses) {
    for (const [field, direction] of Object.entries(clause)) {
      sort[field] = direction === "desc" ? -1 : 1;
    }
  }

  return Object.keys(sort).length > 0 ? sort : undefined;
}

function cleanDoc(doc) {
  if (!doc) {
    return null;
  }
  const cloned = serializeValueForApi(doc);
  delete cloned._id;
  return cloned;
}

// ---------------------------------------------------------------------------
// Resolve `include` and `select` by performing targeted lookups instead of
// loading entire collections.
// ---------------------------------------------------------------------------

async function resolveInclude(modelName, doc, include) {
  if (!include || !doc) {
    return doc;
  }

  const output = { ...doc };

  for (const [field, spec] of Object.entries(include)) {
    if (field === "_count") {
      output._count = await resolveCount(modelName, doc, spec);
      continue;
    }

    const relation = RELATIONS[modelName] && RELATIONS[modelName][field];
    if (!relation) {
      continue;
    }

    const relCollection = getCollection(relation.model);
    const relationFilter = buildRelationLookupFilter(relation, doc);

    if (relation.type === "one") {
      const related = await relCollection.findOne(relationFilter);
      const cleanRelated = cleanDoc(related);
      output[field] = spec && typeof spec === "object" && spec !== true
        ? await resolveSelectAndInclude(relation.model, cleanRelated, spec)
        : cleanRelated;
    } else {
      // "many" relation
      let relFilter = relationFilter;
      let relSort = undefined;
      let relSkip = 0;
      let relLimit = 0;

      if (spec && typeof spec === "object" && spec !== true) {
        if (spec.where) {
          const additionalFilter = toMongoFilter(relation.model, spec.where);
          const { cleanFilter } = extractRelationFilters(additionalFilter);
          relFilter = { ...relFilter, ...cleanFilter };
        }
        relSort = toMongoSort(spec.orderBy);
        relSkip = typeof spec.skip === "number" ? spec.skip : 0;
        relLimit = typeof spec.take === "number" ? spec.take : 0;
      }

      let cursor = relCollection.find(relFilter);
      if (relSort) {
        cursor = cursor.sort(relSort);
      }
      if (relSkip > 0) {
        cursor = cursor.skip(relSkip);
      }
      if (relLimit > 0) {
        cursor = cursor.limit(relLimit);
      }

      const rawDocs = await cursor.toArray();
      const cleanDocs = rawDocs.map(cleanDoc);

      if (spec && typeof spec === "object" && spec !== true) {
        const mapped = [];
        for (const relDoc of cleanDocs) {
          mapped.push(await resolveSelectAndInclude(relation.model, relDoc, spec));
        }
        output[field] = mapped;
      } else {
        output[field] = cleanDocs;
      }
    }
  }

  return output;
}

async function resolveSelect(modelName, doc, select) {
  if (!select || !doc) {
    return doc;
  }

  const output = {};

  for (const [field, spec] of Object.entries(select)) {
    if (field === "_count") {
      output._count = await resolveCount(modelName, doc, spec);
      continue;
    }

    const relation = RELATIONS[modelName] && RELATIONS[modelName][field];
    if (!relation) {
      if (spec) {
        output[field] = doc[field];
      }
      continue;
    }

    // Handle relation in select
    const relCollection = getCollection(relation.model);
    const relationFilter = buildRelationLookupFilter(relation, doc);

    if (relation.type === "one") {
      const related = await relCollection.findOne(relationFilter);
      const cleanRelated = cleanDoc(related);
      output[field] = spec === true ? cleanRelated : await resolveSelectAndInclude(relation.model, cleanRelated, spec || {});
    } else {
      const rawDocs = await relCollection.find(relationFilter).toArray();
      const cleanDocs = rawDocs.map(cleanDoc);
      const mapped = [];
      for (const relDoc of cleanDocs) {
        mapped.push(spec === true ? relDoc : await resolveSelectAndInclude(relation.model, relDoc, spec || {}));
      }
      output[field] = mapped;
    }
  }

  return output;
}

async function resolveCount(modelName, doc, countSpec) {
  if (!countSpec || typeof countSpec !== "object") {
    return {};
  }

  const selected = countSpec.select || {};
  const out = {};

  for (const [relationName, spec] of Object.entries(selected)) {
    const relation = RELATIONS[modelName] && RELATIONS[modelName][relationName];
    if (!relation) {
      out[relationName] = 0;
      continue;
    }

    const relCollection = getCollection(relation.model);
    let countFilter = buildRelationLookupFilter(relation, doc);

    if (spec && typeof spec === "object" && spec.where) {
      const additionalFilter = toMongoFilter(relation.model, spec.where);
      const { cleanFilter } = extractRelationFilters(additionalFilter);
      countFilter = { ...countFilter, ...cleanFilter };
    }

    out[relationName] = await relCollection.countDocuments(countFilter);
  }

  return out;
}

async function resolveSelectAndInclude(modelName, doc, args = {}) {
  if (!doc) {
    return null;
  }

  let output = doc;

  if (args.select) {
    output = await resolveSelect(modelName, doc, args.select);
  }

  if (args.include) {
    output = await resolveInclude(modelName, output, args.include);
  }

  return output;
}

// ---------------------------------------------------------------------------
// Resolve relation-based where filters (some/none/every).
//
// These require looking up related documents. We do targeted queries
// instead of loading entire collections.
// ---------------------------------------------------------------------------

async function filterByRelations(modelName, docs, relationFilters) {
  if (Object.keys(relationFilters).length === 0) {
    return docs;
  }

  const filtered = [];

  for (const doc of docs) {
    let matches = true;

    for (const [relationName, filterSpec] of Object.entries(relationFilters)) {
      const relation = RELATIONS[modelName] && RELATIONS[modelName][relationName];
      if (!relation) {
        continue;
      }

      const relCollection = getCollection(relation.model);
      const relationFilter = buildRelationLookupFilter(relation, doc);

      if (filterSpec && typeof filterSpec === "object") {
        if (Object.prototype.hasOwnProperty.call(filterSpec, "some")) {
          const subFilter = toMongoFilter(relation.model, filterSpec.some);
          const { cleanFilter } = extractRelationFilters(subFilter);
          const exists = await relCollection.findOne({
            ...relationFilter,
            ...cleanFilter,
          });
          if (!exists) {
            matches = false;
            break;
          }
        } else if (Object.prototype.hasOwnProperty.call(filterSpec, "none")) {
          const subFilter = toMongoFilter(relation.model, filterSpec.none);
          const { cleanFilter } = extractRelationFilters(subFilter);
          const exists = await relCollection.findOne({
            ...relationFilter,
            ...cleanFilter,
          });
          if (exists) {
            matches = false;
            break;
          }
        } else if (Object.prototype.hasOwnProperty.call(filterSpec, "every")) {
          const totalCount = await relCollection.countDocuments({
            ...relationFilter,
          });
          if (totalCount === 0) {
            continue;
          }
          const subFilter = toMongoFilter(relation.model, filterSpec.every);
          const { cleanFilter } = extractRelationFilters(subFilter);
          const matchingCount = await relCollection.countDocuments({
            ...relationFilter,
            ...cleanFilter,
          });
          if (matchingCount !== totalCount) {
            matches = false;
            break;
          }
        } else if (relation.type === "one") {
          // Direct filter on a one-relation: { college: { isActive: true } }
          const subFilter = toMongoFilter(relation.model, filterSpec);
          const { cleanFilter } = extractRelationFilters(subFilter);
          const exists = await relCollection.findOne({
            ...relationFilter,
            ...cleanFilter,
          });
          if (!exists) {
            matches = false;
            break;
          }
        }
      }
    }

    if (matches) {
      filtered.push(doc);
    }
  }

  return filtered;
}

const getRelationFilterMaxCandidates = () => Math.max(1, Number(env.database?.relationFilterMaxCandidates || 5000));

const getRelationFilterBatchSize = () =>
  Math.max(1, Math.min(Number(env.database?.relationFilterBatchSize || 500), getRelationFilterMaxCandidates()));

const createRelationFilterLimitError = (modelName, maxCandidates) => {
  const error = new Error("Relation-filtered query is too broad. Add more filters or raise DB_RELATION_FILTER_MAX_CANDIDATES.");
  error.statusCode = 422;
  error.code = "RELATION_FILTER_QUERY_TOO_BROAD";
  error.details = { model: modelName, maxCandidates };
  return error;
};

async function collectRelationFilteredDocuments({
  modelName,
  collection,
  cleanFilter,
  relations,
  sort,
  skip = 0,
  take = null,
}) {
  const maxCandidates = getRelationFilterMaxCandidates();
  const batchSize = getRelationFilterBatchSize();
  const normalizedSkip = Number.isFinite(Number(skip)) && Number(skip) > 0 ? Math.floor(Number(skip)) : 0;
  const normalizedTake = Number.isFinite(Number(take)) && Number(take) >= 0 ? Math.floor(Number(take)) : null;

  if (normalizedTake === 0) {
    return [];
  }

  let cursor = collection.find(cleanFilter).batchSize(batchSize).limit(maxCandidates + 1);
  if (sort) {
    cursor = cursor.sort(sort);
  }

  let seenCandidates = 0;
  let skippedMatches = 0;
  const filtered = [];

  for await (const rawDoc of cursor) {
    seenCandidates += 1;
    if (seenCandidates > maxCandidates) {
      throw createRelationFilterLimitError(modelName, maxCandidates);
    }

    const doc = cleanDoc(rawDoc);
    const matches = await filterByRelations(modelName, [doc], relations);
    if (matches.length === 0) {
      continue;
    }

    if (skippedMatches < normalizedSkip) {
      skippedMatches += 1;
      continue;
    }

    filtered.push(doc);
    if (normalizedTake !== null && filtered.length >= normalizedTake) {
      break;
    }
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// modelClient — Drop-in replacement for the previous ORM, using native
// MongoDB queries with proper indexed filters and $lookup for relations.
// ---------------------------------------------------------------------------

// A `select` made only of scalar fields becomes a native projection, so Mongo
// sends just those fields. Selects with relations or _count return null: their
// resolvers need source fields (e.g. departmentId) that may not be selected.
function buildScalarProjection(modelName, select) {
  if (!select || typeof select !== "object") return null;
  const projection = { _id: 1 };
  for (const [field, spec] of Object.entries(select)) {
    if (field === "_count" || (RELATIONS[modelName] && RELATIONS[modelName][field])) return null;
    if (spec) projection[toDocumentFieldName(field)] = 1;
  }
  return projection;
}

function modelClient(modelName) {
  return {
    // Compatibility helper: some controllers expect a Mongoose-like
    // `findOne(...).lean()` chain. Provide a minimal shim so existing
    // controller code works while we migrate to the service/dbClient API.
    findOne(query) {
      const self = this;
      return {
        lean: async () => {
          return await self.findFirst({ where: query });
        },
      };
    },
    async findMany(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const mongoFilter = toMongoFilter(modelName, args.where);
      const resolvedFilter = await resolveRelationFilters(modelName, mongoFilter);
      const { cleanFilter, relations } = extractRelationFilters(resolvedFilter);
      const sort = toMongoSort(args.orderBy);

      // If no relation filters, use native MongoDB pagination
      if (Object.keys(relations).length === 0) {
        const projection = args.include ? null : buildScalarProjection(modelName, args.select);
        let cursor = collection.find(cleanFilter, projection ? { projection } : undefined);
        if (sort) {
          cursor = cursor.sort(sort);
        }
        if (typeof args.skip === "number" && args.skip > 0) {
          cursor = cursor.skip(args.skip);
        }
        if (typeof args.take === "number") {
          cursor = cursor.limit(args.take);
        }

        const rawDocs = await cursor.toArray();
        const docs = rawDocs.map(cleanDoc);
        const out = [];
        for (const doc of docs) {
          out.push(await resolveSelectAndInclude(modelName, doc, args));
        }
        return out;
      }

      // Has relation filters — fetch candidates then filter
      const filtered = await collectRelationFilteredDocuments({
        modelName,
        collection,
        cleanFilter,
        relations,
        sort,
        skip: args.skip,
        take: args.take,
      });

      const out = [];
      for (const doc of filtered) {
        out.push(await resolveSelectAndInclude(modelName, doc, args));
      }
      return out;
    },

    async findFirst(args = {}) {
      const items = await this.findMany({ ...args, take: 1 });
      return items[0] || null;
    },

    async findUnique(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const normalizedWhere = normalizeCompoundWhere(modelName, args.where || {});
      const mongoFilter = toMongoFilter(modelName, normalizedWhere);
      const resolvedFilter = await resolveRelationFilters(modelName, mongoFilter);
      const { cleanFilter } = extractRelationFilters(resolvedFilter);

      const rawDoc = await collection.findOne(cleanFilter);
      const doc = cleanDoc(rawDoc);
      if (!doc) {
        return null;
      }
      return resolveSelectAndInclude(modelName, doc, args);
    },

    async create(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const now = new Date();
      const data = normalizeDocumentForWrite(args.data || {});
      const doc = {
        ...materializeDefaults(modelName),
        ...data,
      };

      if (!Object.prototype.hasOwnProperty.call(doc, "_id")) {
        doc._id = new mongoose.Types.ObjectId();
      }

      delete doc.id;

      if (!Object.prototype.hasOwnProperty.call(doc, "createdAt")) {
        doc.createdAt = now;
      }
      doc.updatedAt = now;

      await collection.insertOne(doc);
      const clean = cleanDoc(doc);
      return resolveSelectAndInclude(modelName, clean, args);
    },

    async createMany(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const rows = Array.isArray(args.data) ? args.data : [];
      if (rows.length === 0) {
        return { count: 0 };
      }

      const now = new Date();
      const docs = rows.map((row) => {
        const normalizedRow = normalizeDocumentForWrite(row);
        const doc = {
          ...materializeDefaults(modelName),
          ...normalizedRow,
        };
        if (!Object.prototype.hasOwnProperty.call(doc, "_id")) {
          doc._id = new mongoose.Types.ObjectId();
        }
        delete doc.id;
        if (!Object.prototype.hasOwnProperty.call(doc, "createdAt")) {
          doc.createdAt = now;
        }
        doc.updatedAt = now;
        return doc;
      });

      try {
        await collection.insertMany(docs, { ordered: false });
      } catch (error) {
        // If skipDuplicates was intended, swallow duplicate-key errors
        if (args.skipDuplicates && error.code === 11000) {
          return { count: docs.length - (error.writeErrors?.length || 0) };
        }
        throw error;
      }
      return { count: docs.length };
    },

    async update(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const normalizedWhere = normalizeCompoundWhere(modelName, args.where || {});
      const mongoFilter = toMongoFilter(modelName, normalizedWhere);
      const resolvedFilter = await resolveRelationFilters(modelName, mongoFilter);
      const { cleanFilter } = extractRelationFilters(resolvedFilter);

      const updateData = {
        ...normalizeDocumentForWrite(args.data || {}),
        updatedAt: new Date(),
      };

      const result = await collection.findOneAndUpdate(
        cleanFilter,
        { $set: updateData },
        { returnDocument: "after" }
      );

      // MongoDB driver versions differ here:
      // some return the updated document directly, others wrap it in { value }.
      const updatedDoc = result && typeof result === "object" && "value" in result
        ? result.value
        : result;
      if (!updatedDoc) {
        return null;
      }

      const clean = cleanDoc(updatedDoc);
      return resolveSelectAndInclude(modelName, clean, args);
    },

    async updateMany(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const mongoFilter = toMongoFilter(modelName, args.where);
      const resolvedFilter = await resolveRelationFilters(modelName, mongoFilter);
      const { cleanFilter, relations } = extractRelationFilters(resolvedFilter);

      if (Object.keys(relations).length > 0) {
        // Relations in updateMany where — need to resolve IDs first
        const filtered = await collectRelationFilteredDocuments({
          modelName,
          collection,
          cleanFilter,
          relations,
        });
        const ids = filtered.map((d) => d.id);
        if (ids.length === 0) {
          return { count: 0 };
        }
        const result = await collection.updateMany(
          { _id: { $in: normalizeLookupValue("id", ids) } },
          { $set: { ...normalizeDocumentForWrite(args.data || {}), updatedAt: new Date() } }
        );
        return { count: result.modifiedCount || 0 };
      }

      const result = await collection.updateMany(
        cleanFilter,
        { $set: { ...normalizeDocumentForWrite(args.data || {}), updatedAt: new Date() } }
      );
      return { count: result.modifiedCount || 0 };
    },

    async delete(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const normalizedWhere = normalizeCompoundWhere(modelName, args.where || {});
      const mongoFilter = toMongoFilter(modelName, normalizedWhere);
      const resolvedFilter = await resolveRelationFilters(modelName, mongoFilter);
      const { cleanFilter } = extractRelationFilters(resolvedFilter);

      const existing = await collection.findOne(cleanFilter);
      if (!existing) {
        return null;
      }

      await collection.deleteOne({ _id: existing._id });
      return cleanDoc(existing);
    },

    async deleteMany(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const mongoFilter = toMongoFilter(modelName, args.where);
      const resolvedFilter = await resolveRelationFilters(modelName, mongoFilter);
      const { cleanFilter, relations } = extractRelationFilters(resolvedFilter);

      if (Object.keys(relations).length > 0) {
        const filtered = await collectRelationFilteredDocuments({
          modelName,
          collection,
          cleanFilter,
          relations,
        });
        const ids = filtered.map((d) => d.id);
        if (ids.length === 0) {
          return { count: 0 };
        }
        const result = await collection.deleteMany({ _id: { $in: normalizeLookupValue("id", ids) } });
        return { count: result.deletedCount || 0 };
      }

      const result = await collection.deleteMany(cleanFilter);
      return { count: result.deletedCount || 0 };
    },

    async upsert(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const normalizedWhere = normalizeCompoundWhere(modelName, args.where || {});

      const mongoFilter = toMongoFilter(modelName, normalizedWhere);
      const resolvedFilter = await resolveRelationFilters(modelName, mongoFilter);
      const { cleanFilter, relations } = extractRelationFilters(resolvedFilter);

      if (Object.keys(relations).length > 0) {
        const existing = await this.findFirst({ where: normalizedWhere });
        if (existing) {
          return this.update({ where: { id: existing.id }, data: args.update || {}, select: args.select, include: args.include });
        }
        return this.create({ data: args.create || {}, select: args.select, include: args.include });
      }

      const now = new Date();
      const createData = normalizeDocumentForWrite(args.create || {});
      const updateData = normalizeDocumentForWrite(args.update || {});

      const insertDoc = {
        ...materializeDefaults(modelName),
        ...createData,
      };

      if (!Object.prototype.hasOwnProperty.call(insertDoc, "_id")) {
        insertDoc._id = new mongoose.Types.ObjectId();
      }
      delete insertDoc.id;

      if (!Object.prototype.hasOwnProperty.call(insertDoc, "createdAt")) {
        insertDoc.createdAt = now;
      }

      const setData = {
        ...updateData,
        updatedAt: now,
      };

      const setOnInsertData = Object.fromEntries(
        Object.entries(insertDoc).filter(([key]) => !Object.prototype.hasOwnProperty.call(setData, key))
      );

      try {
        const result = await collection.findOneAndUpdate(
          cleanFilter,
          {
            $set: setData,
            $setOnInsert: setOnInsertData,
          },
          {
            upsert: true,
            returnDocument: "after",
          }
        );

        const updatedDoc = result && typeof result === "object" && "value" in result
          ? result.value
          : result;

        return resolveSelectAndInclude(modelName, cleanDoc(updatedDoc), args);
      } catch (error) {
        if (error?.code !== 11000) {
          throw error;
        }

        const existing = await collection.findOne(cleanFilter);
        if (!existing) {
          throw error;
        }

        const updated = await collection.findOneAndUpdate(
          { _id: existing._id },
          { $set: setData },
          { returnDocument: "after" }
        );
        const updatedDoc = updated && typeof updated === "object" && "value" in updated
          ? updated.value
          : updated;
        return resolveSelectAndInclude(modelName, cleanDoc(updatedDoc), args);
      }
    },

    async count(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const mongoFilter = toMongoFilter(modelName, args.where);
      const resolvedFilter = await resolveRelationFilters(modelName, mongoFilter);
      const { cleanFilter, relations } = extractRelationFilters(resolvedFilter);

      if (Object.keys(relations).length > 0) {
        const filtered = await collectRelationFilteredDocuments({
          modelName,
          collection,
          cleanFilter,
          relations,
        });
        return filtered.length;
      }

      return collection.countDocuments(cleanFilter);
    },

    async groupBy(args = {}) {
      await ensureConnected();
      const collection = getCollection(modelName);
      const mongoFilter = toMongoFilter(modelName, args.where);
      const resolvedFilter = await resolveRelationFilters(modelName, mongoFilter);
      const { cleanFilter } = extractRelationFilters(resolvedFilter);
      const by = Array.isArray(args.by) ? args.by : [];

      // Build MongoDB aggregation pipeline for groupBy
      const groupId = {};
      for (const field of by) {
        const dbField = field === "id" ? "_id" : field;
        groupId[dbField] = `$${dbField}`;
      }

      const groupStage = { _id: groupId };

      if (args._count === true) {
        groupStage._all_count = { $sum: 1 };
      } else if (args._count && typeof args._count === "object") {
        for (const countField of Object.keys(args._count)) {
          groupStage[`_count_${countField}`] = { $sum: 1 };
        }
      }

      const pipeline = [
        { $match: cleanFilter },
        { $group: groupStage },
      ];

      const results = await collection.aggregate(pipeline).toArray();

      return results.map((row) => {
        const out = {};
        for (const field of by) {
          const dbField = field === "id" ? "_id" : field;
          if (dbField === "_id" && by.length === 1) {
            out[field] = serializeValueForApi(row._id);
            continue;
          }

          out[field] = serializeValueForApi(row._id?.[dbField]);
        }
        out._count = {};
        if (args._count === true) {
          out._count._all = row._all_count || 0;
        } else if (args._count && typeof args._count === "object") {
          for (const countField of Object.keys(args._count)) {
            out._count[countField] = row[`_count_${countField}`] || 0;
          }
        }
        return out;
      });
    },
  };
}

const MODEL_NAMES = Object.keys(MODEL_TO_COLLECTION);
const dbClient = {};

for (const modelName of MODEL_NAMES) {
  dbClient[modelName] = modelClient(modelName);
}

dbClient.$disconnect = async () => {
  if (!db) {
    return;
  }
  intentionalDisconnect = true;
  await mongoose.disconnect();
  db = null;
};

dbClient.$transaction = async (payload) => {
  if (typeof payload === "function") {
    // Use MongoDB client sessions for real transaction support
    const session = await mongoose.connection.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await payload(dbClient);
      });
      return result;
    } catch (error) {
      // If transactions are not supported (standalone MongoDB), fall back to
      // running the callback without a session. This preserves backward
      // compatibility for dev environments that use standalone mongod.
      if (
        error.codeName === "IllegalOperation" ||
        error.message?.includes("Transaction numbers") ||
        error.message?.includes("replica set")
      ) {
        if (env.nodeEnv === "production") {
          throw error;
        }
        return payload(dbClient);
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
  if (Array.isArray(payload)) {
    return Promise.all(payload);
  }
  return payload;
};

module.exports = dbClient;
