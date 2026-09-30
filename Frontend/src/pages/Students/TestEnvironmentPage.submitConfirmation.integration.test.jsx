import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import testReducer from "@/features/Students/testSlice";
import TestEnvironmentPage from "@/pages/Students/TestEnvironmentPage";
import SubmissionPage from "@/pages/Students/SubmissionPage";
import { studentApi } from "@/services/studentApi";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useProctoringGuard", () => ({
  useProctoringGuard: () => ({ fullscreenBlocked: false, reEnterFullscreen: vi.fn() }),
}));

vi.mock("@/hooks/useAttemptHeartbeat", () => ({ useAttemptHeartbeat: () => {} }));

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
    advanceModule: vi.fn(),
    startAttempt: vi.fn(),
    getAttemptSession: vi.fn(),
    getActiveAttempts: vi.fn(),
    getUpcomingTests: vi.fn(),
  },
}));

const QUESTIONS = [
  { id: "q1", prompt: "Question 1", type: "MCQ_SINGLE", options: ["A", "B"] },
  { id: "q2", prompt: "Question 2", type: "MCQ_SINGLE", options: ["A", "B"] },
  { id: "q3", prompt: "Question 3", type: "MCQ_SINGLE", options: ["A", "B"] },
];

const sessionPayload = (overrides = {}) => ({
  attempt_id: "attempt-1",
  test_id: "test-1",
  question_order: ["q1", "q2", "q3"],
  questions: QUESTIONS,
  answers: [{ question_id: "q1", selected_option: "A" }],
  server_end_time: new Date(Date.now() + 60000).toISOString(),
  proctoring_config: { threshold: 3 },
  assessment_format: "OPEN_TEST",
  modules: [],
  ...overrides,
});

const baseState = {
  ongoing: [],
  upcoming: [],
  testsLoading: false,
  attempt_id: "attempt-1",
  test_id: "test-1",
  question_order: ["q1", "q2", "q3"],
  questions: Object.fromEntries(QUESTIONS.map((q) => [q.id, q])),
  answers: {
    q1: { selected_option: "A", selected_options: [], answer_boolean: null, answer_text: "" },
    q2: { selected_option: null, selected_options: [], answer_boolean: null, answer_text: "" },
    q3: { selected_option: null, selected_options: [], answer_boolean: null, answer_text: "" },
  },
  changed_answer_ids: [],
  current_question_index: 0,
  marked_for_review: ["q2"],
  server_end_time: Date.now() + 60000,
  violations: { tab_switch: 0, copy: 0, paste: 0, window_blur: 0, total: 0 },
  proctoring_config: { enabled: false, threshold: 3 },
  save_status: "idle",
  submit_status: "idle",
  start_status: "ready",
  load_status: "ready",
  heartbeat_status: "idle",
  last_error: null,
  pending_submit: null,
  advance_status: "idle",
  assessment_format: "OPEN_TEST",
  modules: [],
  current_module: null,
  server_module_end_time: null,
};

const createStore = (overrides = {}) =>
  configureStore({
    reducer: { test: testReducer },
    preloadedState: { test: { ...baseState, ...overrides } },
  });

const renderPage = (store) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
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
};

describe("TestEnvironment submit confirmation dialogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    studentApi.getAttemptSession.mockResolvedValue(sessionPayload());
    studentApi.submitAttempt.mockResolvedValue({
      submission: { id: "attempt-1", status: "SUBMITTED" },
      summary: { score: 50, accuracy: 50 },
    });
    studentApi.advanceModule.mockResolvedValue({ completed: false });
  });

  it("OPEN_TEST: confirms before submitting and reports the answer breakdown", async () => {
    const user = userEvent.setup();
    renderPage(createStore());

    const [submitBtn] = await screen.findAllByRole("button", { name: /submit test/i });
    await user.click(submitBtn);

    expect(await screen.findByText("Confirm Test Submission")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByText("2 questions left unanswered in this test will be submitted blank and marked incorrect.")).toBeInTheDocument();
    expect(studentApi.submitAttempt).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByText("Confirm Test Submission")).not.toBeInTheDocument();
    });
    expect(studentApi.submitAttempt).not.toHaveBeenCalled();
  });

  it("OPEN_TEST: submits only after the student confirms", async () => {
    const user = userEvent.setup();
    renderPage(createStore());

    const [submitBtn] = await screen.findAllByRole("button", { name: /submit test/i });
    await user.click(submitBtn);

    const [confirmBtn] = await screen.findAllByRole("button", { name: /^submit test$/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(studentApi.submitAttempt).toHaveBeenCalledWith({
        attemptId: "attempt-1",
        testId: "test-1",
        reason: "manual_submit",
      });
    });
  });

  it("MODULE_TEST: confirms the section with the section answer breakdown", async () => {
    const user = userEvent.setup();
    studentApi.getAttemptSession.mockResolvedValue(
      sessionPayload({
        assessment_format: "MODULE_TEST",
        server_module_end_time: new Date(Date.now() + 60000).toISOString(),
        modules: [
          { key: "m1", name: "Quant", order: 1, status: "IN_PROGRESS", isCurrent: true },
          { key: "m2", name: "Reasoning", order: 2, status: "NOT_STARTED" },
        ],
        current_module: { key: "m1", name: "Quant", order: 1 },
      })
    );

    renderPage(
      createStore({
        assessment_format: "MODULE_TEST",
        modules: [
          { key: "m1", name: "Quant", order: 1, status: "IN_PROGRESS", isCurrent: true },
          { key: "m2", name: "Reasoning", order: 2, status: "NOT_STARTED" },
        ],
        current_module: { key: "m1", name: "Quant", order: 1 },
        server_module_end_time: Date.now() + 60000,
      })
    );

    const [submitBtn] = await screen.findAllByRole("button", { name: /submit section & continue/i });
    await user.click(submitBtn);

    expect(await screen.findByText("Submit Quant")).toBeInTheDocument();
    expect(screen.getByText("2 questions left unanswered in the Quant section will be submitted blank and marked incorrect.")).toBeInTheDocument();
    expect(studentApi.advanceModule).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /submit & continue/i }));

    await waitFor(() => {
      expect(studentApi.advanceModule).toHaveBeenCalledTimes(1);
    });
  });

  it("MODULE_TEST: last section confirmation is scoped to the whole test", async () => {
    const user = userEvent.setup();
    studentApi.getAttemptSession.mockResolvedValue(
      sessionPayload({
        assessment_format: "MODULE_TEST",
        modules: [{ key: "m2", name: "Reasoning", order: 2, status: "IN_PROGRESS", isCurrent: true }],
        current_module: { key: "m2", name: "Reasoning", order: 2 },
      })
    );

    renderPage(
      createStore({
        assessment_format: "MODULE_TEST",
        modules: [
          { key: "m1", name: "Quant", order: 1, status: "MANUAL_SUBMIT" },
          { key: "m2", name: "Reasoning", order: 2, status: "IN_PROGRESS", isCurrent: true },
        ],
        current_module: { key: "m2", name: "Reasoning", order: 2 },
      })
    );

    const [submitBtn] = await screen.findAllByRole("button", { name: /finish test/i });
    await user.click(submitBtn);

    expect(await screen.findByText("This is the final section. Submitting will complete your test and you cannot return to any section.")).toBeInTheDocument();
    expect(screen.getByText("2 questions left unanswered in this test will be submitted blank and marked incorrect.")).toBeInTheDocument();
    expect(studentApi.advanceModule).not.toHaveBeenCalled();
  });

  it("reports when every question is answered", async () => {
    const user = userEvent.setup();
    studentApi.getAttemptSession.mockResolvedValue(
      sessionPayload({
        answers: [
          { question_id: "q1", selected_option: "A" },
          { question_id: "q2", selected_option: "B" },
          { question_id: "q3", selected_option: "A" },
        ],
      })
    );

    renderPage(
      createStore({
        answers: {
          q1: { selected_option: "A" },
          q2: { selected_option: "B" },
          q3: { selected_option: "A" },
        },
      })
    );

    const [submitBtn] = await screen.findAllByRole("button", { name: /submit test/i });
    await user.click(submitBtn);

    expect(await screen.findByText("All 3 questions answered.")).toBeInTheDocument();
  });
});