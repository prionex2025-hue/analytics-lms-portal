/**
 * Batched submission collection for analytics.
 *
 * Replaces the old single `take: 20_000` query, which silently dropped
 * everything past the cap. Pages through the full result set in fixed-size
 * batches (stable order, indexed skip) up to a memory-safety ceiling an order
 * of magnitude higher, and reports honestly when even that ceiling truncates.
 */

const DEFAULT_BATCH_SIZE = 10_000;
const DEFAULT_MAX_ROWS = 200_000;

const collectSubmissions = async ({
  db,
  where,
  select = null,
  include = null,
  orderBy = { submittedAt: "desc" },
  batchSize = DEFAULT_BATCH_SIZE,
  maxRows = DEFAULT_MAX_ROWS,
} = {}) => {
  const rows = [];
  let skip = 0;

  for (;;) {
    const remaining = maxRows - rows.length;
    if (remaining <= 0) {
      // Ceiling reached. (At exactly maxRows with nothing left this is a
      // false positive — acceptable for a disclosure flag at this boundary.)
      return { rows, truncated: true };
    }

    const take = Math.min(batchSize, remaining);
    const batch = await db.submission.findMany({
      where,
      ...(select ? { select } : {}),
      ...(include ? { include } : {}),
      orderBy,
      skip,
      take,
    });

    rows.push(...batch);

    if (batch.length < take) {
      return { rows, truncated: false };
    }

    skip += batch.length;
  }
};

module.exports = {
  collectSubmissions,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_ROWS,
};
