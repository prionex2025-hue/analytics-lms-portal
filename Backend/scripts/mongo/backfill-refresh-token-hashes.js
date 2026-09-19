require("dotenv").config();
const crypto = require("crypto");
const mongoose = require("mongoose");

const env = require("../../src/config/env");

const REFRESH_TOKEN_COLLECTIONS = [
  "studentRefreshToken",
  "adminRefreshToken",
  "superAdminRefreshToken",
];

const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");

const migrateCollection = async (database, collectionName) => {
  const collection = database.collection(collectionName);
  const cursor = collection.find({ token: { $type: "string", $ne: "" } });
  let updated = 0;

  for await (const record of cursor) {
    await collection.updateOne(
      { _id: record._id },
      {
        $set: {
          tokenHash: hashToken(record.token),
          updatedAt: new Date(),
        },
        $unset: { token: "" },
      }
    );
    updated += 1;
  }

  console.log(`Migrated ${updated} raw refresh tokens in ${collectionName}`);
};

const main = async () => {
  if (!env.mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(env.mongoUri, {
    dbName: env.mongoDbName || undefined,
  });

  const database = mongoose.connection.db;
  for (const collectionName of REFRESH_TOKEN_COLLECTIONS) {
    await migrateCollection(database, collectionName);
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
