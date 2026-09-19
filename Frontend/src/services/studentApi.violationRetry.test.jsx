import { describe, it, expect, beforeEach, vi } from "vitest";

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("@/services/httpClient", () => ({
  httpClient: { get: getMock, post: postMock },
  toApiError: (error) => {
    const payload = error?.response?.data || {};
    const status = error?.response?.status || null;
    const apiError = new Error(payload?.message || error?.message || "Request failed");
    apiError.code = payload?.code || "REQUEST_FAILED";
    apiError.status = status;
    return apiError;
  },
}));

import { studentApi } from "@/services/studentApi";

const httpError = (status) => ({ response: { status, data: { message: `err ${status}` } } });
const networkError = () => Object.assign(new Error("Network Error"), { response: undefined });

const args = { attemptId: "a1", testId: "t1", type: "TAB_SWITCH", metadata: {} };

describe("reportAttemptViolation retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const run = async (fn) => {
    const promise = fn();
    // Keep the rejection "handled" while timers advance; the caller still
    // observes it via the returned promise. Without this, a rejection that
    // settles during runAllTimersAsync is flagged as unhandled.
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    return promise;
  };

  it("returns immediately on success without retrying", async () => {
    postMock.mockResolvedValueOnce({ data: { violationCount: 1 } });
    const result = await run(() => studentApi.reportAttemptViolation(args));
    expect(result).toEqual({ violationCount: 1 });
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 5xx and eventually succeeds", async () => {
    postMock
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: { violationCount: 2 } });
    const result = await run(() => studentApi.reportAttemptViolation(args));
    expect(result).toEqual({ violationCount: 2 });
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network error (no response)", async () => {
    postMock
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ data: { violationCount: 3 } });
    const result = await run(() => studentApi.reportAttemptViolation(args));
    expect(result).toEqual({ violationCount: 3 });
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 rate-limit", async () => {
    postMock
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce({ data: { ok: true } });
    await run(() => studentApi.reportAttemptViolation(args));
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a terminal 409 (already submitted)", async () => {
    postMock.mockRejectedValueOnce(httpError(409));
    await expect(run(() => studentApi.reportAttemptViolation(args))).rejects.toMatchObject({ status: 409 });
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget on persistent failure", async () => {
    postMock.mockRejectedValue(httpError(500));
    await expect(run(() => studentApi.reportAttemptViolation(args))).rejects.toMatchObject({ status: 500 });
    // initial attempt + 2 retries
    expect(postMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to the legacy endpoint on 404", async () => {
    postMock
      .mockRejectedValueOnce(httpError(404)) // primary /tests/:id/violation
      .mockResolvedValueOnce({ data: { violationCount: 5 } }); // legacy /attempts/:id/violations
    const result = await run(() => studentApi.reportAttemptViolation(args));
    expect(result).toEqual({ violationCount: 5 });
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock.mock.calls[1][0]).toBe("/attempts/a1/violations");
  });
});
