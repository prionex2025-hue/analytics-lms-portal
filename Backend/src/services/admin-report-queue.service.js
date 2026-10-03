const models = require("../models");
const { logger } = require("../utils/logger");
const env = require("../config/env");
const { redisClient, getRedisQueueConnection } = require("../config/redis");

const workerEnabled = env.worker.enabled;
const { emitToCollege } = require("../realtime/socket");
const { buildDepartmentReportPayload } = require("./admin-department-report.service");
const { saveReportPayload } = require("./report-payload-store.service");

let Queue = null;
let Worker = null;
try {
  ({ Queue, Worker } = require("bullmq"));
} catch (_error) {
  Queue = null;
  Worker = null;
}

let reportQueue = null;
let reportWorker = null;
const queueConnection = getRedisQueueConnection();
const DEFAULT_RECOVERY_LIMIT = 25;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
// Queue connections deliberately run without a command timeout (BullMQ's
// blocking commands never return), and ioredis is configured with
// `maxRetriesPerRequest: null` + `enableOfflineQueue: true`. That combination
// means `queue.add()` neither resolves nor rejects while Redis is unreachable,
// so awaiting it hangs the request forever and the synchronous fallback below is
// unreachable. Racing it against a bounded timer keeps "Generate report" working
// (degraded to in-process processing) instead of hanging until nginx 504s.
const ENQUEUE_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.REPORT_QUEUE_ENQUEUE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5000;
})();
const ENQUEUE_ATTEMPTS = 3;
const ENQUEUE_BACKOFF_MS = 1000;
const ENQUEUE_FAILED_JOB_RETENTION = 500;

const getDbClient = async () => {
  const m = await models.init();
  return m.dbClient;
};

if (Queue && redisClient && queueConnection) {
  // Producer: created on every replica so any instance can enqueue jobs.
  reportQueue = new Queue("admin-report-jobs", {
    connection: queueConnection,
  });

  // Consumer: only worker-enabled replicas process jobs, so scaling the API
  // horizontally does not multiply concurrent Puppeteer/PDF work.
  if (workerEnabled) {
    reportWorker = new Worker(
      "admin-report-jobs",
      async (job) => {
        await processReportSynchronously(job.data.reportJobId);
      },
      {
        connection: queueConnection,
        concurrency: 8,
      }
    );

    reportWorker.on("failed", async (job, _error) => {
      const reportJobId = job?.data?.reportJobId;
      if (!reportJobId) return;

      const db = await getDbClient();
      const reportJob = await db.reportJob.findUnique({ where: { id: reportJobId } });
      if (!reportJob) return;

      emitToCollege(reportJob.collegeId, "report:status", {
        reportJobId,
        status: "FAILED",
        errorMessage: REPORT_FAILED_MESSAGE,
      }, { departmentId: reportJob.filters?.departmentId || null });
    });
  }
}

const REPORT_FAILED_MESSAGE = "Report generation failed. Please retry.";

const buildReportPayload = async (db, job) => buildDepartmentReportPayload({ db, job });

const processReportSynchronously = async (reportJobId) => {
  const db = await getDbClient();
  const queued = await db.reportJob.update({
    where: { id: reportJobId },
    data: { status: "PROCESSING" },
  });

  emitToCollege(queued.collegeId, "report:status", {
    reportJobId,
    status: "PROCESSING",
  }, { departmentId: queued.filters?.departmentId || null });

  try {
    const reportJob = await db.reportJob.findUnique({ where: { id: reportJobId } });
    const payload = await buildReportPayload(db, reportJob);
    const payloadRef = await saveReportPayload({ scope: "admin-report", jobId: reportJobId, payload });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const reportBasePath =
      String(reportJob?.filters?.reportBasePath || "").startsWith("/api/college-admin/reports")
        ? "/api/college-admin/reports"
        : "/api/admin/reports";
    const resultUrl = `${reportBasePath}/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

    await db.reportJob.update({
      where: { id: reportJobId },
      data: {
        status: "COMPLETED",
        resultUrl,
        filters: {
          ...(reportJob.filters || {}),
          generatedDataRef: payloadRef,
          resultUrlExpiresAt: expiresAt,
        },
      },
    });

    emitToCollege(reportJob.collegeId, "report:status", {
      reportJobId,
      status: "COMPLETED",
      resultUrl,
    }, { departmentId: reportJob.filters?.departmentId || null });
  } catch (error) {
    // The job record is returned to admins (GET /reports), so it gets the
    // generic message too; the internal error text goes to the server log only.
    logger.error("report.admin_report_failed", { reportJobId, reason: error?.message });
    const failed = await db.reportJob.update({
      where: { id: reportJobId },
      data: {
        status: "FAILED",
        errorMessage: REPORT_FAILED_MESSAGE,
      },
    });

    emitToCollege(failed.collegeId, "report:status", {
      reportJobId,
      status: "FAILED",
      errorMessage: REPORT_FAILED_MESSAGE,
    }, { departmentId: failed.filters?.departmentId || null });
  }
};

const enqueueReportJob = async (reportJobId) => {
  if (!reportQueue) {
    await processReportSynchronously(reportJobId);
    return;
  }

  try {
    await addReportJobWithDeadline(reportJobId);
  } catch (error) {
    logger.warn("report_queue.enqueue_failed", {
      reportJobId,
      reason: error?.code === "ENQUEUE_TIMEOUT" ? "timeout" : "error",
      // Degrade to in-process rendering rather than leaving the job QUEUED
      // forever and the HTTP request hanging.
      fallback: "synchronous",
    });
    await processReportSynchronously(reportJobId);
  }
};

/**
 * Enqueue with a bounded deadline. BullMQ uses the same connection settings as
 * the rest of the queue for blocking commands, so the underlying `add()` may
 * never settle; the timer guarantees this function always does.
 */
const addReportJobWithDeadline = (reportJobId) =>
  new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error("Timed out enqueueing report job");
      error.code = "ENQUEUE_TIMEOUT";
      reject(error);
    }, ENQUEUE_TIMEOUT_MS);

    // Never hold the event loop open for this timer.
    if (typeof timer.unref === "function") timer.unref();

    reportQueue
      .add(
        "generate",
        { reportJobId },
        {
          jobId: reportJobId,
          removeOnComplete: true,
          // Retry transient Redis/Puppeteer failures instead of failing the job on
          // the first attempt, but cap retention so failed jobs cannot grow the
          // Redis keyspace without bound.
          attempts: ENQUEUE_ATTEMPTS,
          backoff: { type: "exponential", delay: ENQUEUE_BACKOFF_MS },
          removeOnFail: { count: ENQUEUE_FAILED_JOB_RETENTION },
        }
      )
      .then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      );
  });

const recoverPendingReportJobs = async ({ limit = DEFAULT_RECOVERY_LIMIT, staleAfterMs = STALE_PROCESSING_MS } = {}) => {
  const db = await getDbClient();
  const staleCutoff = new Date(Date.now() - staleAfterMs);
  const reset = await db.reportJob.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: staleCutoff },
    },
    data: {
      status: "QUEUED",
      errorMessage: null,
    },
  });

  const queuedJobs = await db.reportJob.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const job of queuedJobs) {
    await enqueueReportJob(job.id);
  }

  return {
    resetProcessing: reset.count || 0,
    requeued: queuedJobs.length,
  };
};

// Graceful shutdown: let the in-flight job finish (BullMQ waits for active
// jobs), then close the Redis connections held by the worker and queue.
const closeReportQueue = async () => {
  await Promise.allSettled([reportWorker?.close(), reportQueue?.close()]);
};

module.exports = {
  closeReportQueue,
  enqueueReportJob,
  processReportSynchronously,
  recoverPendingReportJobs,
};
