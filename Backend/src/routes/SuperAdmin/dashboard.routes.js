const express = require("express");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { getSuperAdminDashboard } = require("../../controllers/SuperAdmin/dashboard.controller");

const router = express.Router();

router.get("/summary", authenticateSuperAdmin, getSuperAdminDashboard);

module.exports = router;
