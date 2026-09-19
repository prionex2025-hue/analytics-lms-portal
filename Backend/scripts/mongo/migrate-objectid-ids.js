const mongoose = require("mongoose");
const env = require("../../src/config/env");

const COLLECTION_REFERENCE_FIELDS = {
  college: [],
  department: ["collegeId", "headId"],
  batch: ["collegeId", "departmentId"],
  admin: ["collegeId", "departmentId"],
  user: ["collegeId", "departmentId", "batchId"],
  student: ["collegeId", "departmentId", "batchId"],
  test: ["collegeId", "departmentId", "batchId", "createdByAdminId", "sourceTestId", "subjectId"],
  question: ["testId", "collegeId", "sourceQuestionId"],
  questionBank: ["createdByAdminId", "createdBySuperAdminId", "collegeId", "subjectId"],
  subject: ["collegeId", "createdByAdminId", "createdBySuperAdminId"],
  submission: ["userId", "testId", "collegeId"],
  answer: ["submissionId", "questionId"],
  violation: ["userId", "testId", "departmentId", "submissionId"],
  event: ["createdByAdminId", "collegeId"],
  studentRefreshToken: ["userId"],
  adminRefreshToken: ["adminId"],
  superAdminRefreshToken: ["superAdminId"],
  testSession: ["userId", "testId"],
  testBatch: ["testId", "batchId"],
  reportJob: ["collegeId", "adminId"],
  superReportJob: ["initiatedById"],
  platformSetting: ["updatedById"],
  auditLog: ["collegeId", "adminId", "superAdminId", "testId"],
  cloneMapping: ["sourceTestId", "clonedTestId", "targetCollegeId", "targetDepartmentId"],
  superAdmin: [],
};

const COLLECTION_ARRAY_REFERENCE_FIELDS = {
  student: ["batchIds"],
  test: ["assignedTo"],
};

const COLLECTIONS = Object.keys(COLLECTION_REFERENCE_FIELDS);

const isObjectIdString = (value) => typeof value === "string" && mongoose.Types.ObjectId.isValid(value.trim());

const toObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (isObjectIdString(value)) {
    return new mongoose.Types.ObjectId(String(value).trim());
  }

  return value;
};

const normalizeValue = (value, legacyMap) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, legacyMap));
  }

  if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof mongoose.Types.ObjectId)) {
    return value;
  }

  if (typeof value === "string") {
    if (legacyMap.has(value)) {
      return legacyMap.get(value);
    }

    const objectId = toObjectId(value);
    if (objectId instanceof mongoose.Types.ObjectId) {
      return objectId;
    }
  }

  return value;
};

const getValueSignature = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return `objectid:${value.toString()}`;
  }

  if (Array.isArray(value)) {
    return `array:[${value.map((item) => getValueSignature(item)).join("|")}]`;
  }

  return `${typeof value}:${String(value)}`;
};

async function buildLegacyMap(collection) {
  const map = new Map();
  const cursor = collection.find({ id: { $exists: true, $ne: null } }, { projection: { id: 1 } });

  for await (const doc of cursor) {
    if (doc.id) {
      map.set(String(doc.id), doc._id);
    }
  }

  return map;
}

async function migrateCollection(db, collectionName, legacyMap, dryRun) {
  const collection = db.collection(collectionName);
  const referenceFields = COLLECTION_REFERENCE_FIELDS[collectionName] || [];
  const arrayFields = COLLECTION_ARRAY_REFERENCE_FIELDS[collectionName] || [];
  const cursor = collection.find({});

  let inspected = 0;
  let updated = 0;

  for await (const doc of cursor) {
    inspected += 1;
    const set = {};
    const unset = {};

    if (Object.prototype.hasOwnProperty.call(doc, "id")) {
      unset.id = "";
    }

    for (const field of referenceFields) {
      if (!Object.prototype.hasOwnProperty.call(doc, field)) {
        continue;
      }

      const nextValue = normalizeValue(doc[field], legacyMap);
      if (getValueSignature(nextValue) !== getValueSignature(doc[field])) {
        set[field] = nextValue;
      }
    }

    for (const field of arrayFields) {
      if (!Array.isArray(doc[field])) {
        continue;
      }

      const nextValue = doc[field].map((item) => normalizeValue(item, legacyMap));
      if (getValueSignature(nextValue) !== getValueSignature(doc[field])) {
        set[field] = nextValue;
      }
    }

    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
      continue;
    }

    updated += 1;
    if (!dryRun) {
      await collection.updateOne(
        { _id: doc._id },
        {
          ...(Object.keys(set).length > 0 ? { $set: set } : {}),
          ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
        }
      );
    }
  }

  return { inspected, updated };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const uri = env.mongoUri;

  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(uri, {
    dbName: env.mongoDbName || undefined,
    maxPoolSize: 10,
  });

  const db = mongoose.connection.db;
  const legacyMaps = {};

  for (const collectionName of COLLECTIONS) {
    legacyMaps[collectionName] = await buildLegacyMap(db.collection(collectionName));
  }

  const summary = [];
  for (const collectionName of COLLECTIONS) {
    const result = await migrateCollection(db, collectionName, legacyMaps[collectionName], dryRun);
    summary.push({ collectionName, ...result });
  }

  console.log(JSON.stringify({ dryRun, summary }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exitCode = 1;
});
