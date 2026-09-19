describe("rate-limit-metrics service", () => {
  const loadModule = () => {
    jest.resetModules();

    jest.doMock("../../config/redis", () => ({
      redisClient: {
        get: jest.fn(),
        ttl: jest.fn(),
        expire: jest.fn(),
        zrevrange: jest.fn(),
        zincrby: jest.fn(),
        incr: jest.fn(),
      },
      isRedisAvailable: () => false,
    }));

    return require("../../services/rate-limit-metrics.service");
  };

  it("builds an exam-only college-scoped snapshot for admin monitoring", async () => {
    const { recordRateLimitEvent, getExamRateLimitMetricsSnapshot } = loadModule();

    await recordRateLimitEvent({
      scope: "student-exam-heartbeat",
      route: "/api/tests/:testId/heartbeat",
      actor: "user:STUDENT:alpha",
      collegeId: "college-a",
    });
    await recordRateLimitEvent({
      scope: "student-exam-heartbeat",
      route: "/api/tests/:testId/heartbeat",
      actor: "user:STUDENT:alpha",
      collegeId: "college-a",
    });
    await recordRateLimitEvent({
      scope: "student-exam-submit",
      route: "/api/tests/:testId/submit",
      actor: "user:STUDENT:beta",
      collegeId: "college-b",
    });
    await recordRateLimitEvent({
      scope: "api-general",
      route: "/api/events",
      actor: "ip:1.2.3.4",
      collegeId: "college-a",
    });

    const collegeSnapshot = await getExamRateLimitMetricsSnapshot({
      limit: 5,
      collegeId: "college-a",
    });
    expect(collegeSnapshot.collegeScoped).toBe(true);
    expect(collegeSnapshot.scopeFamily).toBe("exam");
    expect(collegeSnapshot.totalBlocked).toBe(2);
    expect(collegeSnapshot.topScopes).toEqual([
      { label: "student-exam-heartbeat", blocked: 2 },
    ]);
    expect(collegeSnapshot.topRoutes).toEqual([
      { label: "/api/tests/:testId/heartbeat", blocked: 2 },
    ]);
    expect(collegeSnapshot.topActors[0].label).toMatch(/^user:STUDENT:/);
    expect(collegeSnapshot.topActors[0].label).not.toContain("alpha");
    expect(collegeSnapshot.topActors[0].blocked).toBe(2);

    const globalSnapshot = await getExamRateLimitMetricsSnapshot({ limit: 5 });
    expect(globalSnapshot.collegeScoped).toBe(false);
    expect(globalSnapshot.totalBlocked).toBe(3);
    expect(globalSnapshot.topScopes).toEqual([
      { label: "student-exam-heartbeat", blocked: 2 },
      { label: "student-exam-submit", blocked: 1 },
    ]);
  });
});
