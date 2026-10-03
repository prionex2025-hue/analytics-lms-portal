describe("event feed cache invalidation", () => {
  const loadService = ({ available = true, members = [] } = {}) => {
    jest.resetModules();

    const commands = [];
    const pipeline = {
      commands,
      set(...args) {
        commands.push(["set", args]);
      },
      sadd(...args) {
        commands.push(["sadd", args]);
      },
      expire(...args) {
        commands.push(["expire", args]);
      },
      del(...args) {
        commands.push(["del", args]);
      },
      get length() {
        return commands.length;
      },
      exec: jest.fn(async () => commands.map(() => [null, "OK"])),
    };
    const redisClient = {
      pipeline: jest.fn(() => pipeline),
      smembers: jest.fn(async () => members),
    };

    jest.doMock("../../config/redis", () => ({
      redisClient,
      isRedisAvailable: () => available,
    }));

    return { service: require("../../services/event-cache.service"), redisClient, pipeline };
  };

  it("indexes newly cached feeds in the same Redis round trip", async () => {
    const { service, redisClient, pipeline } = loadService();

    await service.setCachedEventFeed("event_feed:test:abc", { events: [] }, 30);

    expect(redisClient.pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
    expect(pipeline.commands[0][0]).toBe("set");
    expect(pipeline.commands[1]).toEqual(["sadd", ["event_feed:index", "event_feed:test:abc"]]);
    expect(pipeline.commands[2]).toEqual(["expire", ["event_feed:index", 35]]);
  });

  it("invalidates only indexed feeds and never scans Redis", async () => {
    const { service, redisClient, pipeline } = loadService({
      members: ["event_feed:test:one", "event_feed:test:two"],
    });

    await service.invalidateEventFeedCache();

    expect(redisClient.scanStream).toBeUndefined();
    expect(redisClient.smembers).toHaveBeenCalledWith("event_feed:index");
    expect(pipeline.commands).toEqual([
      ["del", ["event_feed:test:one"]],
      ["del", ["event_feed:test:two"]],
      ["del", ["event_feed:index"]],
    ]);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it("does not touch Redis when it is unavailable", async () => {
    const { service, redisClient, pipeline } = loadService({ available: false });

    await service.setCachedEventFeed("event_feed:test:abc", { events: [] });
    await service.invalidateEventFeedCache();

    expect(redisClient.pipeline).not.toHaveBeenCalled();
    expect(pipeline.exec).not.toHaveBeenCalled();
    expect(redisClient.smembers).not.toHaveBeenCalled();
  });

  it("fails open when the index cannot be read", async () => {
    jest.resetModules();
    const redisClient = {
      smembers: jest.fn(async () => {
        throw new Error("redis unavailable");
      }),
      pipeline: jest.fn(),
    };
    jest.doMock("../../config/redis", () => ({
      redisClient,
      isRedisAvailable: () => true,
    }));

    const service = require("../../services/event-cache.service");

    await expect(service.invalidateEventFeedCache()).resolves.toBeUndefined();
    expect(redisClient.pipeline).not.toHaveBeenCalled();
  });
});
