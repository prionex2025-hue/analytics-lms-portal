const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { paginationQuerySchema, createCollegeSchema, updateCollegeSchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const { getColleges, getCollege, createCollege, updateCollege, deactivateCollege } = require("../../controllers/SuperAdmin/colleges.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getColleges);
router.get("/:collegeId", authenticateSuperAdmin, getCollege);
router.post("/", authenticateSuperAdmin, validate(createCollegeSchema), createCollege);
router.patch("/:collegeId", authenticateSuperAdmin, validate(updateCollegeSchema), updateCollege);
router.delete("/:collegeId", authenticateSuperAdmin, deactivateCollege);

module.exports = router;
