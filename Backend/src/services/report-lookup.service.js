const mongoose = require("mongoose");
const { toObjectIdIfValid } = require("../utils/analytics-aggregation");

/**
 * Batched lookups for report endpoints.
 *
 * The db wrapper resolves `include` / relation `select` / `_count` with one
 * query per row, which turns a 15k-submission report into 15k+ round-trips.
 * These helpers fetch the same data with one query per relation (or per
 * 5k-id chunk), so report endpoints make a constant number of queries.
 */

const ID_CHUNK_SIZE = 5000;

const uniqueIds = (values) => [...new Set((values || []).filter(Boolean).map(String))];

const chunk = (items, size = ID_CHUNK_SIZE) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// Violations may carry submissionId as an ObjectId or (legacy) as a string.
const idVariants = (ids) => ids.flatMap((id) => {
  const objectId = toObjectIdIfValid(id);
  return objectId instanceof mongoose.Types.ObjectId ? [objectId, id] : [id];
});

// Map id -> { id, name } for the given model (department, batch, college...).
const loadNamesById = async (db, model, ids) => {
  const wanted = uniqueIds(ids);
  if (wanted.length === 0) return new Map();
  const rows = await db[model].findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [String(row.id), row]));
};

// Attach { department, batch, college } name objects to scalar student rows,
// replacing `include: { department, batch, college }` (3 queries per student).
const attachStudentGroups = async (db, students, { college = false } = {}) => {
  // Students may be assigned through batchIds[] only; use the first as primary.
  const primaryBatchId = (student) => student.batchId || (Array.isArray(student.batchIds) ? student.batchIds[0] : null);
  const [departments, batches, colleges] = await Promise.all([
    loadNamesById(db, "department", students.map((student) => student.departmentId)),
    loadNamesById(db, "batch", students.map(primaryBatchId)),
    college ? loadNamesById(db, "college", students.map((student) => student.collegeId)) : new Map(),
  ]);
  return students.map((student) => ({
    ...student,
    department: departments.get(String(student.departmentId)) || null,
    batch: batches.get(String(primaryBatchId(student))) || null,
    ...(college ? { college: colleges.get(String(student.collegeId)) || null } : {}),
  }));
};

// Map submissionId -> violation count, replacing `_count: { violations }`.
const countViolationsBySubmission = async (submissionIds) => {
  const ids = uniqueIds(submissionIds);
  const counts = new Map();
  if (ids.length === 0) return counts;
  const collection = mongoose.connection.db.collection("violation");
  for (const part of chunk(ids)) {
    const rows = await collection
      .aggregate([
        { $match: { submissionId: { $in: idVariants(part) } } },
        { $group: { _id: "$submissionId", count: { $sum: 1 } } },
      ])
      .toArray();
    rows.forEach((row) => {
      const key = String(row._id);
      counts.set(key, (counts.get(key) || 0) + row.count);
    });
  }
  return counts;
};

// Map testId -> sum of question marks, replacing `questions: { select: { marks } }`
// on every test. Pair with getTestTotalMarks via { questions: [{ marks }] }.
const sumQuestionMarksByTest = async (testIds) => {
  const ids = uniqueIds(testIds);
  if (ids.length === 0) return new Map();
  const rows = await mongoose.connection.db
    .collection("question")
    .aggregate([
      { $match: { testId: { $in: idVariants(ids) } } },
      { $group: { _id: "$testId", marks: { $sum: { $convert: { input: "$marks", to: "double", onError: 0, onNull: 0 } } } } },
    ])
    .toArray();
  const totals = new Map();
  rows.forEach((row) => {
    const key = String(row._id);
    totals.set(key, (totals.get(key) || 0) + row.marks);
  });
  return totals;
};

module.exports = {
  attachStudentGroups,
  countViolationsBySubmission,
  loadNamesById,
  sumQuestionMarksByTest,
  uniqueIds,
};
