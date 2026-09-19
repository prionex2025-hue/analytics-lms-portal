#!/usr/bin/env node

require("dotenv").config();

const dbClient = require("../src/config/db");
const { resetSuperAdminPasswordByEmail, toPublicSuperAdmin } = require("../src/services/super-admin.service");
const { parseArgs } = require("./create-superadmin");

const run = async (argv = process.argv.slice(2), { db = dbClient } = {}) => {
  const args = parseArgs(argv);
  const { email } = args;

  if (!email) {
    throw new Error("Usage: npm run reset -- --email=\"owner@prionex.com\"");
  }

  const { superAdmin, temporaryPassword } = await resetSuperAdminPasswordByEmail({
    db,
    email,
  });

  return {
    message: "SuperAdmin password reset successfully.",
    superAdmin: toPublicSuperAdmin(superAdmin),
    temporaryPassword,
  };
};

if (require.main === module) {
  run()
    .then(async (result) => {
      console.log(result.message);
      console.log(`Email: ${result.superAdmin.email}`);
      console.log(`Temporary password: ${result.temporaryPassword}`);
      await dbClient.$disconnect();
    })
    .catch(async (error) => {
      console.error(error.code || "SUPER_ADMIN_PASSWORD_RESET_FAILED");
      console.error(error.message);
      await dbClient.$disconnect().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  run,
};
