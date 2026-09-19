import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import testReducer from "@/features/Students/testSlice";
import TestEnvironmentPage from "@/pages/Students/TestEnvironmentPage";
import SubmissionPage from "@/pages/Students/SubmissionPage";
import { studentApi } from "@/services/studentApi";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/hooks/useProctoringGuard", () => ({
  useProctoringGuard: () => ({ fullscreenBlocked: false, reEnterFullscreen: vi.fn() }),
}));

vi.mock("@/hooks/useAttemptHeartbeat", () => ({
  useAttemptHeartbeat: () => {},
}));

vi.mock("@/hooks/useAttemptTimer", () => ({
  useAttemptTimer: () => ({ remainingMs: 120000, remainingSeconds: 120 }),
}));

vi.mock("@/hooks/useAttemptAutosave", () => ({
  useAttemptAutosave: () => ({ flushPendingSaves: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/services/studentApi", () => ({
  studentApi: {
    patchAttemptAnswers: vi.fn(),
    reportAttemptViolation: vi.fn(),
    heartbeatAttempt: vi.fn(),
    submitAttempt: vi.fn(),
    startAttempt: vi.fn(),
    getAttemptSession: vi.fn(),
    getActiveAttempts: vi.fn(),
    getUpcomingTests: vi.fn(),
  },
}));

const createStore = () =>
  configureStore({
    reducer: { test: testReducer },
    preloadedState: {
      test: {
        ongoing: [],
        upcoming: [],
        testsLoading: false,
        attempt_id: "attempt-1",
        test_id: "test-1",
        question_order: ["q1"],
        questions: { q1: { id: "q1", type: "MCQ_SINGLE", prompt: "Question 1", options: ["A"] } },
        answers: {
          q1: {
            selected_option: "A",
            selected_options: [],
            answer_boolean: null,
            answer_text: "",
            marked_for_review: false,
          },
        },
        changed_answer_ids: [],
        current_question_index: 0,
        marked_for_review: [],
        server_end_time: Date.now() + 60000,
        violations: { tab_switch: 0, copy: 0, paste: 0, window_blur: 0, total: 0 },
        proctoring_config: {
          enabled: true,
          threshold: 3,
          fullscreen_required: false,
          auto_next_single: false,
          paragraph_word_limit: 250,
        },
        save_status: "idle",
        submit_status: "idle",
        start_status: "ready",
        load_status: "ready",
        heartbeat_status: "idle",
        last_error: null,
        pending_submit: null,
      },
    },
  });

describe("TestEnvironment submit recovery integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });

    studentApi.getAttemptSession.mockResolvedValue({
      attempt_id: "attempt-1",
      test_id: "test-1",
      question_order: ["q1"],
      questions: [{ id: "q1", prompt: "Question 1", type: "MCQ_SINGLE", options: ["A"] }],
      answers: [],
      server_end_time: new Date(Date.now() + 60000).toISOString(),
      proctoring_config: { threshold: 3 },
    });

    studentApi.submitAttempt.mockResolvedValue({
      submission: {
        id: "attempt-1",
        status: "SUBMITTED",
        submittedAt: new Date().toISOString(),
        timeSpentSeconds: 60,
        attemptNumber: 1,
      },
      summary: {
        score: 90,
        accuracy: 95,
        timeSpentSeconds: 60,
        attemptNumber: 1,
      },
    });
  });

  it("retries pending submission from sessionStorage on initial load", async () => {
    sessionStorage.setItem(
      "lms:test:pending-submit",
      JSON.stringify({
        attempt_id: "attempt-1",
        test_id: "test-1",
        reason: "retry_submission",
        created_at: Date.now(),
      })
    );

    const store = createStore();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/test/attempt-1"]}>
            <Routes>
              <Route path="/test/:attemptId" element={<TestEnvironmentPage />} />
              <Route path="/submission/:submissionId" element={<SubmissionPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>
    );

    await waitFor(() => {
      expect(studentApi.submitAttempt).toHaveBeenCalledWith({
        attemptId: "attempt-1",
        testId: "test-1",
        reason: "retry_submission",
      });
    }, {
      timeout: 2500,
    });

    expect(await screen.findByText("Assessment Submitted")).toBeInTheDocument();
  });
});
