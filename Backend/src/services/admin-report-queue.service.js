const models = require("../models");
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

    reportWorker.on("failed", async (job, error) => {
      const reportJobId = job?.data?.reportJobId;
      if (!reportJobId) return;

      const db = await getDbClient();
      const reportJob = await db.reportJob.findUnique({ where: { id: reportJobId } });
      if (!reportJob) return;

      emitToCollege(reportJob.collegeId, "report:status", {
        reportJobId,
        status: "FAILED",
        errorMessage: error?.message || "Report processing failed",
      });
    });
  }
}

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
  });

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
    });
  } catch (error) {
    const failed = await db.reportJob.update({
      where: { id: reportJobId },
      data: {
        status: "FAILED",
        errorMessage: error.message,
      },
    });

    emitToCollege(failed.collegeId, "report:status", {
      reportJobId,
      status: "FAILED",
      errorMessage: error.message,
    });
  }
};

const enqueueReportJob = async (reportJobId) => {
  if (!reportQueue) {
    await processReportSynchronously(reportJobId);
    return;
  }

  try {
    await reportQueue.add("generate", { reportJobId }, { jobId: reportJobId, removeOnComplete: true, removeOnFail: false });
  } catch (_error) {
    await processReportSynchronously(reportJobId);
  }
};

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

module.exports = {
  enqueueReportJob,
  processReportSynchronously,
  recoverPendingReportJobs,
};
