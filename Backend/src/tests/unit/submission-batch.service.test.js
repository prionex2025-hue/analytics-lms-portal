const { collectSubmissions } = require("../../services/submission-batch.service");

const buildRows = (count, offset = 0) =>
  Array.from({ length: count }, (_, index) => ({ id: `s${offset + index}` }));

// Simulates a collection of `total` rows served through skip/take paging.
const buildDb = (total) => {
  const findMany = jest.fn(async ({ skip = 0, take }) => {
    const available = Math.max(0, total - skip);
    return buildRows(Math.min(available, take), skip);
  });
  return { submission: { findMany } };
};

describe("batched submission collection", () => {
  it("returns everything in one batch when the set is small", async () => {
    const db = buildDb(3);
    const { rows, truncated } = await collectSubmissions({ db, where: {}, batchSize: 10 });

    expect(rows).toHaveLength(3);
    expect(truncated).toBe(false);
    expect(db.submission.findMany).toHaveBeenCalledTimes(1);
  });

  it("pages through multiple batches with advancing skip and stable order", async () => {
    const db = buildDb(25);
    const { rows, truncated } = await collectSubmissions({ db, where: {}, batchSize: 10, maxRows: 100 });

    expect(rows).toHaveLength(25);
    expect(truncated).toBe(false);
    expect(db.submission.findMany).toHaveBeenCalledTimes(3);
    expect(db.submission.findMany.mock.calls.map(([args]) => args.skip)).toEqual([0, 10, 20]);
    // Every page must carry the same stable sort or pages could overlap.
    for (const [args] of db.submission.findMany.mock.calls) {
      expect(args.orderBy).toEqual({ submittedAt: "desc" });
    }
    // No duplicates across page boundaries.
    expect(new Set(rows.map((row) => row.id)).size).toBe(25);
  });

  it("stops at the ceiling and reports truncation", async () => {
    const db = buildDb(50);
    const { rows, truncated } = await collectSubmissions({ db, where: {}, batchSize: 10, maxRows: 30 });

    expect(rows).toHaveLength(30);
    expect(truncated).toBe(true);
    expect(db.submission.findMany).toHaveBeenCalledTimes(3);
  });

  it("clamps the final batch so the ceiling is never exceeded", async () => {
    const db = buildDb(50);
    const { rows } = await collectSubmissions({ db, where: {}, batchSize: 20, maxRows: 25 });

    expect(rows).toHaveLength(25);
    const lastCall = db.submission.findMany.mock.calls.at(-1)[0];
    expect(lastCall.take).toBe(5);
  });

  it("passes select/include and where through untouched", async () => {
    const db = buildDb(1);
    const where = { collegeId: "c1" };
    const select = { id: true, score: true };
    await collectSubmissions({ db, where, select });

    expect(db.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, select })
    );
  });
});
