const mockIoredis = () => {
  jest.doMock("ioredis", () =>
    jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      ping: jest.fn(async () => "PONG"),
      quit: jest.fn(async () => {}),
      disconnect: jest.fn(),
    }))
  );
};

const loadRedisWithEnv = (envOverrides = {}) => {
  const baseEnv = {
    nodeEnv: "production",
    redisUrl: "redis://:secret%40pass@redis:6379/2",
    redis: {
      enabled: true,
      queueEnabled: true,
      connectTimeoutMs: 10000,
      keepAliveMs: 30000,
      maxRetryDelayMs: 2000,
    },
  };
  jest.doMock("../../config/env", () => ({ ...baseEnv, ...envOverrides }));
  return require("../../config/redis");
};

describe("redis config gate", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("enables the client in production when REDIS_URL is present", () => {
    mockIoredis();
    const redis = loadRedisWithEnv();
    expect(redis.getRedisQueueConnection()).toEqual(expect.objectContaining({
      host: "redis",
      port: 6379,
      password: "secret@pass",
      db: 2,
      connectionName: "lms-queue:production",
    }));
  });

  it("keeps Redis enabled under NODE_ENV=test when explicitly opted in", () => {
    mockIoredis();
    const redis = loadRedisWithEnv({ nodeEnv: "test", redis: { enabled: true, queueEnabled: true } });
    expect(redis.getRedisQueueConnection()).not.toBeNull();
  });

  it("disables Redis under NODE_ENV=test by default", () => {
    mockIoredis();
    const redis = loadRedisWithEnv({
      nodeEnv: "test",
      redisUrl: "redis://127.0.0.1:6379",
      redis: { enabled: false, queueEnabled: false },
    });
    expect(redis.redisClient).toBeNull();
    expect(redis.getRedisQueueConnection()).toBeNull();
  });

  it("disables Redis when REDIS_URL is missing even in production", () => {
    mockIoredis();
    const redis = loadRedisWithEnv({ redisUrl: null });
    expect(redis.redisClient).toBeNull();
    expect(redis.getRedisQueueConnection()).toBeNull();
  });

  describe("buildRedisUrlOptions", () => {
    it("decodes credentials, db index and tls", () => {
      const { buildRedisUrlOptions } = loadRedisWithEnv();
      expect(buildRedisUrlOptions("rediss://user:p%40ss@cache.internal:6380/3")).toEqual({
        host: "cache.internal",
        port: 6380,
        username: "user",
        password: "p@ss",
        db: 3,
        tls: {},
      });
    });

    it("defaults the port to 6379 and omits empty fields", () => {
      const { buildRedisUrlOptions } = loadRedisWithEnv();
      expect(buildRedisUrlOptions("redis://redis")).toEqual({ host: "redis", port: 6379 });
    });

    it("returns null for an invalid URL", () => {
      const { buildRedisUrlOptions } = loadRedisWithEnv();
      expect(buildRedisUrlOptions("not a url")).toBeNull();
    });
  });

  describe("client lifecycle and health", () => {
    it("reports a disabled health snapshot without a client", async () => {
      mockIoredis();
      const redis = loadRedisWithEnv({ redisUrl: null });
      expect(await redis.getRedisHealthSnapshot()).toEqual({
        configured: false,
        available: false,
        status: "disabled",
        latencyMs: -1,
        error: null,
      });
    });

    it("reports ok when the client pings", async () => {
      mockIoredis();
      const redis = loadRedisWithEnv();
      const snap = await redis.getRedisHealthSnapshot();
      expect(snap.configured).toBe(true);
      expect(snap.status).toBe("ok");
      expect(typeof snap.latencyMs).toBe("number");
    });

    it("reports down when the ping fails", async () => {
      jest.doMock("ioredis", () =>
        jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          ping: jest.fn(async () => {
            throw new Error("connection denied");
          }),
          quit: jest.fn(async () => {}),
          disconnect: jest.fn(),
        }))
      );
      const redis = loadRedisWithEnv();
      const snap = await redis.getRedisHealthSnapshot();
      expect(snap.status).toBe("down");
      expect(snap.available).toBe(false);
      expect(snap.error).toBe("Error");
      expect(snap.error).not.toContain("connection denied");
    });

    it("falls back to disconnect() when quit() rejects during shutdown", async () => {
      const disconnect = jest.fn();
      jest.doMock("ioredis", () =>
        jest.fn().mockImplementation(() => ({
          on: jest.fn(),
          ping: jest.fn(async () => "PONG"),
          quit: jest.fn(async () => {
            throw new Error("client is busy");
          }),
          disconnect,
        }))
      );
      const redis = loadRedisWithEnv();
      await redis.shutdownRedis();
      expect(disconnect).toHaveBeenCalled();
    });

    it("caps the retry delay at the configured maximum", () => {
      mockIoredis();
      const { getRedisQueueConnection } = loadRedisWithEnv();
      const connection = getRedisQueueConnection();
      expect(connection.retryStrategy(1)).toBe(100);
      expect(connection.retryStrategy(60)).toBe(2000);
    });

    it("returns null queue connection when the queue is disabled", () => {
      mockIoredis();
      const redis = loadRedisWithEnv({ redis: { enabled: true, queueEnabled: false } });
      expect(redis.getRedisQueueConnection()).toBeNull();
    });

    it("returns null queue connection when the URL is unparseable", () => {
      mockIoredis();
      const redis = loadRedisWithEnv({ redisUrl: "not a url" });
      expect(redis.getRedisQueueConnection()).toBeNull();
    });
  });
});
