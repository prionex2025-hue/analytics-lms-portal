const express = require("express");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { getAdminDashboard } = require("../../controllers/Admin/dashboard.controller");

const router = express.Router();

router.get("/summary", authenticatePlatformAdmin, getAdminDashboard);

module.exports = router;


