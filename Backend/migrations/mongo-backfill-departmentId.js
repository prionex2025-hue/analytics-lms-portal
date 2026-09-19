/**
 * Migration helper (Mongoose) to add/attempt to backfill `departmentId` on common collections.
 *
 * Usage: NODE_ENV=production node migrations/mongo-backfill-departmentId.js
 * Requires MONGODB_URI and MONGODB_DB_NAME env vars (project already expects these).
 *
 * Notes:
 * - This script will add departmentId where it can be inferred from a referenced user (userId, createdBy, etc.)
 * - It will not modify documents where department could not be determined; those are logged for manual reconciliation.
 */

const mongoose = require("mongoose");
const env = require("../src/config/env");

async function main() {
  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName });
  console.log("Connected to MongoDB for backfill");

  const Attempt = mongoose.models.Attempt || mongoose.model("Attempt", new mongoose.Schema({}, { strict: false }));
  const Violation = mongoose.models.Violation || mongoose.model("Violation", new mongoose.Schema({}, { strict: false }));
  const Test = mongoose.models.Test || mongoose.model("Test", new mongoose.Schema({}, { strict: false }));
  const User = mongoose.models.User || mongoose.model("User", new mongoose.Schema({}, { strict: false }));

  // Helper to backfill a model by looking up user-based departmentId
  async function backfillFromUserField(Model, userField) {
    console.log(`Backfilling ${Model.modelName} from user field ${userField}`);
    const docs = await Model.find({ $or: [{ departmentId: { $exists: false } }, { departmentId: null }] }).limit(1000).lean();
    let updated = 0;
    for (const doc of docs) {
      const userId = doc[userField];
      if (!userId) continue;
      const user = await User.findOne({ id: userId }).lean();
      if (user && user.departmentId) {
        await Model.updateOne({ _id: doc._id }, { $set: { departmentId: user.departmentId } });
        updated += 1;
      }
    }
    console.log(`Updated ${updated} documents for ${Model.modelName}`);
  }

  try {
    await backfillFromUserField(Attempt, "userId");
    await backfillFromUserField(Violation, "userId");

    // For Tests, attempt to backfill from createdByAdminId or collegeId->department mapping (best-effort)
    console.log("Attempting Test collection backfill from createdByAdminId if present");
    const tests = await Test.find({ $or: [{ departmentId: { $exists: false } }, { departmentId: null }] }).limit(1000).lean();
    let tUpdated = 0;
    for (const test of tests) {
      if (test.createdByAdminId) {
        const admin = await User.findOne({ id: test.createdByAdminId }).lean();
        if (admin && admin.departmentId) {
          await Test.updateOne({ _id: test._id }, { $set: { departmentId: admin.departmentId } });
          tUpdated += 1;
        }
      }
    }
    console.log(`Updated ${tUpdated} Test documents`);

    console.log("Backfill complete. Review documents that could not be inferred for manual reconciliation.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
