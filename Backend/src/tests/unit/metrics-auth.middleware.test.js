const invoke = async (middleware, reqOverrides = {}) => {
  const headers = {};
  let statusCode = null;
  let payload = null;
  const next = jest.fn();
  const req = {
    id: "req-12345678",
    headers: {},
    ...reqOverrides,
  };
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  await middleware(req, res, next);
  return {
    headers,
    statusCode,
    payload,
    next,
  };
};

describe("metricsAuth", () => {
  const loadModule = (metrics) => {
    jest.resetModules();
    jest.doMock("../../config/env", () => ({ metrics }));
    return require("../../middleware/metrics-auth");
  };

  it("returns 404 when metrics are disabled", async () => {
    const { metricsAuth } = loadModule({ enabled: false, token: "" });

    const result = await invoke(metricsAuth);

    expect(result.statusCode).toBe(404);
    expect(result.payload).toMatchObject({
      code: "ROUTE_NOT_FOUND",
      requestId: "req-12345678",
    });
    expect(result.next).not.toHaveBeenCalled();
  });

  it("rejects missing or incorrect bearer tokens", async () => {
    const { metricsAuth } = loadModule({ enabled: true, token: "secret-token-1234567890" });

    const result = await invoke(metricsAuth, {
      headers: {
        authorization: "Bearer wrong-token",
      },
    });

    expect(result.statusCode).toBe(401);
    expect(result.headers["WWW-Authenticate"]).toBe('Bearer realm="lms-metrics"');
    expect(result.payload.code).toBe("METRICS_UNAUTHORIZED");
    expect(result.next).not.toHaveBeenCalled();
  });

  it("allows valid bearer tokens", async () => {
    const { metricsAuth } = loadModule({ enabled: true, token: "secret-token-1234567890" });

    const result = await invoke(metricsAuth, {
      headers: {
        authorization: "Bearer secret-token-1234567890",
      },
    });

    expect(result.statusCode).toBeNull();
    expect(result.payload).toBeNull();
    expect(result.next).toHaveBeenCalledWith();
  });
});
