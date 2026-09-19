require("dotenv").config();
const mongoose = require("mongoose");

const env = require("../../src/config/env");

const VALID_VIOLATION_TYPES = new Set([
  "TAB_SWITCH",
  "COPY_PASTE",
  "RIGHT_CLICK",
  "WINDOW_BLUR",
  "FULLSCREEN_EXIT",
  "SCREENSHOT_ATTEMPT",
  "DEVTOOLS_OPEN",
]);

const isMissing = (value) => value === null || typeof value === "undefined" || value === "";

const toObjectIdIfValid = (value) => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  const text = String(value || "").trim();
  return mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : value;
};

const normalizeViolationType = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  return VALID_VIOLATION_TYPES.has(normalized) ? normalized : null;
};

const resolveViolationType = (violation) => {
  const firstLog = Array.isArray(violation.logs) ? violation.logs[0] : null;
  return normalizeViolationType(violation.type)
    || normalizeViolationType(violation.violationType)
    || normalizeViolationType(firstLog?.type);
};

const buildSubmissionLookup = (submissionId) => {
  const candidates = [submissionId, toObjectIdIfValid(submissionId)]
    .filter((item) => !isMissing(item));
  const unique = [...new Map(candidates.map((item) => [String(item), item])).values()];
  return unique.length === 1 ? { _id: unique[0] } : { _id: { $in: unique } };
};

const run = async () => {
  if (!env.mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(env.mongoUri, {
    dbName: env.mongoDbName || undefined,
  });

  const database = mongoose.connection.db;
  const violations = database.collection("violation");
  const submissions = database.collection("submission");
  const cursor = violations.find({
    $or: [
      { collegeId: { $exists: false } },
      { collegeId: null },
      { departmentId: { $exists: false } },
      { userId: { $exists: false } },
      { userId: null },
      { testId: { $exists: false } },
      { testId: null },
      { type: { $exists: false } },
      { type: null },
      { count: { $exists: false } },
      { count: null },
      { detectedAt: { $exists: false } },
      { detectedAt: null },
    ],
  });

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const violation = await cursor.next();
    scanned += 1;

    if (isMissing(violation.submissionId)) {
      skipped += 1;
      continue;
    }

    const submission = await submissions.findOne(
      buildSubmissionLookup(violation.submissionId),
      { projection: { userId: 1, testId: 1, collegeId: 1, departmentId: 1, createdAt: 1 } }
    );

    if (!submission) {
      skipped += 1;
      continue;
    }

    const type = resolveViolationType(violation);
    const logs = Array.isArray(violation.logs) ? violation.logs : [];
    const updates = {};

    if (isMissing(violation.userId)) updates.userId = submission.userId;
    if (isMissing(violation.testId)) updates.testId = submission.testId;
    if (isMissing(violation.collegeId)) updates.collegeId = submission.collegeId;
    if (isMissing(violation.departmentId) && !isMissing(submission.departmentId)) {
      updates.departmentId = submission.departmentId;
    }
    if (type && isMissing(violation.type)) updates.type = type;
    if (type && isMissing(violation.violationType)) updates.violationType = type;
    if (!Number.isFinite(Number(violation.count)) || Number(violation.count) <= 0) {
      updates.count = Math.max(1, logs.length);
    }
    if (isMissing(violation.detectedAt)) {
      updates.detectedAt = violation.createdAt || submission.createdAt || new Date();
    }
    if (type && logs.length === 0) {
      updates.logs = [{
        type,
        timestamp: updates.detectedAt,
        metadata: violation.metadata || null,
      }];
    }

    if (Object.keys(updates).length === 0) {
      continue;
    }

    await violations.updateOne(
      { _id: violation._id },
      {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      }
    );
    updated += 1;
  }

  console.log(`Scanned ${scanned} violation(s), updated ${updated}, skipped ${skipped}.`);
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
