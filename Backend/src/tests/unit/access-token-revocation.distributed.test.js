describe("production access-token revocation across replicas", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let available;
  let state;
  let redisClient;

  const loadReplica = () => {
    let service;
    jest.isolateModules(() => {
      service = require("../../services/access-token-revocation.service");
    });
    return service;
  };

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    available = true;
    state = new Map();
    redisClient = {
      set: jest.fn(async (key, value, _expiry, ttl) => {
        state.set(key, { value, expiresAt: Date.now() + Number(ttl) * 1000 });
        return "OK";
      }),
      exists: jest.fn(async (key) => {
        const entry = state.get(key);
        if (!entry) return 0;
        if (entry.expiresAt <= Date.now()) {
          state.delete(key);
          return 0;
        }
        return 1;
      }),
    };
    jest.resetModules();
    jest.doMock("../../config/redis", () => ({
      redisClient,
      isRedisAvailable: () => available,
    }));
    jest.doMock("../../utils/token", () => ({ verifyAccessToken: jest.fn() }));
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
    jest.dontMock("../../config/redis");
    jest.dontMock("../../utils/token");
  });

  const payload = (jti = "access-jti", exp = Math.floor(Date.now() / 1000) + 600) => ({ jti, exp });

  it("accepts an unrevoked token and rejects it on every replica after shared revocation", async () => {
    const replicaA = loadReplica();
    const replicaB = loadReplica();
    const token = payload();

    await expect(replicaA.isAccessTokenRevoked(token)).resolves.toBe(false);
    await expect(replicaB.isAccessTokenRevoked(token)).resolves.toBe(false);
    await expect(replicaA.revokeAccessTokenPayload(token)).resolves.toBe(true);
    await expect(replicaB.isAccessTokenRevoked(token)).resolves.toBe(true);
    await expect(replicaA.isAccessTokenRevoked(token)).resolves.toBe(true);
  });

  it("rejects checks consistently while Redis is down and sees the same revocation after reconnect", async () => {
    const replicaA = loadReplica();
    const replicaB = loadReplica();
    const token = payload();

    await replicaA.revokeAccessTokenPayload(token);
    available = false;
    await expect(replicaA.isAccessTokenRevoked(token)).rejects.toMatchObject({ statusCode: 503, code: "TOKEN_REVOCATION_UNAVAILABLE" });
    await expect(replicaB.isAccessTokenRevoked(token)).rejects.toMatchObject({ statusCode: 503, code: "TOKEN_REVOCATION_UNAVAILABLE" });

    available = true;
    await expect(replicaA.isAccessTokenRevoked(token)).resolves.toBe(true);
    await expect(replicaB.isAccessTokenRevoked(token)).resolves.toBe(true);
  });

  it("does not leave replica-local revocation behind when a logout write fails", async () => {
    const replicaA = loadReplica();
    const replicaB = loadReplica();
    const token = payload();
    available = false;

    await expect(replicaA.revokeAccessTokenPayload(token)).rejects.toMatchObject({ statusCode: 503 });
    available = true;
    await expect(replicaA.isAccessTokenRevoked(token)).resolves.toBe(false);
    await expect(replicaB.isAccessTokenRevoked(token)).resolves.toBe(false);
  });

  it("treats expired token identifiers as expired and never creates persistent revocations for them", async () => {
    const replicaA = loadReplica();
    const expired = payload("expired-jti", Math.floor(Date.now() / 1000) - 1);

    await expect(replicaA.revokeAccessTokenPayload(expired)).resolves.toBe(false);
    await expect(replicaA.isAccessTokenRevoked(expired)).resolves.toBe(false);
    expect(redisClient.set).not.toHaveBeenCalled();
  });

  it("does not treat a Redis command failure as an unrevoked token", async () => {
    const replicaA = loadReplica();
    redisClient.exists.mockRejectedValueOnce(new Error("command timeout"));

    await expect(replicaA.isAccessTokenRevoked(payload())).rejects.toMatchObject({
      statusCode: 503,
      code: "TOKEN_REVOCATION_UNAVAILABLE",
    });
  });
});
