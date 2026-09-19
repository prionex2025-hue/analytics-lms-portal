const { z } = require("zod");
const { validatePasswordPolicy } = require("../../services/super-admin.service");

const superAdminPasswordSchema = z.string().superRefine((password, ctx) => {
  const result = validatePasswordPolicy(password);
  if (!result.valid) {
    ctx.addIssue({
      code: "custom",
      message: `Password must contain ${result.failures.join(", ")}.`,
    });
  }
});

const superAdminLoginSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Invalid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    keepLoggedIn: z.boolean().optional().default(false),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const superAdminRefreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(10).optional(),
  }).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const superAdminForgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Invalid email"),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const superAdminResetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(32),
    password: superAdminPasswordSchema,
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

module.exports = {
  superAdminForgotPasswordSchema,
  superAdminLoginSchema,
  superAdminRefreshSchema,
  superAdminResetPasswordSchema,
};
