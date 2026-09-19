const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const {
	questionBankSchema,
	questionBankBulkImportSchema,
	questionBankQuerySchema,
	questionBankParamSchema,
	updateQuestionBankSchema,
} = require("../../schemas/Admin/admin-core.schema");
const {
	addQuestionBankItem,
	getQuestionBank,
	exportQuestionBankJson,
	importQuestionBankJson,
	updateQuestionBankItem,
	deleteQuestionBankItem,
} = require("../../controllers/SuperAdmin/question-bank.controller");

const router = express.Router();

const superAdminQuestionBankWriteLimiter = createRateLimiter({
	scope: "super-admin-question-bank-write",
	routeLabel: "/api/super-admin/question-bank/*",
	windowMs: env.rateLimit.adminEntityWriteWindowMs,
	max: env.rateLimit.adminEntityWriteMax,
	failOpen: false,
	message: "Question-bank write actions are rate limited. Please retry shortly.",
});

const superAdminQuestionBankBulkImportLimiter = createRateLimiter({
	scope: "super-admin-question-bank-bulk-import",
	routeLabel: "/api/super-admin/question-bank/import",
	windowMs: env.rateLimit.adminQuestionBankBulkImportWindowMs,
	max: env.rateLimit.adminQuestionBankBulkImportMax,
	failOpen: false,
	message: "Question-bank bulk import is rate limited. Please retry later.",
});

router.get("/", authenticateSuperAdmin, validate(questionBankQuerySchema), getQuestionBank);
router.post("/", authenticateSuperAdmin, superAdminQuestionBankWriteLimiter, validate(questionBankSchema), addQuestionBankItem);
router.post("/add", authenticateSuperAdmin, superAdminQuestionBankWriteLimiter, validate(questionBankSchema), addQuestionBankItem);
router.post("/bulk", authenticateSuperAdmin, superAdminQuestionBankBulkImportLimiter, superAdminQuestionBankWriteLimiter, validate(questionBankBulkImportSchema), importQuestionBankJson);
router.post("/import", authenticateSuperAdmin, superAdminQuestionBankBulkImportLimiter, superAdminQuestionBankWriteLimiter, validate(questionBankBulkImportSchema), importQuestionBankJson);
router.get("/export", authenticateSuperAdmin, exportQuestionBankJson);
router.put("/:id", authenticateSuperAdmin, superAdminQuestionBankWriteLimiter, validate(updateQuestionBankSchema), updateQuestionBankItem);
router.delete("/:id", authenticateSuperAdmin, superAdminQuestionBankWriteLimiter, validate(questionBankParamSchema), deleteQuestionBankItem);

module.exports = router;
