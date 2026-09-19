#!/usr/bin/env node

require("dotenv").config();

const dbClient = require("../src/config/db");
const { verifySuperAdminState } = require("../src/services/super-admin.service");

const run = async ({ db = dbClient } = {}) => verifySuperAdminState({ db });

if (require.main === module) {
  run()
    .then(async (result) => {
      console.log(`Total SuperAdmins: ${result.totalSuperAdmins}`);
      console.log(`Active SuperAdmins: ${result.activeSuperAdmins}`);
      console.log(`Inactive SuperAdmins: ${result.inactiveSuperAdmins}`);
      if (!result.valid) {
        console.error(`Verification failed: ${result.violations.join(", ")}`);
        process.exitCode = 1;
      } else {
        console.log("Verification passed.");
      }
      await dbClient.$disconnect();
    })
    .catch(async (error) => {
      console.error(error.code || "SUPER_ADMIN_VERIFY_FAILED");
      console.error(error.message);
      await dbClient.$disconnect().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  run,
};
