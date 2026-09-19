const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const dbClient = require("../config/db");

let initialized = false;

async function init() {
  if (initialized) {
    return buildModelMap();
  }

  // Require all schema files in this folder and the `validation` subfolder
  const dir = __dirname;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === "index.js") continue;
    const full = path.join(dir, f);
    if (fs.statSync(full).isFile() && f.endsWith(".js")) {
      require(full);
    }
  }

  const valDir = path.join(dir, "validation");
  if (fs.existsSync(valDir)) {
    const vfiles = fs.readdirSync(valDir);
    for (const vf of vfiles) {
      if (vf.endsWith(".js")) {
        require(path.join(valDir, vf));
      }
    }
  }

  initialized = true;
  return buildModelMap();
}

function buildModelMap() {
  return {
    mongoose,
    // Expose common mongoose-style models (if registered) and the db client wrappers
    // Uppercase convenience names used across the codebase
    Student: dbClient.student,
    User: dbClient.user,
    StudentRefreshToken: dbClient.studentRefreshToken,
    SuperAdminRefreshToken: dbClient.superAdminRefreshToken,
    PasswordResetToken: dbClient.passwordResetToken,
    Admin: dbClient.admin,
    College: dbClient.college,
    Department: dbClient.department,
    Batch: dbClient.batch,
    Test: dbClient.test,
    Question: dbClient.question,
    QuestionBank: dbClient.questionBank,
    Subject: dbClient.subject,
    Resource: dbClient.resource,
    ResourceView: dbClient.resourceView,
    ResourceDownload: dbClient.resourceDownload,
    Submission: dbClient.submission,
    Answer: dbClient.answer,
    Violation: dbClient.violation,
    StudentPassoutCohort: dbClient.studentPassoutCohort,
    // Keep raw dbClient available for direct access
    dbClient,
  };
}

module.exports = { init };
