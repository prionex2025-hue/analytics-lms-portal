const crypto = require("node:crypto");
const mongoose = require("mongoose");

const BUCKET_NAME = "reportPayloads";

const getBucket = () => {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("MongoDB connection is not ready for report payload storage");
  }
  return new mongoose.mongo.GridFSBucket(database, { bucketName: BUCKET_NAME });
};

const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });

const deleteExistingPayloads = async ({ scope, jobId }) => {
  const bucket = getBucket();
  const files = await mongoose.connection.db
    .collection(`${BUCKET_NAME}.files`)
    .find({ "metadata.scope": scope, "metadata.jobId": jobId })
    .project({ _id: 1 })
    .toArray();

  await Promise.all(files.map((file) => bucket.delete(file._id).catch(() => {})));
};

const saveReportPayload = async ({ scope, jobId, payload }) => {
  if (!scope || !jobId) {
    throw new Error("scope and jobId are required to save report payload");
  }

  await deleteExistingPayloads({ scope, jobId });

  const bucket = getBucket();
  const payloadId = crypto.randomUUID();
  const uploadStream = bucket.openUploadStream(`${scope}-${jobId}-${payloadId}.json`, {
    metadata: {
      scope,
      jobId,
      payloadId,
      contentType: "application/json",
      createdAt: new Date(),
    },
  });

  await new Promise((resolve, reject) => {
    uploadStream.on("error", reject);
    uploadStream.on("finish", resolve);
    uploadStream.end(Buffer.from(JSON.stringify(payload || {}), "utf8"));
  });

  return {
    bucket: BUCKET_NAME,
    fileId: String(uploadStream.id),
    payloadId,
    scope,
    jobId,
  };
};

const readReportPayload = async (ref) => {
  if (!ref?.fileId) {
    return null;
  }

  const bucket = getBucket();
  const buffer = await streamToBuffer(bucket.openDownloadStream(new mongoose.Types.ObjectId(ref.fileId)));
  return JSON.parse(buffer.toString("utf8") || "{}");
};

module.exports = {
  saveReportPayload,
  readReportPayload,
};
