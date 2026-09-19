const { z } = require("zod");

const loginSchema = z.object({
  body: z.object({
    identifier: z.string().min(3).optional(),
    email: z.string().trim().email().optional(),
    password: z.string().min(7),
    keepLoggedIn: z.boolean().optional().default(false),
    role: z.enum(["SUPER_ADMIN"]).optional(),
  }).refine((body) => Boolean(body.identifier || body.email), {
    message: "identifier or email is required",
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(10).optional(),
  }).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const forgotPasswordSchema = z.object({
  body: z.object({
    identifier: z.string().min(3).optional(),
    email: z.string().trim().email().optional(),
  }).refine((body) => Boolean(body.identifier || body.email), {
    message: "identifier or email is required",
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(32),
    password: z.string().min(8, "Password must be at least 8 characters"),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

module.exports = {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
};
