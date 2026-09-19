#!/usr/bin/env node

require("dotenv").config();

const dbClient = require("../src/config/db");
const { createSuperAdmin, toPublicSuperAdmin } = require("../src/services/super-admin.service");

const parseArgs = (argv) => {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [rawKey, ...rawValueParts] = item.slice(2).split("=");
    const key = rawKey.trim();
    const value = rawValueParts.join("=").trim();
    args[key] = value.replace(/^"|"$/g, "");
  }
  return args;
};

const run = async (argv = process.argv.slice(2), { db = dbClient } = {}) => {
  const args = parseArgs(argv);
  const name = args.name || args.fullName;
  const { email, password } = args;

  if (!name || !email || !password) {
    throw new Error("Usage: npm run create -- --name=\"Prionex Owner\" --email=\"owner@prionex.com\" --password=\"StrongPassword123!\"");
  }

  const superAdmin = await createSuperAdmin({
    db,
    name,
    email,
    password,
    bootstrapCreated: true,
  });

  const publicSuperAdmin = toPublicSuperAdmin(superAdmin);
  return {
    message: "SuperAdmin created successfully.",
    superAdmin: publicSuperAdmin,
  };
};

if (require.main === module) {
  run()
    .then(async (result) => {
      console.log(result.message);
      console.log(`Name: ${result.superAdmin.fullName}`);
      console.log(`Email: ${result.superAdmin.email}`);
      await dbClient.$disconnect();
    })
    .catch(async (error) => {
      console.error(error.code || "SUPER_ADMIN_CREATE_FAILED");
      console.error(error.message);
      await dbClient.$disconnect().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  run,
};
