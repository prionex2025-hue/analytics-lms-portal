describe("heartbeat buffer service", () => {
  let redisClient;
  let redisAvailable;

  const loadService = () => {
    jest.resetModules();
    redisAvailable = true;

    const pipeline = {
      hset: jest.fn(() => pipeline),
      expire: jest.fn(() => pipeline),
      sadd: jest.fn(() => pipeline),
      del: jest.fn(() => pipeline),
      srem: jest.fn(() => pipeline),
      exec: jest.fn(async () => []),
    };

    redisClient = {
      pipeline: jest.fn(() => pipeline),
      hgetall: jest.fn(),
      srem: jest.fn(async () => 1),
      sscan: jest.fn(),
      smembers: jest.fn(),
      keys: jest.fn(),
    };

    jest.doMock("../../config/redis", () => ({
      redisClient,
      isRedisAvailable: () => redisAvailable,
    }));

    return require("../../services/heartbeat-buffer.service");
  };

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("buffers a heartbeat and tracks the active test without writing to MongoDB", async () => {
    const { bufferHeartbeat } = loadService();

    await expect(bufferHeartbeat({
      userId: "student-1",
      testId: "test-1",
      submissionId: "submission-1",
    })).resolves.toBe(true);

    expect(redisClient.pipeline).toHaveBeenCalledTimes(1);
    const pipeline = redisClient.pipeline.mock.results[0].value;
    expect(pipeline.hset).toHaveBeenCalledWith(
      "hb:buffer:test-1",
      "student-1",
      expect.stringContaining("\"submissionId\":\"submission-1\"")
    );
    expect(pipeline.sadd).toHaveBeenCalledWith("hb:buffer:tests", "test-1");
    expect(pipeline.expire).toHaveBeenCalledWith("hb:buffer:test-1", 120);
    expect(pipeline.expire).toHaveBeenCalledWith("hb:buffer:tests", 120);
  });

  it("enumerates buffered tests with SSCAN instead of blocking Redis key scans", async () => {
    const { getBufferedTestIds } = loadService();
    redisClient.sscan
      .mockResolvedValueOnce(["7", ["test-1", "test-2"]])
      .mockResolvedValueOnce(["0", ["test-2", "test-3"]]);

    await expect(getBufferedTestIds()).resolves.toEqual(["test-1", "test-2", "test-3"]);

    expect(redisClient.sscan).toHaveBeenCalledWith("hb:buffer:tests", "0", "COUNT", 100);
    expect(redisClient.sscan).toHaveBeenCalledWith("hb:buffer:tests", "7", "COUNT", 100);
    expect(redisClient.smembers).not.toHaveBeenCalled();
    expect(redisClient.keys).not.toHaveBeenCalled();
  });

  it("falls back to direct writes when Redis is unavailable", async () => {
    const { bufferHeartbeat, getBufferedTestIds } = loadService();
    redisAvailable = false;

    await expect(bufferHeartbeat({
      userId: "student-1",
      testId: "test-1",
      submissionId: "submission-1",
    })).resolves.toBe(false);
    await expect(getBufferedTestIds()).resolves.toEqual([]);

    expect(redisClient.pipeline).not.toHaveBeenCalled();
    expect(redisClient.sscan).not.toHaveBeenCalled();
  });
});
