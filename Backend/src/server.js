const http = require("http");
const net = require("net");
const mongoose = require("mongoose");
const app = require("./app");
const env = require("./config/env");
const { shutdownRedis } = require("./config/redis");
const { initSocket, shutdownSocket } = require("./realtime/socket");
const { startHeartbeatFlush, stopHeartbeatFlush } = require("./services/heartbeat-buffer.service");
const { startTestLifecycleSweep, stopTestLifecycleSweep } = require("./services/test-lifecycle.service");
const { recoverPendingReportJobs } = require("./services/admin-report-queue.service");
const { recoverPendingSuperReportJobs } = require("./services/super-admin-report-queue.service");

const server = http.createServer(app);
initSocket(server, env.frontendOrigins || [env.frontendOrigin]);

const SHUTDOWN_TIMEOUT_MS = 15_000;

const shutdown = async (signal) => {
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("HTTP server closed - no more incoming connections.");
  });

  // Give active requests time to finish, then force exit
  const forceTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  // Stop heartbeat buffer flush
  stopHeartbeatFlush();
  stopTestLifecycleSweep();

  try {
    await mongoose.disconnect();
    console.log("MongoDB disconnected.");
  } catch (error) {
    console.error("Error disconnecting MongoDB:", error.message);
  }

  // Gracefully close Redis connection
  try {
    await shutdownSocket();
  } catch (error) {
    console.error("Error disconnecting Socket.IO Redis clients:", error.message);
  }

  try {
    await shutdownRedis();
    console.log("Redis disconnected.");
  } catch (error) {
    console.error("Error disconnecting Redis:", error.message);
  }

  clearTimeout(forceTimer);
  console.log("Shutdown complete.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Catch unhandled errors so a single failed promise doesn't crash the process
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  shutdown("uncaughtException");
});

const parsePort = (value) => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : 5000;
};

const canListenOnPort = (port) =>
  new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port);
  });

const startServer = async () => {
  const basePort = parsePort(env.port);
  let selectedPort = basePort;

  for (let offset = 0; offset < 10; offset += 1) {
    const candidate = basePort + offset;
    const available = await canListenOnPort(candidate);
    if (available) {
      selectedPort = candidate;
      break;
    }

    if (env.nodeEnv === "production") {
      throw new Error(`Configured port ${basePort} is unavailable`);
    }
  }

  // Start heartbeat write buffer flush loop.
  // Batches heartbeat DB writes every 30s to reduce MongoDB load during exams.
  const db = require("./config/db");
  startHeartbeatFlush(async (batches) => {
    for (const { testId, entries } of batches) {
      try {
        const latestAt = Math.max(...entries.map((entry) => Number(entry.at || 0)).filter(Number.isFinite));
        const heartbeatAt = new Date(Number.isFinite(latestAt) && latestAt > 0 ? latestAt : Date.now());
        const submissionIds = [...new Set(entries.map((entry) => entry.submissionId).filter(Boolean))];
        const userIds = [...new Set(entries.map((entry) => entry.userId).filter(Boolean))];

        await Promise.all([
          submissionIds.length
            ? db.submission.updateMany({
                where: { id: { in: submissionIds }, status: "IN_PROGRESS" },
                data: {
                  lastHeartbeat: heartbeatAt,
                  connectionStatus: "ONLINE",
                },
              })
            : Promise.resolve(),
          userIds.length
            ? db.testSession.updateMany({
                where: { testId, userId: { in: userIds }, endedAt: null },
                data: {
                  lastHeartbeatAt: heartbeatAt,
                  connectionStatus: "ONLINE",
                },
              })
            : Promise.resolve(),
        ]);
      } catch {
        // Fail-open: heartbeats are best-effort.
      }
    }
  });

  // Keep stored test statuses truthful: SCHEDULED -> LIVE at startsAt and
  // -> COMPLETED at endsAt, with socket notifications, instead of relying on
  // read-time derivation everywhere.
  startTestLifecycleSweep({ getDb: async () => db });

  const recoverReportQueues = async () => {
    const [adminReports, superReports] = await Promise.all([
      recoverPendingReportJobs(),
      recoverPendingSuperReportJobs(),
    ]);
    const totalRecovered =
      adminReports.resetProcessing +
      adminReports.requeued +
      superReports.resetProcessing +
      superReports.requeued;

    if (totalRecovered > 0) {
      console.log(
        `Recovered report queues: admin requeued=${adminReports.requeued}, admin reset=${adminReports.resetProcessing}, ` +
        `super requeued=${superReports.requeued}, super reset=${superReports.resetProcessing}.`
      );
    }
  };

  server.listen(selectedPort, () => {
    if (selectedPort !== basePort) {
      console.warn(`Port ${basePort} is busy. Using fallback port ${selectedPort}.`);
    }
    console.log(`LMS API running at http://localhost:${selectedPort}`);
    // Queue recovery is a consumer-side task: only the worker replica requeues
    // stale jobs, so multiple web replicas don't race on startup.
    if (env.worker.enabled) {
      recoverReportQueues().catch((error) => {
        console.warn("Report queue recovery skipped:", error?.message || "unknown error");
      });
    }
  });
};

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
