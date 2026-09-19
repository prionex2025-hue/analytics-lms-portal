const { z } = require("zod");
const mongoose = require("mongoose");

const idSchema = z.string().trim().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "Invalid id format",
});

const managedAdminListQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().optional(),
    status: z.enum(["active", "inactive", "all"]).optional().default("all"),
    departmentId: idSchema.optional(),
  }).optional().default({}),
});

const createManagedAdminSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2),
    email: z.string().trim().email(),
    employeeId: z.string().trim().min(3),
    password: z.string().min(8),
    departmentId: idSchema,
    accessProfile: z.enum(["VIEW_ONLY", "EDITOR"]).default("EDITOR"),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const updateManagedAdminSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).optional(),
    departmentId: idSchema.optional(),
    isActive: z.boolean().optional(),
    accessProfile: z.enum(["VIEW_ONLY", "EDITOR"]).optional(),
  }).refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  }),
  params: z.object({
    adminId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const resetManagedAdminPasswordSchema = z.object({
  body: z.object({
    password: z.string().min(8),
  }),
  params: z.object({
    adminId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const deactivateManagedAdminSchema = z.object({
  body: z.object({
    confirmationText: z.string().trim().min(1),
  }),
  params: z.object({
    adminId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const createScopedDepartmentSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const updateScopedDepartmentSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).optional(),
    isActive: z.boolean().optional(),
  }).refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  }),
  params: z.object({
    departmentId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const deleteScopedDepartmentSchema = z.object({
  body: z.object({
    confirmationText: z.string().trim().min(1),
  }),
  params: z.object({
    departmentId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

module.exports = {
  managedAdminListQuerySchema,
  createManagedAdminSchema,
  updateManagedAdminSchema,
  resetManagedAdminPasswordSchema,
  deactivateManagedAdminSchema,
  createScopedDepartmentSchema,
  updateScopedDepartmentSchema,
  deleteScopedDepartmentSchema,
};
