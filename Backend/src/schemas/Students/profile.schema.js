const { z } = require("zod");

const emptyParams = z.object({}).optional().default({});
const emptyQuery = z.object({}).optional().default({});

// Same policy as password reset (min 8); upper bound keeps bcrypt input sane
// (bcrypt only uses the first 72 bytes anyway).
const newPasswordSchema = z.string().min(8, "Password must be at least 8 characters").max(128);
const currentPasswordSchema = z.string().min(1).max(128);

const updateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(20).regex(/^[0-9+()\-\s]*$/, "Invalid phone number").nullable().optional(),
  }),
  params: emptyParams,
  query: emptyQuery,
});

// The client sends snake_case; older clients send camelCase. Accept both.
const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: currentPasswordSchema.optional(),
      current_password: currentPasswordSchema.optional(),
      newPassword: newPasswordSchema.optional(),
      new_password: newPasswordSchema.optional(),
    })
    .refine((body) => Boolean(body.currentPassword ?? body.current_password), {
      message: "Current password is required",
    })
    .refine((body) => Boolean(body.newPassword ?? body.new_password), {
      message: "New password is required",
    }),
  params: emptyParams,
  query: emptyQuery,
});

// Preferences are a small flat map of UI settings (theme, notifications...).
const preferenceValueSchema = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);
const preferencesObjectSchema = z
  .record(z.string().max(64), preferenceValueSchema)
  .refine((value) => Object.keys(value).length <= 50, { message: "Too many preferences" });

const updatePreferencesSchema = z.object({
  body: z.object({
    preferences: preferencesObjectSchema,
  }),
  params: emptyParams,
  query: emptyQuery,
});

const accountDeletionSchema = z.object({
  body: z
    .object({
      currentPassword: currentPasswordSchema.optional(),
      current_password: currentPasswordSchema.optional(),
    })
    .optional()
    .default({}),
  params: emptyParams,
  query: emptyQuery,
});

module.exports = {
  updateProfileSchema,
  changePasswordSchema,
  updatePreferencesSchema,
  accountDeletionSchema,
};
