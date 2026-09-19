import { describe, it, expect, beforeEach, vi } from "vitest";

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("@/services/httpClient", () => ({
  httpClient: {
    get: getMock,
    post: postMock,
  },
  toApiError: (error) => {
    const payload = error?.response?.data || {};
    const status = error?.response?.status || null;
    const apiError = new Error(payload?.message || error?.message || "Request failed");
    apiError.code = payload?.code || "REQUEST_FAILED";
    apiError.status = status;
    apiError.details = payload?.details || null;
    apiError.retryable = false;
    return apiError;
  },
}));

import { studentApi } from "@/services/studentApi";

const conflictError = {
  response: {
    status: 409,
    data: {
      code: "ACTIVE_SESSION_EXISTS",
      message: "Test is already active in another tab/device",
    },
  },
};

const genericConflictError = {
  response: {
    status: 409,
    data: {
      message: "Conflict",
    },
  },
};

describe("studentApi mobile conflict recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recovers startAttempt by resuming existing active attempt on ACTIVE_SESSION_EXISTS", async () => {
    postMock.mockImplementation(async (url) => {
      if (String(url).includes("/tests/") && String(url).endsWith("/start")) {
        throw conflictError;
      }

      throw new Error(`Unexpected POST: ${url}`);
    });

    getMock.mockImplementation(async (url) => {
      if (url === "/attempts/active") {
        return {
          data: [
            {
              id: "test-123",
              submissionId: "attempt-abc",
              latestSubmissionStatus: "IN_PROGRESS",
            },
          ],
          headers: {},
        };
      }

      if (url === "/attempts/attempt-abc") {
        return {
          data: {
            attempt_id: "attempt-abc",
            test_id: "test-123",
            submission: { id: "attempt-abc" },
            test: { id: "test-123", questions: [] },
          },
          headers: {},
        };
      }

      throw new Error(`Unexpected GET: ${url}`);
    });

    const result = await studentApi.startAttempt({ test_id: "test-123" });

    expect(result?.attempt_id).toBe("attempt-abc");
    expect(getMock).toHaveBeenCalledWith("/attempts/attempt-abc");
  });

  it("falls back to direct attempt session when getTestSession conflicts", async () => {
    getMock.mockImplementation(async (url) => {
      if (url === "/attempts/active") {
        return {
          data: [
            {
              id: "test-123",
              submissionId: "attempt-abc",
              latestSubmissionStatus: "IN_PROGRESS",
            },
          ],
          headers: {},
        };
      }

      if (url === "/tests/test-123/session") {
        throw conflictError;
      }

      if (url === "/attempts/attempt-abc") {
        return {
          data: {
            attempt_id: "attempt-abc",
            test_id: "test-123",
            submission: { id: "attempt-abc" },
            test: { id: "test-123", questions: [] },
          },
          headers: {},
        };
      }

      throw new Error(`Unexpected GET: ${url}`);
    });

    const result = await studentApi.getAttemptSession("attempt-abc");

    expect(result?.attempt_id).toBe("attempt-abc");
    expect(getMock).toHaveBeenCalledWith("/attempts/attempt-abc");
  });

  it("recovers startAttempt on generic 409 conflicts without specific code", async () => {
    postMock.mockImplementation(async (url) => {
      if (String(url).includes("/tests/") && String(url).endsWith("/start")) {
        throw genericConflictError;
      }

      throw new Error(`Unexpected POST: ${url}`);
    });

    getMock.mockImplementation(async (url) => {
      if (url === "/attempts/active") {
        return {
          data: [
            {
              id: "test-123",
              submissionId: "attempt-abc",
              latestSubmissionStatus: "IN_PROGRESS",
            },
          ],
          headers: {},
        };
      }

      if (url === "/attempts/attempt-abc") {
        return {
          data: {
            attempt_id: "attempt-abc",
            test_id: "test-123",
            submission: { id: "attempt-abc" },
            test: { id: "test-123", questions: [] },
          },
          headers: {},
        };
      }

      throw new Error(`Unexpected GET: ${url}`);
    });

    const result = await studentApi.startAttempt({ test_id: "test-123" });

    expect(result?.attempt_id).toBe("attempt-abc");
    expect(getMock).toHaveBeenCalledWith("/attempts/attempt-abc");
  });

  it("dedupes concurrent startAttempt calls for the same test", async () => {
    let startResolved;
    const startPromise = new Promise((resolve) => {
      startResolved = resolve;
    });

    postMock.mockImplementation(async (url) => {
      if (String(url).includes("/tests/") && String(url).endsWith("/start")) {
        return await startPromise;
      }

      throw new Error(`Unexpected POST: ${url}`);
    });

    const p1 = studentApi.startAttempt({ test_id: "test-123" });
    const p2 = studentApi.startAttempt({ test_id: "test-123" });

    expect(postMock).toHaveBeenCalledTimes(1);

    startResolved({
      data: {
        attempt_id: "attempt-abc",
        test_id: "test-123",
        question_order: [],
        questions: [],
      },
      headers: {},
    });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1?.attempt_id).toBe("attempt-abc");
    expect(r2?.attempt_id).toBe("attempt-abc");
  });
});
