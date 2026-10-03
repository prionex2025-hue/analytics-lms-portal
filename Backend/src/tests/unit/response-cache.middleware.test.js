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

  const runDirectRequest = (cache, { request, statusCode = 200, respond }) =>
    new Promise((resolve) => {
      const headers = {};
      let payload = null;
      let nextCalled = false;
      const res = {
        statusCode,
        setHeader(name, value) {
          headers[name] = value;
        },
        getHeader(name) {
          return headers[name];
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(value) {
          payload = value;
          resolve({ headers, statusCode: this.statusCode, payload, nextCalled });
          return this;
        },
      };

      cache(request, res, () => {
        nextCalled = true;
        respond(res);
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

  it("coalesces concurrent identical misses and replays the leader response", async () => {
    const { createResponseCache } = loadModule();
    const cache = createResponseCache({ scope: "single-flight", ttlSeconds: 30, singleFlightTimeoutMs: 1000 });
    const request = {
      method: "GET",
      originalUrl: "/api/admin/reports?college=college-1",
      query: { college: "college-1" },
      headers: {},
      authIdentity: "user:ADMIN:admin-1",
      admin: { id: "admin-1", collegeId: "college-1" },
    };

    const [leader, follower] = await Promise.all([
      runDirectRequest(cache, {
        request,
        respond: (res) => setTimeout(() => res.json({ data: ["leader"] }), 50),
      }),
      runDirectRequest(cache, {
        request,
        respond: (res) => res.json({ data: ["should-not-execute"] }),
      }),
    ]);

    expect(leader.nextCalled).toBe(true);
    expect(leader.headers["X-Response-Cache"]).toBe("MISS");
    expect(follower.nextCalled).toBe(false);
    expect(follower.headers["X-Response-Cache"]).toBe("SHARED");
    expect(follower.payload).toEqual({ data: ["leader"] });

    const nextHit = await invokeCache(cache, request, undefined);
    expect(nextHit.nextCalled).toBe(false);
    expect(nextHit.headers["X-Response-Cache"]).toBe("HIT");
    expect(nextHit.payload).toEqual({ data: ["leader"] });
  });

  it("does not share non-cacheable leader responses", async () => {
    const { createResponseCache } = loadModule();
    const cache = createResponseCache({ scope: "single-flight-errors", ttlSeconds: 30, singleFlightTimeoutMs: 1000 });
    const request = {
      method: "GET",
      originalUrl: "/api/admin/reports?college=college-1",
      query: { college: "college-1" },
      headers: {},
      authIdentity: "user:ADMIN:admin-1",
      admin: { id: "admin-1", collegeId: "college-1" },
    };

    const [failed, retried] = await Promise.all([
      runDirectRequest(cache, {
        request,
        statusCode: 500,
        respond: (res) => res.json({ error: "leader-failed" }),
      }),
      runDirectRequest(cache, {
        request,
        respond: (res) => res.json({ data: ["follower-retried"] }),
      }),
    ]);

    expect(failed.nextCalled).toBe(true);
    expect(failed.headers["X-Response-Cache"]).toBe("MISS");
    expect(retried.nextCalled).toBe(true);
    expect(retried.payload).toEqual({ data: ["follower-retried"] });
  });

  it("preserves the previous behavior when single-flight is disabled", async () => {
    const { createResponseCache } = loadModule();
    const cache = createResponseCache({ scope: "no-single-flight", ttlSeconds: 30, singleFlight: false });
    const request = {
      method: "GET",
      originalUrl: "/api/admin/reports?college=college-1",
      query: { college: "college-1" },
      headers: {},
      authIdentity: "user:ADMIN:admin-1",
      admin: { id: "admin-1", collegeId: "college-1" },
    };

    const [first, second] = await Promise.all([
      runDirectRequest(cache, {
        request,
        respond: (res) => setTimeout(() => res.json({ data: ["first"] }), 30),
      }),
      runDirectRequest(cache, {
        request,
        respond: (res) => res.json({ data: ["second"] }),
      }),
    ]);

    expect(first.nextCalled).toBe(true);
    expect(second.nextCalled).toBe(true);
    expect(first.payload).toEqual({ data: ["first"] });
    expect(second.payload).toEqual({ data: ["second"] });
  });
});
