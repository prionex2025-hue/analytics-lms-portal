const { z } = require("zod");

const paramsWithTestId = z.object({
  testId: z.string().min(1),
});

const optionalClientSessionId = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .optional();

const violationTypeSchema = z.enum([
  "TAB_SWITCH",
  "COPY_PASTE",
  "RIGHT_CLICK",
  "WINDOW_BLUR",
  "FULLSCREEN_EXIT",
  "SCREENSHOT_ATTEMPT",
  "DEVTOOLS_OPEN",
]);

const startTestSchema = z.object({
  body: z.object({
    clientSessionId: optionalClientSessionId,
    agreedToInstructions: z.boolean().optional(),
  }).optional().default({}),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const agreeInstructionsSchema = z.object({
  body: z.object({
    agreed: z.literal(true),
  }),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const saveAnswerSchema = z.object({
  body: z.object({
    submissionId: z.string().min(1),
    questionId: z.string().min(1),
    selectedOption: z.string().optional().nullable(),
    selectedOptions: z.array(z.string()).optional().nullable(),
    answerText: z.string().optional().nullable(),
    answerBoolean: z.boolean().optional().nullable(),
    markedForReview: z.boolean().optional(),
    clientSessionId: optionalClientSessionId,
  }),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const saveAnswerCompatSchema = z.object({
  body: z.object({
    testId: z.string().min(1),
    submissionId: z.string().min(1),
    questionId: z.string().min(1),
    selectedOption: z.string().optional().nullable(),
    selectedOptions: z.array(z.string()).optional().nullable(),
    answerText: z.string().optional().nullable(),
    answerBoolean: z.boolean().optional().nullable(),
    markedForReview: z.boolean().optional(),
    clientSessionId: optionalClientSessionId,
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const attemptAnswerCompatItemSchema = z.object({
  questionId: z.string().min(1).optional(),
  question_id: z.string().min(1).optional(),
  selectedOption: z.string().optional().nullable(),
  selected_option: z.string().optional().nullable(),
  selectedOptions: z.array(z.string()).optional().nullable(),
  selected_options: z.array(z.string()).optional().nullable(),
  answerText: z.string().optional().nullable(),
  answer_text: z.string().optional().nullable(),
  answerBoolean: z.boolean().optional().nullable(),
  answer_boolean: z.boolean().optional().nullable(),
  markedForReview: z.boolean().optional(),
  marked_for_review: z.boolean().optional(),
  timeSpentSeconds: z.number().nonnegative().optional(),
  time_spent_seconds: z.number().nonnegative().optional(),
}).passthrough().refine((value) => value.questionId || value.question_id, {
  message: "questionId is required",
});

const attemptAnswersCompatSchema = z.object({
  body: z.object({
    answers: z.array(attemptAnswerCompatItemSchema).min(1).max(500),
  }),
  params: z.object({
    attemptId: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
});

const submitSchema = z.object({
  body: z.object({
    submissionId: z.string().min(1),
    reason: z.string().trim().max(80).optional(),
    fromModuleKey: z.string().trim().max(40).optional(),
    clientSessionId: optionalClientSessionId,
  }),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const submitCompatSchema = z.object({
  body: z.object({
    testId: z.string().min(1),
    submissionId: z.string().min(1),
    reason: z.string().trim().max(80).optional(),
    fromModuleKey: z.string().trim().max(40).optional(),
    clientSessionId: optionalClientSessionId,
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

// MODULE_TEST: submit the current module and advance (completing on the last).
const advanceModuleSchema = z.object({
  body: z.object({
    submissionId: z.string().min(1),
    fromModuleKey: z.string().trim().max(40).optional(),
    clientSessionId: optionalClientSessionId,
  }),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const advanceModuleCompatSchema = z.object({
  body: z.object({
    fromModuleKey: z.string().trim().max(40).optional(),
    clientSessionId: optionalClientSessionId,
  }).optional().default({}),
  params: z.object({
    attemptId: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
});

const violationSchema = z.object({
  body: z.object({
    submissionId: z.string().min(1),
    type: violationTypeSchema,
    metadata: z.record(z.any()).optional(),
    clientSessionId: optionalClientSessionId,
  }),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const heartbeatSchema = z.object({
  body: z.object({
    submissionId: z.string().min(1),
    clientSessionId: optionalClientSessionId,
  }),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const attemptIdParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    attemptId: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
});

const heartbeatCompatSchema = z.object({
  body: z.object({
    clientSessionId: optionalClientSessionId,
  }).optional().default({}),
  params: z.object({
    attemptId: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
});

const submitAttemptCompatSchema = z.object({
  body: z.object({
    reason: z.string().trim().max(80).optional(),
    fromModuleKey: z.string().trim().max(40).optional(),
    clientSessionId: optionalClientSessionId,
  }).optional().default({}),
  params: z.object({
    attemptId: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
});

const violationCompatSchema = z.object({
  body: z.object({
    type: violationTypeSchema,
    metadata: z.record(z.any()).optional(),
    clientSessionId: optionalClientSessionId,
  }),
  params: z.object({
    attemptId: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
});

const testIdOnlySchema = z.object({
  body: z.object({}).optional().default({}),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const attemptIdOnlySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    attemptId: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
});

module.exports = {
  startTestSchema,
  agreeInstructionsSchema,
  saveAnswerSchema,
  saveAnswerCompatSchema,
  attemptAnswersCompatSchema,
  submitSchema,
  submitCompatSchema,
  advanceModuleSchema,
  advanceModuleCompatSchema,
  violationSchema,
  heartbeatSchema,
  heartbeatCompatSchema,
  submitAttemptCompatSchema,
  violationCompatSchema,
  testIdOnlySchema,
  attemptIdOnlySchema,
  attemptIdParamSchema,
};
