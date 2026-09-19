const express = require("express");
const { authenticate } = require("../../middleware/auth");
const { getSummary } = require("../../controllers/Students/dashboard.controller");

const router = express.Router();

router.get("/summary", authenticate, getSummary);

module.exports = router;
