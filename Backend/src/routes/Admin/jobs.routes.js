const express = require("express");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const { reportJobStatusParamSchema } = require("../../schemas/Admin/admin-core.schema");
const { getReportJobStatus } = require("../../controllers/Admin/reports.controller");

const router = express.Router();

router.get("/:reportJobId/status", authenticatePlatformAdmin, requirePermission("view_reports"), validate(reportJobStatusParamSchema), getReportJobStatus);

module.exports = router;


