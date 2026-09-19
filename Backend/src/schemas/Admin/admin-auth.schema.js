const { z } = require("zod");

const adminLoginSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    keepLoggedIn: z.boolean().optional().default(false),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const adminRefreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(10).optional(),
  }).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const adminForgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Invalid email"),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const adminResetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(32),
    password: z.string().min(8, "Password must be at least 8 characters"),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

module.exports = {
  adminForgotPasswordSchema,
  adminLoginSchema,
  adminRefreshSchema,
  adminResetPasswordSchema,
};
