describe("createResponseCache", () => {
  const loadModule = () => {
    jest.resetModules();

    jest.doMock("../../config/redis", () => ({
      redisClient: {},
      isRedisAvailable: () => false,
    }));

    jest.doMock("../../utils/token", () => ({
      verifyAccessToken: jest.fn(),
    }));

    return require("../../middleware/response-cache");
  };

  const invokeCache = (cache, reqOverrides = {}, body) =>
    new Promise((resolve) => {
      const headers = {};
      let statusCode = 200;
      let payload = null;
      let nextCalled = false;

      const req = {
        method: "GET",
        originalUrl: "/api/admin/reports",
        query: {},
        headers: {},
        ...reqOverrides,
      };

      const finish = () => setImmediate(() => resolve({ headers, statusCode, payload, nextCalled }));

      const res = {
        statusCode,
        setHeader(name, value) {
          headers[name] = value;
        },
        getHeader(name) {
          return headers[name];
        },
        status(code) {
          statusCode = code;
          this.statusCode = code;
          return this;
        },
        json(value) {
          payload = value;
          finish();
          return this;
        },
      };

      cache(req, res, () => {
        nextCalled = true;
        if (typeof body !== "undefined") {
          res.json(body);
        } else {
          finish();
        }
      });
    });

  it("does not serve or store protected caches before authentication", async () => {
    const { createResponseCache } = loadModule();
    const cache = createResponseCache({ scope: "protected-test", ttlSeconds: 30 });

    const first = await invokeCache(cache, {}, { secret: "cached" });
    expect(first.nextCalled).toBe(true);
    expect(first.headers["X-Response-Cache"]).toBeUndefined();

    const second = await invokeCache(cache, {}, { secret: "fresh" });
    expect(second.nextCalled).toBe(true);
    expect(second.payload).toEqual({ secret: "fresh" });
    expect(second.headers["X-Response-Cache"]).toBeUndefined();
  });

  it("serves cached responses only after authentication context exists", async () => {
    const { createResponseCache } = loadModule();
    const cache = createResponseCache({ scope: "protected-test-authenticated", ttlSeconds: 30 });
    const req = {
      authIdentity: "user:ADMIN:admin-1",
      admin: { id: "admin-1", collegeId: "college-1" },
    };

    const miss = await invokeCache(cache, req, { data: ["first"] });
    expect(miss.nextCalled).toBe(true);
    expect(miss.headers["X-Response-Cache"]).toBe("MISS");

    const hit = await invokeCache(cache, req);
    expect(hit.nextCalled).toBe(false);
    expect(hit.headers["X-Response-Cache"]).toBe("HIT");
    expect(hit.payload).toEqual({ data: ["first"] });
  });
});
