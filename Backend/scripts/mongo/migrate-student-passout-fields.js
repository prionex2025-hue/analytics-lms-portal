require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../../src/config/env");

// Safe migration: it never invents a passout year. With --apply it only
// copies already-present, authoritative passoutYear values and legacy terminal
// lifecycle state into the new fixed-month/two-value fields.
const run = async () => {
  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName || undefined });
  const students = mongoose.connection.db.collection("student");
  const [missingYear, legacyPassouts, activeWithYear, alreadyMigrated] = await Promise.all([
    students.countDocuments({ $or: [{ expectedPassoutYear: { $exists: false } }, { expectedPassoutYear: null }] }),
    students.countDocuments({ lifecycleStatus: { $in: ["ALUMNI", "GRADUATED"] }, passoutYear: { $gte: 2000, $lte: 2100 } }),
    students.countDocuments({ studentStatus: "ACTIVE", expectedPassoutYear: { $gte: 2000, $lte: 2100 } }),
    students.countDocuments({ studentStatus: { $in: ["ACTIVE", "PASSOUT"] }, expectedPassoutMonth: 3 }),
  ]);

  console.log(JSON.stringify({ missingExpectedPassoutYear: missingYear, legacyPassoutsWithVerifiedYear: legacyPassouts, activeStudentsWithExpectedYear: activeWithYear, alreadyMigrated }, null, 2));
  if (process.argv.includes("--apply")) {
    const passoutResult = await students.updateMany(
      { lifecycleStatus: { $in: ["ALUMNI", "GRADUATED"] }, passoutYear: { $gte: 2000, $lte: 2100 } },
      [{ $set: { studentStatus: "PASSOUT", expectedPassoutMonth: 3, expectedPassoutYear: "$passoutYear" } }]
    );
    const activeResult = await students.updateMany(
      { $or: [{ studentStatus: { $exists: false } }, { studentStatus: null }], lifecycleStatus: { $nin: ["ALUMNI", "GRADUATED"] }, expectedPassoutYear: { $gte: 2000, $lte: 2100 } },
      { $set: { studentStatus: "ACTIVE", expectedPassoutMonth: 3 } }
    );
    console.log(JSON.stringify({ applied: true, passoutMatched: passoutResult.matchedCount, activeMatched: activeResult.matchedCount }, null, 2));
  } else {
    console.log("Dry run only. Review missingExpectedPassoutYear and verify institutional records before rerunning with --apply.");
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect();
});
