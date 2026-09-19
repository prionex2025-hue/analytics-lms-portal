const { z } = require("zod");
const mongoose = require("mongoose");
const { TEST_TYPES, PROCTORING_PRESETS, ALLOWED_MODULE_CATEGORIES } = require("../../services/test-config.service");
const idSchema = z.string().trim().refine((value) => {
  return mongoose.Types.ObjectId.isValid(value);
}, "Invalid id format");

const optionalIdSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  idSchema.optional()
);

const optionalExplanationVideoUrlSchema = z.preprocess(
  (value) => {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
  },
  z.string().url().max(2048).refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, { message: "Explanation video URL must be a valid http(s) URL" }).nullable().optional()
);

const dateStringSchema = z.string().trim().min(1).refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime());
}, "Invalid date");

const validateQueryDateRange = (input, ctx) => {
  const from = input.query?.dateFrom ? new Date(input.query.dateFrom) : null;
  const to = input.query?.dateTo ? new Date(input.query.dateTo) : null;
  if (from && to && from > to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["query", "dateTo"],
      message: "dateTo must be greater than or equal to dateFrom",
    });
  }
};

const studentFiltersSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    year: z.coerce.number().int().min(1).max(4).optional(),
    studentScope: z.enum(["current", "passout", "all"]).optional(),
    passoutYear: z.coerce.number().int().min(2000).max(2100).optional(),
    passoutCohortId: z.string().trim().optional(),
    departmentId: idSchema.optional(),
    batchId: idSchema.optional(),
  }),
});

const createStudentSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2),
    email: z.string().trim().email(),
    department: z.string().trim().min(2),
    year: z.coerce.number().int().min(1).max(4),
    batch: optionalIdSchema,
    enrollNumber: z.string().trim().min(3),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const createBatchSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    year: z.number().int().min(2000).max(2100),
    departmentId: idSchema,
    studentIds: z.array(idSchema).optional().default([]),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const assignStudentsToBatchSchema = z.object({
  body: z.object({
    studentIds: z.array(idSchema).min(1),
  }),
  params: z.object({
    batchId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const batchIdParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    batchId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const testAssignBatchSchema = z.object({
  body: z.object({
    batchId: idSchema,
  }),
  params: z.object({
    testId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const testAssignDepartmentSchema = z.object({
  body: z.object({
    departmentId: idSchema,
  }),
  params: z.object({
    testId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const bulkBatchStudentsSchema = z.object({
  body: z.object({
    csvData: z.string().trim().optional(),
    studentIds: z.array(idSchema).optional().default([]),
  }).refine((payload) => Boolean(payload.csvData) || (Array.isArray(payload.studentIds) && payload.studentIds.length > 0), {
    message: "Provide csvData or at least one studentId",
  }),
  params: z.object({
    batchId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const removeStudentFromBatchSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    batchId: idSchema,
    studentId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const eventBodySchema = z.object({
  title: z.string().trim().min(3),
  description: z.string().trim().min(3),
  eventType: z.enum(["Hackathon", "Symposium", "Workshop", "Other"]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().nullable(),
  registrationDeadline: z.string().datetime().optional().nullable(),
  eventDate: z.string().datetime().optional().nullable(),
  location: z.string().trim().optional().nullable(),
  registrationLimit: z.number().int().min(1).max(10000).optional().nullable(),
  maxParticipants: z.number().int().min(1).max(10000).optional().nullable(),
  registrationUrl: z.string().url().optional().nullable(),
  visibilityScope: z.enum(["COLLEGE_ONLY", "INTER_COLLEGE"]).optional().default("COLLEGE_ONLY"),
  registrationFields: z.array(
    z.object({
      key: z.string().trim().min(1),
      label: z.string().trim().min(1),
      type: z.enum(["text", "email", "number", "select", "textarea"]),
      required: z.boolean().default(false),
      options: z.array(z.string().trim()).optional().default([]),
    })
  ).optional().default([]),
});

const createEventSchema = z.object({
  body: eventBodySchema,
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  const startsAt = new Date(input.body.startsAt);
  const eventDate = input.body.eventDate ? new Date(input.body.eventDate) : startsAt;
  const deadline = input.body.registrationDeadline ? new Date(input.body.registrationDeadline) : null;

  if (deadline && deadline > eventDate) {
    ctx.addIssue({ code: "custom", message: "registration_deadline must be less than or equal to event_date" });
  }

  const maxParticipants = Number(input.body.maxParticipants ?? input.body.registrationLimit ?? 1);
  if (!Number.isFinite(maxParticipants) || maxParticipants < 1) {
    ctx.addIssue({ code: "custom", message: "max_participants must be at least 1" });
  }
});

const updateEventSchema = z.object({
  body: eventBodySchema.partial().refine((body) => Object.keys(body).length > 0, {
    message: "At least one event field must be provided",
  }),
  params: z.object({
    eventId: idSchema,
  }),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  const startsAt = input.body.startsAt ? new Date(input.body.startsAt) : null;
  const eventDate = input.body.eventDate ? new Date(input.body.eventDate) : startsAt;
  const deadline = input.body.registrationDeadline ? new Date(input.body.registrationDeadline) : null;

  if (deadline && eventDate && deadline > eventDate) {
    ctx.addIssue({ code: "custom", message: "registration_deadline must be less than or equal to event_date" });
  }

  const maxParticipants = Number(input.body.maxParticipants ?? input.body.registrationLimit ?? 1);
  if ((input.body.maxParticipants != null || input.body.registrationLimit != null) && (!Number.isFinite(maxParticipants) || maxParticipants < 1)) {
    ctx.addIssue({ code: "custom", message: "max_participants must be at least 1" });
  }
});

const eventIdParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    eventId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const cancelEventSchema = z.object({
  body: z.object({
    reason: z.string().trim().min(3).max(500),
  }),
  params: z.object({
    eventId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const assignStudentBatchSchema = z.object({
  body: z.object({
    batchId: idSchema,
  }),
  params: z.object({
    studentId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const studentIdParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    studentId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const studentBulkImportSchema = z.object({
  body: z.object({
    csvData: z.string().trim().min(1),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const promoteStudentsYearSchema = z.object({
  body: z.object({
    confirmationText: z.string().trim().min(1),
    passoutYear: z.coerce.number().int().min(2000).max(2100).optional(),
    academicLabel: z.string().trim().min(3).max(50).optional(),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const studentBulkImportJobParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    jobId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});


const updateAdminSettingsSchema = z.object({
  body: z.object({
    defaultTestConfig: z.object({
      durationMins: z.number().int().min(5).max(480).optional(),
      attemptsAllowed: z.number().int().min(1).max(10).optional(),
      violationThreshold: z.number().int().min(1).max(20).optional(),
      evaluationRule: z.enum(["BEST_ATTEMPT", "LAST_ATTEMPT"]).optional(),
      testType: z.enum(Object.values(TEST_TYPES)).optional(),
      proctoringPreset: z.enum(Object.values(PROCTORING_PRESETS)).optional(),
    }).optional(),
    collegeSettings: z.object({
      allowBatchArchive: z.boolean().optional(),
      registrationPolicy: z.enum(["OPEN", "APPROVAL_REQUIRED"]).optional(),
      reportRetentionDays: z.number().int().min(7).max(3650).optional(),
    }).optional(),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const changeAdminPasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const optionalModuleCategorySchema = z.preprocess(
  (value) => {
    if (value == null || value === "") return undefined;
    return String(value).trim();
  },
  z.enum(ALLOWED_MODULE_CATEGORIES).optional()
);

const questionBankSchema = z.object({
  body: z.object({
    subject: z.string().trim().min(2).optional(),
    subjectId: z.string().trim().min(1).optional(),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).default("MEDIUM"),
    type: z.enum(["mcq", "true_false", "fill_blank", "paragraph"]),
    question: z.string().trim().min(1),
    options: z.array(z.string().trim()).default([]),
    correctAnswer: z.union([z.string(), z.boolean()]),
    marks: z.number().int().min(1),
    explanationVideoUrl: optionalExplanationVideoUrlSchema,
    category: optionalModuleCategorySchema,
  }).refine((data) => data.subject || data.subjectId, {
    message: "Either subject or subjectId is required",
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

// Bulk import shares the single-add contract but is lenient where the controller
// already defaulted values. Critically it enforces the `type` enum (an unknown
// type previously stored `type: undefined`, producing a permanently unscoreable
// question), requires real options for MCQ, and caps the payload size.
const questionBankImportItemSchema = z
  .object({
    subject: z.string().trim().min(1).optional(),
    subjectId: z.string().trim().min(1).optional(),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional().default("MEDIUM"),
    type: z.enum(["mcq", "true_false", "fill_blank", "paragraph"]),
    question: z.string().trim().min(1),
    options: z.array(z.string().trim()).optional().default([]),
    correctAnswer: z.union([z.string(), z.boolean(), z.number()]),
    marks: z.number().int().min(1).optional().default(1),
    explanationVideoUrl: optionalExplanationVideoUrlSchema,
    category: optionalModuleCategorySchema,
    tags: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (item) => item.type !== "mcq" || (Array.isArray(item.options) && item.options.filter((opt) => String(opt).trim()).length >= 2),
    { message: "MCQ questions require at least two non-empty options", path: ["options"] }
  );

const questionBankBulkImportSchema = z.object({
  body: z.object({
    items: z
      .array(questionBankImportItemSchema)
      .min(1, "items[] must contain at least one question")
      .max(1000, "A single import is limited to 1000 questions"),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const questionBankQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    subjectId: z.string().trim().optional(),
    subject: z.string().trim().optional(),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
    type: z.enum(["mcq", "true_false", "fill_blank", "paragraph"]).optional(),
    category: z.string().trim().optional(),
    search: z.string().trim().optional(),
    fromDate: z.string().trim().optional(),
    toDate: z.string().trim().optional(),
    page: z.string().trim().optional(),
    limit: z.string().trim().optional(),
  }).optional().default({}),
});

const questionBankParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().trim().min(1),
  }),
  query: z.object({}).optional().default({}),
});

const updateQuestionBankSchema = z.object({
  body: z.object({
    subjectId: z.string().trim().optional(),
    subject: z.string().trim().optional(),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
    type: z.enum(["mcq", "true_false", "fill_blank", "paragraph"]).optional(),
    question: z.string().trim().min(1).optional(),
    options: z.array(z.string().trim()).optional(),
    correctAnswer: z.union([z.string(), z.boolean()]).optional(),
    marks: z.number().int().min(1).optional(),
    explanationVideoUrl: optionalExplanationVideoUrlSchema,
    tags: z.array(z.string().trim()).optional(),
    isActive: z.boolean().optional(),
    category: optionalModuleCategorySchema,
  }),
  params: z.object({
    id: z.string().trim().min(1),
  }),
  query: z.object({}).optional().default({}),
});

const createSubjectSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const generateReportSchema = z.object({
  body: z.object({
    type: z.enum(["STUDENT_WISE", "TEST_WISE", "DEPARTMENT_WISE", "BATCH_WISE", "COMPREHENSIVE"]),
    filters: z
      .object({
        studentId: z.string().trim().min(1).optional(),
        testId: z.string().trim().min(1).optional(),
        departmentId: z.string().trim().min(1).optional(),
        batchId: z.string().trim().min(1).optional(),
        year: z.coerce.number().int().min(1).max(4).optional(),
        studentScope: z.enum(["current", "passout", "all"]).optional(),
        passoutYear: z.coerce.number().int().min(2000).max(2100).optional(),
        passoutCohortId: z.string().trim().min(1).optional(),
        semester: z.string().trim().min(1).optional(),
        academicYear: z.string().trim().min(1).optional(),
        remarks: z.string().trim().max(2000).optional(),
        logoUrl: z.string().url().optional(),
        dateFrom: z.string().datetime().optional(),
        dateTo: z.string().datetime().optional(),
      })
      .optional()
      .default({}),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const reviewReportAnomalySchema = z.object({
  body: z.object({
    testId: z.string().trim().min(1),
    anomalyId: z.string().trim().min(1),
    anomalyType: z.enum([
      "UNUSUALLY_FAST_HIGH_SCORE",
      "HIGH_VIOLATIONS_HIGH_SCORE",
      "IDENTICAL_ANSWER_PATTERN",
    ]),
    action: z.enum(["DISMISS", "ESCALATE"]),
    reason: z.string().trim().min(5).max(500),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const reportAnalyticsQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    mode: z.enum(["department", "batch", "student"]),
    departmentId: z.string().trim().optional(),
    batchId: z.string().trim().optional(),
    studentId: z.string().trim().optional(),
    testId: z.string().trim().optional(),
    year: z.coerce.number().int().min(1).max(4).optional(),
    studentScope: z.enum(["current", "passout", "all"]).optional(),
    passoutYear: z.coerce.number().int().min(2000).max(2100).optional(),
    passoutCohortId: z.string().trim().optional(),
    academicYear: z.string().trim().optional(),
    dateFrom: dateStringSchema.optional(),
    dateTo: dateStringSchema.optional(),
  }),
}).superRefine(validateQueryDateRange);

const reportJobStatusParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    reportJobId: z.string().trim().min(1),
  }),
  query: z.object({}).optional().default({}),
});

const reportDashboardQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    testId: idSchema.optional(),
    departmentId: idSchema.optional(),
    batchId: idSchema.optional(),
    studentId: idSchema.optional(),
    year: z.coerce.number().int().min(1).max(4).optional(),
    studentScope: z.enum(["current", "passout", "all"]).optional(),
    passoutYear: z.coerce.number().int().min(2000).max(2100).optional(),
    passoutCohortId: z.string().trim().optional(),
    studentSearch: z.string().trim().optional(),
    search: z.string().trim().optional(),
    dateRange: z.enum(["7d", "30d", "90d", "custom"]).optional(),
    dateFrom: z.string().trim().min(1).optional(),
    dateTo: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sortBy: z.enum(["studentName", "department", "batch", "testName", "score", "accuracy", "timeTaken", "attemptCount", "status", "violationCount", "date"]).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  }).optional().default({}),
});

const reportTestsQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    departmentId: idSchema.optional(),
    batchId: idSchema.optional(),
    year: z.coerce.number().int().min(1).max(4).optional(),
    studentScope: z.enum(["current", "passout", "all"]).optional(),
    passoutYear: z.coerce.number().int().min(2000).max(2100).optional(),
    passoutCohortId: z.string().trim().optional(),
    search: z.string().trim().optional(),
    status: z.enum(["all", "ALL", "LIVE", "COMPLETED", "SCHEDULED", "DRAFT", "ARCHIVED"]).optional(),
    dateRange: z.enum(["7d", "30d", "90d", "custom"]).optional(),
    dateFrom: z.string().trim().min(1).optional(),
    dateTo: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sortBy: z.enum(["title", "avgScore", "participation", "passRate", "violations", "submissionCount", "startsAt"]).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  }).optional().default({}),
});

const reportTestScopedQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    testId: idSchema,
    studentScope: z.enum(["current", "passout", "all"]).optional(),
    passoutYear: z.coerce.number().int().min(2000).max(2100).optional(),
    passoutCohortId: z.string().trim().optional(),
  }),
});

const reportCohortQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    departmentId: idSchema.optional(),
    batchId: idSchema.optional(),
    year: z.coerce.number().int().min(1).max(4).optional(),
    groupBy: z.enum(["department", "batch"]).optional(),
    indexed: z.enum(["true", "false"]).optional(),
    studentScope: z.enum(["current", "passout", "all"]).optional(),
    passoutYear: z.coerce.number().int().min(2000).max(2100).optional(),
    passoutCohortId: z.string().trim().optional(),
    dateRange: z.enum(["7d", "30d", "90d", "custom"]).optional(),
    dateFrom: z.string().trim().min(1).optional(),
    dateTo: z.string().trim().min(1).optional(),
  }).optional().default({}),
});

const reportStudentDetailDashboardSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    studentId: idSchema,
  }),
  query: z.object({
    testId: idSchema.optional(),
    year: z.coerce.number().int().min(1).max(4).optional(),
    studentScope: z.enum(["current", "passout", "all"]).optional(),
    passoutYear: z.coerce.number().int().min(2000).max(2100).optional(),
    passoutCohortId: z.string().trim().optional(),
    dateRange: z.enum(["7d", "30d", "90d", "custom"]).optional(),
    dateFrom: z.string().trim().min(1).optional(),
    dateTo: z.string().trim().min(1).optional(),
  }).optional().default({}),
});

module.exports = {
  idSchema,
  studentFiltersSchema,
  createStudentSchema,
  createBatchSchema,
  assignStudentsToBatchSchema,
  batchIdParamSchema,
  testAssignBatchSchema,
  testAssignDepartmentSchema,
  bulkBatchStudentsSchema,
  removeStudentFromBatchSchema,
  createEventSchema,
  updateEventSchema,
  eventIdParamSchema,
  cancelEventSchema,
  questionBankSchema,
  questionBankBulkImportSchema,
  questionBankQuerySchema,
  questionBankParamSchema,
  updateQuestionBankSchema,
  createSubjectSchema,
  generateReportSchema,
  reviewReportAnomalySchema,
  reportAnalyticsQuerySchema,
  reportJobStatusParamSchema,
  reportDashboardQuerySchema,
  reportTestsQuerySchema,
  reportTestScopedQuerySchema,
  reportCohortQuerySchema,
  reportStudentDetailDashboardSchema,
  assignStudentBatchSchema,
  studentIdParamSchema,
  studentBulkImportSchema,
  promoteStudentsYearSchema,
  studentBulkImportJobParamSchema,
  updateAdminSettingsSchema,
  changeAdminPasswordSchema,
};
