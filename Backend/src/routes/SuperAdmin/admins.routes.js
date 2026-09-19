const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const {
	paginationQuerySchema,
	createAdminSchema,
	updateAdminSchema,
	resetAdminPasswordSchema,
	deactivateAdminSchema,
	bulkImportAdminsSchema,
} = require("../../schemas/SuperAdmin/super-admin-core.schema");
const {
	getAdmins,
	createAdmin,
	updateAdmin,
	resetAdminPassword,
	deleteAdmin,
	bulkImportAdmins,
} = require("../../controllers/SuperAdmin/admins.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getAdmins);
router.post("/", authenticateSuperAdmin, validate(createAdminSchema), createAdmin);
router.post("/bulk-import", authenticateSuperAdmin, validate(bulkImportAdminsSchema), bulkImportAdmins);
router.patch("/:adminId", authenticateSuperAdmin, validate(updateAdminSchema), updateAdmin);
router.patch("/:adminId/reset-password", authenticateSuperAdmin, validate(resetAdminPasswordSchema), resetAdminPassword);
router.delete("/:adminId", authenticateSuperAdmin, validate(deactivateAdminSchema), deleteAdmin);

module.exports = router;
