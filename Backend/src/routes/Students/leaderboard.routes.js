const express = require("express");
const env = require("../../config/env");
const { authenticate } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { getLeaderboard } = require("../../controllers/Students/leaderboard.controller");

const router = express.Router();

const leaderboardLimiter = createRateLimiter({
  scope: "student-leaderboard",
  routeLabel: "/api/leaderboard",
  windowMs: env.rateLimit.leaderboardWindowMs,
  max: env.rateLimit.leaderboardMax,
  message: "Leaderboard is rate limited. Please wait a moment and retry.",
});

router.get("/", authenticate, leaderboardLimiter, getLeaderboard);

module.exports = router;
