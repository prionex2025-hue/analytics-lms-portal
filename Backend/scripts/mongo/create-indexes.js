require("dotenv").config();
const mongoose = require("mongoose");

const env = require("../../src/config/env");

const createIndexes = async () => {
  if (!env.mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(env.mongoUri, {
    dbName: env.mongoDbName || undefined,
  });

  const database = mongoose.connection.db;
  const isTextIndexSpec = (spec) => Object.values(spec || {}).some((value) => value === "text");
  const ensureIndex = async (collectionName, spec, options = {}) => {
    const collection = database.collection(collectionName);
    try {
      await collection.createIndex(spec, { background: true, ...options });
      return;
    } catch (error) {
      if (error?.code !== 85 || !isTextIndexSpec(spec)) {
        throw error;
      }

      const existingIndexes = await collection.indexes();
      const textIndexes = existingIndexes.filter((index) => index.key?._fts === "text");
      for (const index of textIndexes) {
        await collection.dropIndex(index.name);
        console.log(`Dropped legacy ${collectionName} text index ${index.name}`);
      }

      await collection.createIndex(spec, { background: true, ...options });
    }
  };

  const indexes = [
    ["testBatch", { batchId: 1, testId: 1 }],
    ["testBatch", { testId: 1, batchId: 1 }, { unique: true, name: "uniq_testBatch_test_batch" }],
    ["test", { collegeId: 1, status: 1 }],
    ["test", { collegeId: 1, assignmentMethod: 1, departmentId: 1 }],
    ["test", { collegeId: 1, departmentId: 1, status: 1 }],
    ["test", { collegeId: 1, batchId: 1 }],
    ["test", { collegeId: 1, createdAt: -1 }],
    ["test", { collegeId: 1, departmentId: 1, createdAt: -1 }],
    ["question", { testId: 1, order: 1 }],
    // MODULE_TEST module question fetch: filter by testId + category, ordered by order.
    ["question", { testId: 1, category: 1, order: 1 }],
    ["answer", { submissionId: 1, questionId: 1 }, { unique: true, name: "uniq_answer_submission_question" }],
    ["violation", { submissionId: 1, createdAt: -1 }],
    ["violation", { submissionId: 1, type: 1, createdAt: -1 }],
    ["violation", { userId: 1, testId: 1 }],
    ["violation", { collegeId: 1, testId: 1, createdAt: -1 }],
    ["violation", { collegeId: 1, userId: 1, createdAt: -1 }],
    ["submission", { collegeId: 1, testId: 1, status: 1 }],
    ["submission", { status: 1, collegeId: 1 }],
    ["submission", { collegeId: 1, userId: 1, submittedAt: -1 }],
    ["submission", { collegeId: 1, testId: 1, userId: 1 }],
    ["submission", { userId: 1, testId: 1, attemptNumber: 1 }, { unique: true, name: "uniq_submission_user_test_attempt" }],
    ["submission", { collegeId: 1, status: 1, submittedAt: -1 }],
    ["submission", { collegeId: 1, passoutCohortId: 1, status: 1, submittedAt: -1 }],
    ["submission", { collegeId: 1, passoutYear: 1, status: 1, submittedAt: -1 }],
    ["submission", { collegeId: 1, status: 1, createdAt: -1 }],
    ["submission", { collegeId: 1, departmentId: 1, submittedAt: -1 }],
    ["submission", { collegeId: 1, batchId: 1, submittedAt: -1 }],
    ["testSession", { userId: 1, testId: 1 }, { unique: true, name: "uniq_testSession_user_test" }],
    ["testSession", { submissionId: 1 }],
    ["studentRefreshToken", { tokenHash: 1 }, { unique: true, name: "uniq_studentRefreshToken_tokenHash", partialFilterExpression: { tokenHash: { $type: "string" } } }],
    ["studentRefreshToken", { token: 1 }, { unique: true, name: "uniq_studentRefreshToken_token", partialFilterExpression: { token: { $type: "string" } } }],
    ["studentRefreshToken", { userId: 1, revokedAt: 1, expiresAt: 1 }],
    ["adminRefreshToken", { tokenHash: 1 }, { unique: true, name: "uniq_adminRefreshToken_tokenHash", partialFilterExpression: { tokenHash: { $type: "string" } } }],
    ["adminRefreshToken", { token: 1 }, { unique: true, name: "uniq_adminRefreshToken_token", partialFilterExpression: { token: { $type: "string" } } }],
    ["adminRefreshToken", { adminId: 1, revokedAt: 1, expiresAt: 1 }],
    ["superAdminRefreshToken", { tokenHash: 1 }, { unique: true, name: "uniq_superAdminRefreshToken_tokenHash", partialFilterExpression: { tokenHash: { $type: "string" } } }],
    ["superAdminRefreshToken", { token: 1 }, { unique: true, name: "uniq_superAdminRefreshToken_token", partialFilterExpression: { token: { $type: "string" } } }],
    ["superAdminRefreshToken", { superAdminId: 1, revokedAt: 1, expiresAt: 1 }],
    ["superAdmin", { email: 1 }, { unique: true, name: "uniq_superAdmin_email", partialFilterExpression: { email: { $type: "string" } }, collation: { locale: "en", strength: 2 } }],
    ["superAdmin", { role: 1, isActive: 1 }],
    ["superAdmin", { createdAt: -1 }],
    ["passwordResetToken", { tokenHash: 1 }, { unique: true, name: "uniq_passwordResetToken_tokenHash" }],
    ["passwordResetToken", { scope: 1, principalId: 1, usedAt: 1, revokedAt: 1 }],
    ["passwordResetToken", { expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_passwordResetToken_expiresAt" }],
    ["admin", { collegeId: 1, role: 1, isActive: 1 }],
    ["admin", { collegeId: 1, departmentId: 1, role: 1 }],
    ["admin", { collegeId: 1, role: 1, createdAt: -1 }],
    ["admin", { collegeId: 1, email: 1 }],
    ["admin", { collegeId: 1, employeeId: 1 }],
    ["student", { collegeId: 1, departmentId: 1, isActive: 1 }],
    ["student", { isActive: 1, collegeId: 1 }],
    ["student", { collegeId: 1, lifecycleStatus: 1, passoutYear: -1 }],
    ["student", { collegeId: 1, lifecycleStatus: 1, isActive: 1, createdAt: -1 }],
    ["student", { collegeId: 1, passoutCohortId: 1, departmentId: 1 }],
    ["student", { collegeId: 1, createdAt: -1 }],
    ["student", { collegeId: 1, departmentId: 1, year: 1, createdAt: -1 }],
    ["student", { collegeId: 1, batchId: 1, createdAt: -1 }],
    ["student", { collegeId: 1, batchIds: 1 }],
    ["student", { collegeId: 1, email: 1 }],
    ["student", { collegeId: 1, studentId: 1 }],
    ["student", { collegeId: 1, enrollNumber: 1 }],
    ["studentStatusEvent", { studentId: 1, effectiveDate: -1 }],
    ["studentStatusEvent", { collegeId: 1, effectiveDate: -1 }],
    ["studentStatusEvent", { collegeId: 1, newStatus: 1, effectiveDate: -1 }],
    ["department", { collegeId: 1, name: 1 }],
    ["department", { collegeId: 1, isActive: 1, name: 1 }],
    ["batch", { collegeId: 1, departmentId: 1 }],
    ["batch", { collegeId: 1, departmentId: 1, year: 1, name: 1 }],
    ["batch", { collegeId: 1, year: 1, name: 1 }],
    ["batch", { collegeId: 1, status: 1, isArchived: 1 }],
    ["studentPassoutCohort", { collegeId: 1, passoutYear: -1, createdAt: -1 }],
    ["studentPassoutCohort", { collegeId: 1, status: 1, passoutYear: -1 }],
    ["event", { collegeId: 1, startsAt: 1 }],
    ["event", { collegeId: 1, eventDate: 1 }],
    ["event", { collegeId: 1, isCancelled: 1, startsAt: 1 }],
    ["reportJob", { collegeId: 1, type: 1, status: 1, createdAt: -1 }],
    ["reportJob", { collegeId: 1, adminId: 1, createdAt: -1 }],
    ["superReportJob", { "filters.collegeId": 1, status: 1, createdAt: -1 }],
    ["superReportJob", { initiatedById: 1, createdAt: -1 }],
    ["questionBank", { collegeId: 1, subjectId: 1, createdByAdminId: 1 }],
    ["resource", { collegeId: 1, subjectId: 1 }],
    ["resource", { title: "text", description: "text", tags: "text" }],
    ["resource", { tags: 1 }],
    ["resource", { visibilityScope: 1 }],
    ["resource", { collegeId: 1, visibilityScope: 1, isActive: 1, createdAt: -1 }],
    ["resourceView", { resourceId: 1, userId: 1 }],
    ["resourceView", { collegeId: 1, viewedAt: -1 }],
    ["resourceView", { departmentId: 1, viewedAt: -1 }],
    ["resourceDownload", { resourceId: 1, userId: 1 }],
    ["resourceDownload", { collegeId: 1, downloadedAt: -1 }],
    ["resourceDownload", { departmentId: 1, downloadedAt: -1 }],
  ];

  for (const [collectionName, spec, options = {}] of indexes) {
    await ensureIndex(collectionName, spec, options);
    console.log(`Ensured ${collectionName} index ${JSON.stringify(spec)} ${JSON.stringify(options)}`);
  }
};

createIndexes()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
