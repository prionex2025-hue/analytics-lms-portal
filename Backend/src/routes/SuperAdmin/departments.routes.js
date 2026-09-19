const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const {
	paginationQuerySchema,
	createDepartmentSchema,
	updateDepartmentSchema,
	deleteDepartmentSchema,
	bulkImportDepartmentsSchema,
} = require("../../schemas/SuperAdmin/super-admin-core.schema");
const {
	getDepartmentsGlobal,
	createDepartmentGlobal,
	updateDepartmentGlobal,
	deleteDepartmentGlobal,
	bulkImportDepartmentsGlobal,
} = require("../../controllers/SuperAdmin/departments.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getDepartmentsGlobal);
router.post("/", authenticateSuperAdmin, validate(createDepartmentSchema), createDepartmentGlobal);
router.post("/bulk-import", authenticateSuperAdmin, validate(bulkImportDepartmentsSchema), bulkImportDepartmentsGlobal);
router.patch("/:departmentId", authenticateSuperAdmin, validate(updateDepartmentSchema), updateDepartmentGlobal);
router.delete("/:departmentId", authenticateSuperAdmin, validate(deleteDepartmentSchema), deleteDepartmentGlobal);

module.exports = router;
