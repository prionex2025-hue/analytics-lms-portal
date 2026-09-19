/**
 * Presence-emit throttle for exam heartbeats.
 *
 * Students heartbeat every ~5 seconds; monitors only need one presence push
 * per student per interval. This gate lets the first heartbeat in each window
 * through and swallows the rest, keeping room traffic at
 * one event / student / interval regardless of heartbeat cadence.
 *
 * Per-node in-memory state: with several API nodes the worst case is one emit
 * per node per window, which is still bounded and harmless to the monitor
 * (the merge is idempotent). The map self-prunes so long exams cannot leak.
 */

const PRESENCE_EMIT_INTERVAL_MS = 5_000;
const PRUNE_AFTER_MS = 10 * 60 * 1000;
const PRUNE_WHEN_ABOVE = 20_000;

const lastEmitAt = new Map();

const shouldEmitPresence = (submissionId, now = Date.now()) => {
  if (!submissionId) return false;

  const key = String(submissionId);
  const last = lastEmitAt.get(key) || 0;
  if (now - last < PRESENCE_EMIT_INTERVAL_MS) {
    return false;
  }

  lastEmitAt.set(key, now);

  if (lastEmitAt.size > PRUNE_WHEN_ABOVE) {
    for (const [entryKey, at] of lastEmitAt) {
      if (now - at > PRUNE_AFTER_MS) {
        lastEmitAt.delete(entryKey);
      }
    }
  }

  return true;
};

const clearPresenceThrottle = () => {
  lastEmitAt.clear();
};

module.exports = {
  shouldEmitPresence,
  clearPresenceThrottle,
  PRESENCE_EMIT_INTERVAL_MS,
};
