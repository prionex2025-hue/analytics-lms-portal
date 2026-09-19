const { withRedisLock } = require("./redis-lock.service");
const { createAuditLog } = require("./audit.service");
const { emitToCollege, emitToTestRoom } = require("../realtime/socket");

/**
 * Test lifecycle sweep.
 *
 * Historically the stored test status stayed LIVE/SCHEDULED forever and every
 * reader re-derived "completed" from the time window — four different
 * derivations that repeatedly drifted (results reveal, review policy, test
 * listings, socket payloads). This worker makes the stored status truthful:
 *   SCHEDULED/UPCOMING -> LIVE       once startsAt has passed (still published)
 *   SCHEDULED/LIVE/PUBLISHED -> COMPLETED once endsAt has passed
 *
 * Attempts are unaffected: a student's personal timer still governs their own
 * auto-submit (the resume-after-window fix), and read-side derivations keep
 * working — they simply stop being load-bearing.
 */

const SWEEP_LOCK_KEY = "lock:test-lifecycle-sweep";
const DEFAULT_INTERVAL_MS = 60_000;

let sweepTimer = null;

const sweepTestLifecycle = async ({ db, now = new Date() } = {}) => {
  // Completion first: a SCHEDULED test whose whole window has already passed
  // must land on COMPLETED, never briefly on LIVE.
  const toComplete = await db.test.findMany({
    where: {
      status: { in: ["SCHEDULED", "UPCOMING", "LIVE", "PUBLISHED"] },
      endsAt: { lt: now },
    },
    select: { id: true, collegeId: true, title: true, status: true },
  });

  if (toComplete.length > 0) {
    await db.test.updateMany({
      where: { id: { in: toComplete.map((test) => test.id) } },
      data: { status: "COMPLETED", completedAt: now },
    });
  }

  const toGoLive = await db.test.findMany({
    where: {
      status: { in: ["SCHEDULED", "UPCOMING"] },
      isPublished: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    select: { id: true, collegeId: true, title: true, status: true },
  });

  if (toGoLive.length > 0) {
    await db.test.updateMany({
      where: { id: { in: toGoLive.map((test) => test.id) } },
      data: { status: "LIVE" },
    });
  }

  const notify = async (tests, action, nextStatus) => {
    for (const test of tests) {
      try {
        emitToCollege(test.collegeId, "test_status_change", {
          testId: test.id,
          status: nextStatus,
          action,
        });
        emitToTestRoom(test.id, "test_status_change", {
          testId: test.id,
          status: nextStatus,
          action,
        });
        await createAuditLog({
          action,
          targetType: "TEST",
          targetId: test.id,
          collegeId: test.collegeId,
          testId: test.id,
          afterState: { status: nextStatus, previousStatus: test.status, automated: true },
        });
      } catch {
        // Notification/audit failures must not abort the sweep.
      }
    }
  };

  await notify(toComplete, "TEST_COMPLETED", "COMPLETED");
  await notify(toGoLive, "TEST_LIVE", "LIVE");

  return {
    completed: toComplete.map((test) => test.id),
    wentLive: toGoLive.map((test) => test.id),
  };
};

/**
 * Start the periodic sweep. A Redis lock keeps multi-node deployments to one
 * sweep per interval; the transitions themselves are idempotent, so a missed
 * lock (Redis down -> lock runs task without lock) only risks duplicate socket
 * notifications, never duplicate state.
 */
const startTestLifecycleSweep = ({ getDb, intervalMs = DEFAULT_INTERVAL_MS } = {}) => {
  if (sweepTimer || typeof getDb !== "function") return;

  sweepTimer = setInterval(async () => {
    try {
      await withRedisLock({
        lockKey: SWEEP_LOCK_KEY,
        ttlMs: Math.max(5_000, intervalMs - 5_000),
        waitTimeoutMs: 0,
        onLockTimeout: async () => null, // another node is sweeping
        task: async () => {
          const db = await getDb();
          const result = await sweepTestLifecycle({ db });
          if (result.completed.length || result.wentLive.length) {
            console.log(
              `Test lifecycle sweep: ${result.wentLive.length} went live, ${result.completed.length} completed.`
            );
          }
        },
      });
    } catch (error) {
      console.error("Test lifecycle sweep error:", error?.message || error);
    }
  }, intervalMs);

  sweepTimer.unref();
};

const stopTestLifecycleSweep = () => {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
};

module.exports = {
  sweepTestLifecycle,
  startTestLifecycleSweep,
  stopTestLifecycleSweep,
};
