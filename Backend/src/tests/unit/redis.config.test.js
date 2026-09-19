describe("redis config", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  const mockRedisConstructor = () => {
    jest.doMock("ioredis", () => jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      ping: jest.fn(async () => "PONG"),
      quit: jest.fn(async () => {}),
      disconnect: jest.fn(),
    })));
  };

  it("passes REDIS_URL host and credentials to BullMQ queue connections", () => {
    mockRedisConstructor();
    jest.doMock("../../config/env", () => ({
      nodeEnv: "production",
      redisUrl: "redis://:secret%40pass@redis:6379/2",
      redis: {
        enabled: true,
        queueEnabled: true,
        connectTimeoutMs: 10000,
        keepAliveMs: 30000,
        maxRetryDelayMs: 2000,
      },
    }));

    const { getRedisQueueConnection } = require("../../config/redis");
    const connection = getRedisQueueConnection();

    expect(connection).toEqual(expect.objectContaining({
      host: "redis",
      port: 6379,
      password: "secret@pass",
      db: 2,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      connectionName: "lms-queue:production",
    }));
    expect(connection.host).not.toBe("127.0.0.1");
  });
});
