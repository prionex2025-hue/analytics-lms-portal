const express = require("express");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const { createSubjectSchema } = require("../../schemas/Admin/admin-core.schema");
const { getSubjects, createSubject, deleteSubject } = require("../../controllers/Admin/subjects.controller");

const router = express.Router();

router.get("/", authenticatePlatformAdmin, requireAnyPermission("manage_questions", "view_question_bank"), getSubjects);
router.post("/", authenticatePlatformAdmin, requirePermission("manage_questions"), validate(createSubjectSchema), createSubject);
router.delete("/:id", authenticatePlatformAdmin, requirePermission("manage_questions"), deleteSubject);

module.exports = router;

