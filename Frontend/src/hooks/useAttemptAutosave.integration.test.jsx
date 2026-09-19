import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { renderHook, act, waitFor } from "@testing-library/react";
import testReducer from "@/features/Students/testSlice";
import { useAttemptAutosave } from "@/hooks/useAttemptAutosave";
import { studentApi } from "@/services/studentApi";

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
        questions: { q1: { id: "q1", type: "MCQ_SINGLE", prompt: "Q1", options: ["A"] } },
        answers: {
          q1: {
            selected_option: "A",
            selected_options: [],
            answer_boolean: null,
            answer_text: "",
            marked_for_review: false,
          },
        },
        changed_answer_ids: ["q1"],
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
        start_status: "idle",
        load_status: "idle",
        heartbeat_status: "idle",
        last_error: null,
        pending_submit: null,
      },
    },
  });

// Drafts persist in localStorage (survives tab close / crash) wrapped as
// { v, savedAt, answers }; legacy plain-array sessionStorage drafts are still
// readable for migration.
const readLocalDraft = (attemptId) => {
  const raw = localStorage.getItem(`lms:attempt:draft:${attemptId}`);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed?.answers || [];
};

describe("useAttemptAutosave integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  it("writes changed answers to a durable local draft immediately for crash recovery", async () => {
    studentApi.patchAttemptAnswers.mockResolvedValue({ saved: true });
    const store = createStore();

    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

    const { unmount } = renderHook(() => useAttemptAutosave(), { wrapper });

    await waitFor(() => {
      expect(readLocalDraft("attempt-1")).toEqual([
        expect.objectContaining({
          question_id: "q1",
          selected_option: "A",
        }),
      ]);
    });

    unmount();
  });

  it("keeps answers local and skips the API while offline", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });

    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

    const { result, unmount } = renderHook(() => useAttemptAutosave(), { wrapper });

    await act(async () => {
      await result.current.flushPendingSaves();
    });

    expect(studentApi.patchAttemptAnswers).not.toHaveBeenCalled();
    expect(store.getState().test.save_status).toBe("error");
    expect(readLocalDraft("attempt-1")).toHaveLength(1);

    unmount();
  });

  it("restores a legacy sessionStorage draft after refresh and sends it on the next save", async () => {
    sessionStorage.setItem(
      "lms:attempt:draft:attempt-1",
      JSON.stringify([
        {
          question_id: "q1",
          selected_option: "B",
          selected_options: [],
          answer_boolean: null,
          answer_text: "",
          marked_for_review: false,
        },
      ])
    );
    studentApi.patchAttemptAnswers.mockResolvedValue({ saved: true });
    const store = createStore();
    store.dispatch({ type: "test/clearChangedAnswerIds", payload: ["q1"] });

    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { result, unmount } = renderHook(() => useAttemptAutosave(), { wrapper });

    await waitFor(() => {
      expect(store.getState().test.answers.q1.selected_option).toBe("B");
      expect(store.getState().test.changed_answer_ids).toContain("q1");
    });

    await act(async () => {
      await result.current.flushPendingSaves();
    });

    await waitFor(() => {
      expect(studentApi.patchAttemptAnswers).toHaveBeenCalledWith({
        attemptId: "attempt-1",
        testId: "test-1",
        changedAnswers: [
          expect.objectContaining({
            question_id: "q1",
            selected_option: "B",
          }),
        ],
      });
    });

    unmount();
  });

  it("debounces and sends changed answers to autosave API", async () => {
    studentApi.patchAttemptAnswers.mockResolvedValue({ saved: true });
    const store = createStore();

    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

    const { result, unmount } = renderHook(() => useAttemptAutosave(), { wrapper });

    await act(async () => {
      await result.current.flushPendingSaves();
    });

    await waitFor(() => {
      expect(studentApi.patchAttemptAnswers).toHaveBeenCalledTimes(1);
    });

    expect(studentApi.patchAttemptAnswers).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      testId: "test-1",
      changedAnswers: [
        {
          question_id: "q1",
          selected_option: "A",
          selected_options: [],
          answer_boolean: null,
          answer_text: "",
          marked_for_review: false,
        },
      ],
    });

    expect(store.getState().test.save_status).toBe("saved");
    unmount();
  });
});
