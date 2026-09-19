const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { createSubjectSchema } = require("../../schemas/Admin/admin-core.schema");
const { getSubjects, createSubject, deleteSubject } = require("../../controllers/SuperAdmin/subjects.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, getSubjects);
router.post("/", authenticateSuperAdmin, validate(createSubjectSchema), createSubject);
router.delete("/:id", authenticateSuperAdmin, deleteSubject);

module.exports = router;
