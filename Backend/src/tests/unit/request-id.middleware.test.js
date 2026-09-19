const { normalizeRequestId, requestIdMiddleware } = require("../../middleware/request-id");

describe("requestIdMiddleware", () => {
  it("keeps a safe incoming request id", () => {
    expect(normalizeRequestId("req_123456789")).toBe("req_123456789");
  });

  it("replaces unsafe request ids", () => {
    const requestId = normalizeRequestId("bad\nheader");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("attaches the request id to req and response headers", () => {
    const req = {
      headers: {
        "x-request-id": "safe-request-1",
      },
    };
    const headers = {};
    const res = {
      setHeader: jest.fn((name, value) => {
        headers[name] = value;
      }),
    };
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(req.id).toBe("safe-request-1");
    expect(req.requestId).toBe("safe-request-1");
    expect(headers["X-Request-Id"]).toBe("safe-request-1");
    expect(next).toHaveBeenCalledWith();
  });
});
