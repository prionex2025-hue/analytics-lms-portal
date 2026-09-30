const http = require("http");
const net = require("net");
const mongoose = require("mongoose");
const app = require("./app");
const env = require("./config/env");
const { shutdownRedis } = require("./config/redis");
const { initSocket, shutdownSocket, disconnectAllSockets } = require("./realtime/socket");
const { startHeartbeatFlush, stopHeartbeatFlush } = require("./services/heartbeat-buffer.service");
const { startTestLifecycleSweep, stopTestLifecycleSweep } = require("./services/test-lifecycle.service");
const { closeReportQueue, recoverPendingReportJobs } = require("./services/admin-report-queue.service");
const { closeSuperReportQueue, recoverPendingSuperReportJobs } = require("./services/super-admin-report-queue.service");
const { logger } = require("./utils/logger");
const { markShuttingDown } = require("./utils/lifecycle");

const server = http.createServer(app);
// Behind NGINX with upstream keepalive: Node must keep idle sockets open longer
// than NGINX does, or NGINX reuses a socket Node just closed -> sporadic 502s.
server.keepAliveTimeout = env.httpServer.keepAliveTimeoutMs;
server.headersTimeout = Math.max(env.httpServer.headersTimeoutMs, env.httpServer.keepAliveTimeoutMs + 1000);
server.requestTimeout = env.httpServer.requestTimeoutMs;
initSocket(server, env.frontendOrigins || [env.frontendOrigin]);

let shutdownPromise = null;

const closeHttpServer = () =>
  new Promise((resolve) => {
    // Keep-alive sockets that become idle AFTER close() (i.e. once their
    // in-flight response is sent) would otherwise hold close() open for the
    // full keepAliveTimeout. Sweep them until the server has fully closed.
    const sweep = setInterval(() => server.closeIdleConnections?.(), 250);
    sweep.unref();
    server.close(() => {
      clearInterval(sweep);
      resolve();
    });
    server.closeIdleConnections?.();
  });

const runShutdown = async (signal) => {
  logger.info("server.shutdown_started", { signal });

  // 1. Report not-ready so the load balancer stops sending new requests.
  markShuttingDown();

  const forceTimer = setTimeout(() => {
    logger.error("server.shutdown_timeout", { timeoutMs: env.httpServer.shutdownTimeoutMs });
    process.exit(1);
  }, env.httpServer.shutdownTimeoutMs);
  forceTimer.unref();

  // 2. Stop background loops and move websocket clients to other replicas.
  stopHeartbeatFlush();
  stopTestLifecycleSweep();
  disconnectAllSockets();

  // 3. Stop accepting connections and let in-flight HTTP requests finish
  //    (they still need MongoDB/Redis, so those close afterwards).
  await closeHttpServer();
  logger.info("server.http_closed");

  // 4. Let active report jobs finish, then release dependencies.
  await Promise.allSettled([closeReportQueue(), closeSuperReportQueue()]);

  try {
    await shutdownSocket();
  } catch (error) {
    logger.error("server.socket_shutdown_failed", { reason: error?.message });
  }

  try {
    await mongoose.disconnect();
    logger.info("mongodb.disconnected_cleanly");
  } catch (error) {
    logger.error("mongodb.disconnect_failed", { reason: error?.message });
  }

  try {
    await shutdownRedis();
    logger.info("redis.disconnected_cleanly");
  } catch (error) {
    logger.error("redis.disconnect_failed", { reason: error?.message });
  }

  clearTimeout(forceTimer);
  logger.info("server.shutdown_complete", { signal });
};

// Idempotent: SIGTERM followed by SIGINT (or an uncaught exception during
// shutdown) must not run the sequence twice.
const shutdown = (signal, exitCode = 0) => {
  if (!shutdownPromise) {
    shutdownPromise = runShutdown(signal)
      .catch((error) => logger.error("server.shutdown_failed", { reason: error?.message }))
      .finally(() => process.exit(exitCode));
  }
  return shutdownPromise;
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// A rejected promise nobody awaited is a bug, but not a reason to drop every
// in-flight exam request on this instance: log it and keep serving.
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  // Throttled per message: a dependency outage can reject on every request.
  logger.throttled("error", `unhandled:${message.slice(0, 120)}`, 10_000, "process.unhandled_rejection", {
    reason: reason instanceof Error ? reason : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// After an uncaught exception process state is undefined: drain and exit
// non-zero so the orchestrator restarts a clean process.
process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", { reason: error, stack: error?.stack });
  shutdown("uncaughtException", 1);
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
    logger.info("server.listening", { port: selectedPort, nodeEnv: env.nodeEnv, worker: env.worker.enabled });
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
  logger.error("server.start_failed", { reason: error, stack: error?.stack });
  process.exit(1);
});
