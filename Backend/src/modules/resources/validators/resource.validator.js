const { z } = require("zod");
const mongoose = require("mongoose");
const { RESOURCE_TYPES, VISIBILITY_SCOPES } = require("../constants");

const idSchema = z.string().trim().refine((value) => mongoose.Types.ObjectId.isValid(value), "Invalid id format");

const resourceParamSchema = z.object({
  body: z.any().optional(),
  params: z.object({
    id: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const resourceQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    q: z.string().trim().max(120).optional(),
    search: z.string().trim().max(120).optional(),
    subjectId: idSchema.optional(),
    subject: z.string().trim().max(120).optional(),
    resourceType: z.enum(Object.values(RESOURCE_TYPES)).optional(),
    visibilityScope: z.enum(Object.values(VISIBILITY_SCOPES)).optional(),
    tags: z.string().trim().max(300).optional(),
    collegeId: idSchema.optional(),
    includeInactive: z.enum(["true", "false"]).optional(),
    cursor: idSchema.optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sortBy: z.enum(["createdAt", "updatedAt", "title", "downloadCount", "viewCount"]).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  }).optional().default({}),
});

const createSubjectSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

module.exports = {
  idSchema,
  resourceParamSchema,
  resourceQuerySchema,
  createSubjectSchema,
};
