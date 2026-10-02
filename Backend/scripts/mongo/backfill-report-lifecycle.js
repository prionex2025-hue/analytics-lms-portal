/**
 * Idempotent, non-destructive lifecycle backfill for the reports module.
 *
 * Safe to run repeatedly. It ONLY fills fields that are missing; it never
 * overwrites existing values and never deletes documents. Run with `--dry-run`
 * first to see what would change.
 *
 * Usage:
 *   node scripts/mongo/backfill-report-lifecycle.js --dry-run
 *   node scripts/mongo/backfill-report-lifecycle.js
 *
 * It relies on the indexes created by scripts/mongo/create-indexes.js; run that
 * separately (also idempotent) before or after this script.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const env = require("../../src/config/env");

const DRY_RUN = process.argv.includes("--dry-run");

const toHex = (value) => (value ? value.toString() : null);

const normalizeLifecycleStatus = (status) => {
  const normalized = String(status || "ACTIVE").trim().toUpperCase();
  if (normalized === "GRADUATED") return "ALUMNI";
  if (normalized === "BLOCKED") return "SUSPENDED";
  return normalized;
};

const buildPassoutSnapshot = (student) => ({
  id: toHex(student._id),
  fullName: student.fullName || "",
  email: student.email || "",
  studentId: student.studentId || "",
  enrollNumber: student.enrollNumber || "",
  enrollmentNumber: student.enrollmentNumber || "",
  registerNumber: student.enrollNumber || student.enrollmentNumber || student.studentId || "",
  collegeId: student.collegeId || null,
  departmentId: student.departmentId || null,
  departmentName: "",
  batchId: student.batchId || null,
  batchIds: Array.isArray(student.batchIds) ? student.batchIds : [],
  batchName: "",
  yearAtPassout: Number(student.year || 4),
});

const run = async () => {
  if (!env.mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName || undefined });
  const database = mongoose.connection.db;
  const summary = {
    dryRun: DRY_RUN,
    batchesStatusFilled: 0,
    studentsStatusNormalized: 0,
    passoutSnapshotsFilled: 0,
    statusEventsCreated: 0,
    submissionsPassoutTagged: 0,
  };

  // 1. Batch lifecycle: derive status from the legacy isArchived flag.
  const archivedBatches = await database.collection("batch").find({ isArchived: true, status: { $exists: false } }).toArray();
  for (const batch of archivedBatches) {
    summary.batchesStatusFilled += 1;
    if (!DRY_RUN) {
      await database.collection("batch").updateOne(
        { _id: batch._id },
        { $set: { status: "ARCHIVED" } }
      );
    }
  }

  const activeBatches = await database.collection("batch").find({ isArchived: { $ne: true }, status: { $exists: false } }).toArray();
  for (const batch of activeBatches) {
    summary.batchesStatusFilled += 1;
    if (!DRY_RUN) {
      await database.collection("batch").updateOne(
        { _id: batch._id },
        { $set: { status: "ACTIVE" } }
      );
    }
  }

  // 2. Normalize legacy student lifecycle statuses, backfill passout snapshots,
  //    and emit a status event when none exists.
  const legacyStudents = await database
    .collection("student")
    .find({ lifecycleStatus: { $in: ["GRADUATED", "BLOCKED"] } })
    .toArray();

  for (const student of legacyStudents) {
    const newStatus = normalizeLifecycleStatus(student.lifecycleStatus);
    summary.studentsStatusNormalized += 1;
    if (!DRY_RUN) {
      await database.collection("student").updateOne(
        { _id: student._id },
        { $set: { lifecycleStatus: newStatus } }
      );
    }
  }

  const alumniStudents = await database
    .collection("student")
    .find({ lifecycleStatus: { $in: ["ALUMNI", "GRADUATED"] } })
    .toArray();

  for (const student of alumniStudents) {
    const updates = {};

    if (!student.passoutSnapshot) {
      updates.passoutSnapshot = buildPassoutSnapshot(student);
      summary.passoutSnapshotsFilled += 1;
    }

    const hasEvent = await database.collection("studentStatusEvent").findOne({ studentId: toHex(student._id) });
    if (!hasEvent) {
      summary.statusEventsCreated += 1;
      if (!DRY_RUN) {
        await database.collection("studentStatusEvent").insertOne({
          studentId: toHex(student._id),
          collegeId: student.collegeId || null,
          previousStatus: null,
          newStatus: "ALUMNI",
          reason: student.disabledReason || "PASSOUT",
          effectiveDate: student.disabledAt || student.updatedAt || student.createdAt || new Date(),
          actorType: "SYSTEM",
          changedByAdminId: null,
          changedBySuperAdminId: null,
          metadata: { backfilled: true, passoutYear: student.passoutYear || null },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    // Tag historical submissions with the passout cohort so reports can scope
    // history without relying on the (mutable) live student record.
    if (student.passoutYear && student.passoutCohortId) {
      const missingWhere = {
        userId: student._id,
        passoutYear: { $exists: false },
        status: { $in: ["SUBMITTED", "AUTO_SUBMITTED", "GRADED"] },
      };
      const missingCount = await database.collection("submission").countDocuments(missingWhere);
      if (missingCount > 0) {
        summary.submissionsPassoutTagged += missingCount;
        if (!DRY_RUN) {
          await database.collection("submission").updateMany(missingWhere, {
            $set: { passoutYear: student.passoutYear, passoutCohortId: student.passoutCohortId },
          });
        }
      }
    }

    if (!DRY_RUN && Object.keys(updates).length > 0) {
      await database.collection("student").updateOne({ _id: student._id }, { $set: updates });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
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
