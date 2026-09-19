import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { renderHook, act } from "@testing-library/react";
import testReducer from "@/features/Students/testSlice";
import { useAttemptHeartbeat } from "@/hooks/useAttemptHeartbeat";
import { studentApi } from "@/services/studentApi";

vi.mock("@/services/studentApi", () => ({
  studentApi: {
    heartbeatAttempt: vi.fn(),
    patchAttemptAnswers: vi.fn(),
    reportAttemptViolation: vi.fn(),
    submitAttempt: vi.fn(),
    startAttempt: vi.fn(),
    getAttemptSession: vi.fn(),
    getActiveAttempts: vi.fn(),
    getUpcomingTests: vi.fn(),
  },
}));

const createStore = () => configureStore({ reducer: { test: testReducer } });

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useAttemptHeartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("keeps firing heartbeats even when the parent re-renders with new callback identities", async () => {
    // Regression: the countdown re-renders the exam page ~every second, faster
    // than the 5s heartbeat delay. With unstable callbacks in the deps, the
    // effect reset on every render and the heartbeat never fired.
    studentApi.heartbeatAttempt.mockResolvedValue({ ok: true });
    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

    const { rerender } = renderHook(
      () =>
        useAttemptHeartbeat({
          attemptId: "attempt-1",
          testId: "test-1",
          // Fresh function identities every render, exactly like the page.
          onNotFound: () => {},
          onAlreadySubmitted: () => {},
        }),
      { wrapper }
    );

    // Re-render every second across a >5s span, mimicking the countdown. On the
    // buggy version each render (< the 5s delay apart) cleared the pending
    // heartbeat timeout before it could fire, so NO heartbeat ever went out.
    for (let second = 0; second < 7; second += 1) {
      rerender();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      await flushMicrotasks();
    }

    expect(studentApi.heartbeatAttempt.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("stops firing after unmount", async () => {
    studentApi.heartbeatAttempt.mockResolvedValue({ ok: true });
    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

    const { unmount } = renderHook(
      () => useAttemptHeartbeat({ attemptId: "attempt-1", testId: "test-1", onNotFound: () => {}, onAlreadySubmitted: () => {} }),
      { wrapper }
    );

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    await flushMicrotasks();
    expect(studentApi.heartbeatAttempt).not.toHaveBeenCalled();
  });
});
