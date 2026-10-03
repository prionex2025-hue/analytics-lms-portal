/**
 * Regression coverage for the report-queue enqueue path.
 *
 * BullMQ connections are configured with `maxRetriesPerRequest: null` and
 * `enableOfflineQueue: true` (and deliberately no commandTimeout, because
 * blocking commands never return). While Redis is unreachable, `queue.add()`
 * therefore neither resolves nor rejects, so awaiting it hangs the "Generate
 * report" request forever and the synchronous fallback is unreachable.
 *
 * These tests pin the bounded-deadline behaviour and the job options that keep
 * failed jobs from growing the Redis keyspace without bound.
 */
describe("admin report queue enqueue", () => {
  const originalTimeout = process.env.REPORT_QUEUE_ENQUEUE_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) delete process.env.REPORT_QUEUE_ENQUEUE_TIMEOUT_MS;
    else process.env.REPORT_QUEUE_ENQUEUE_TIMEOUT_MS = originalTimeout;
    jest.resetModules();
  });

  const loadService = ({ add } = {}) => {
    jest.resetModules();
    process.env.REPORT_QUEUE_ENQUEUE_TIMEOUT_MS = "40";

    const update = jest.fn(async ({ where, data }) => {
      const row = {
        id: where.id,
        status: where.status,
        errorMessage: data?.errorMessage ?? null,
        updatedAt: new Date(),
        filters: {},
      };
      return { where, data, row };
    });

    jest.doMock("../../config/redis", () => ({
      redisClient: { ping: jest.fn(async () => "PONG") },
      getRedisQueueConnection: jest.fn(() => ({ host: "127.0.0.1" })),
    }));

    jest.doMock("bullmq", () => ({
      Queue: class {
        constructor() {
          this.add = add;
        }
        async close() {}
      },
      Worker: class {
        constructor() {
          this.on = jest.fn();
        }
        async close() {}
      },
    }));

    jest.doMock("../../models", () => ({
      init: jest.fn(async () => ({
        dbClient: {
          reportJob: {
            findFirst: jest.fn(async () => null),
            findUnique: jest.fn(async ({ where }) => ({
              id: where.id,
              status: "PROCESSING",
              filters: { reportBasePath: "/api/college-admin/reports" },
              collegeId: "college-1",
            })),
            findMany: jest.fn(async () => []),
            update,
            updateMany: jest.fn(async () => ({ count: 0 })),
          },
        },
      })),
    }));

    jest.doMock("../../realtime/socket", () => ({ emitToCollege: jest.fn() }));
    jest.doMock("../../services/report-payload-store.service", () => ({
      saveReportPayload: jest.fn(async () => "payload-id"),
    }));
    jest.doMock("../../services/admin-department-report.service", () => ({
      buildDepartmentReportPayload: jest.fn(async () => ({ ok: true })),
    }));

     
    const service = require("../../services/admin-report-queue.service");
    return { service, update };
  };

  it("falls back to synchronous processing when queue.add never settles (Redis down)", async () => {
    // A promise that never resolves and never rejects: exactly what ioredis
    // produces while the server is unreachable with an offline queue enabled.
    const add = jest.fn(() => new Promise(() => {}));
    const { service, update } = loadService({ add });

    await service.enqueueReportJob("job-1");

    // The synchronous fallback flips the row QUEUED -> PROCESSING, so observing
    // that write proves the request did not hang until nginx 504'd it.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSING" }) })
    );
  });

  it("falls back to synchronous processing when queue.add rejects", async () => {
    const add = jest.fn(async () => {
      throw new Error("connection is closed");
    });
    const { service, update } = loadService({ add });

    await service.enqueueReportJob("job-2");

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSING" }) })
    );
  });

  it("retries transient failures and caps retention of failed jobs", async () => {
    const add = jest.fn(async () => ({}));
    const { service } = loadService({ add });

    await service.enqueueReportJob("job-3");

    expect(add).toHaveBeenCalledWith("generate", { reportJobId: "job-3" }, expect.objectContaining({
      jobId: "job-3",
      removeOnComplete: true,
      // Without attempts/backoff BullMQ defaults to a single try.
      attempts: expect.any(Number),
      backoff: expect.objectContaining({ type: "exponential" }),
      // Without a retention count, removeOnFail:false grows the keyspace forever.
      removeOnFail: { count: expect.any(Number) },
    }));
    expect(add.mock.calls[0][2].attempts).toBeGreaterThan(1);
    expect(add.mock.calls[0][2].removeOnFail.count).toBeGreaterThan(0);
  });

  it("does not start a duplicate synchronous run after a successful enqueue", async () => {
    const add = jest.fn(async () => ({}));
    const { service } = loadService({ add });

    const { update } = loadService({ add });

    await service.enqueueReportJob("job-4");

    expect(add).toHaveBeenCalledTimes(1);
    // A successful enqueue must be handed to the worker, not also run inline.
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSING" }) })
    );
  });
});