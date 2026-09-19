const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const {
  createSystemAdminSchema,
  paginationQuerySchema,
  resetSystemAdminPasswordSchema,
  updateSystemAdminStatusSchema,
} = require("../../schemas/SuperAdmin/super-admin-core.schema");
const {
  createSystemAdmin,
  getSystemAdmins,
  resetSystemAdminPassword,
  updateSystemAdminStatus,
} = require("../../controllers/SuperAdmin/system-admins.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getSystemAdmins);
router.post("/", authenticateSuperAdmin, validate(createSystemAdminSchema), createSystemAdmin);
router.patch("/:superAdminId/status", authenticateSuperAdmin, validate(updateSystemAdminStatusSchema), updateSystemAdminStatus);
router.patch("/:superAdminId/reset-password", authenticateSuperAdmin, validate(resetSystemAdminPasswordSchema), resetSystemAdminPassword);

module.exports = router;
