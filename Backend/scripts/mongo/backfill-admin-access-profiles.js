require("dotenv").config();
const mongoose = require("mongoose");

const env = require("../../src/config/env");
const { ROLES, normalizeRole } = require("../../src/constants/roles");
const {
  ADMIN_ACCESS_PROFILES,
  resolvePermissionsForRole,
} = require("../../src/constants/admin-access-profiles");

const VALID_ROLES = new Set([ROLES.SUPER_ADMIN, ROLES.COLLEGE_ADMIN, ROLES.ADMIN]);

const run = async () => {
  if (!env.mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(env.mongoUri, {
    dbName: env.mongoDbName || undefined,
  });

  const database = mongoose.connection.db;
  const admins = database.collection("admin");
  const cursor = admins.find({});

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for await (const admin of cursor) {
    scanned += 1;

    const role = normalizeRole(admin.role);
    const updates = {};

    if (!VALID_ROLES.has(role)) {
      updates.role = ROLES.ADMIN;
    } else if (String(admin.role || "").trim().toUpperCase() !== role) {
      updates.role = role;
    }

    if (!admin.accessProfile) {
      updates.accessProfile = ADMIN_ACCESS_PROFILES.EDITOR;
    }

    if (!Array.isArray(admin.permissions) || admin.permissions.length === 0) {
      const profile = updates.accessProfile || admin.accessProfile || ADMIN_ACCESS_PROFILES.EDITOR;
      updates.permissions = resolvePermissionsForRole(updates.role, profile);
    }

    if (Object.keys(updates).length === 0) {
      skipped += 1;
      continue;
    }

    await admins.updateOne(
      { _id: admin._id },
      {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      }
    );
    updated += 1;
  }

  console.log(
    `Scanned ${scanned} admin record(s), updated ${updated}, skipped ${skipped}.`
  );
};

run()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });