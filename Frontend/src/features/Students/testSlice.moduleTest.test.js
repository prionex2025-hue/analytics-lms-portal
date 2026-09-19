import { describe, it, expect } from "vitest";
import reducer, { advanceModule, resetAttemptState } from "./testSlice";

const baseState = reducer(undefined, { type: "@@INIT" });

describe("testSlice MODULE_TEST behavior", () => {
  it("has OPEN_TEST module defaults", () => {
    expect(baseState.assessment_format).toBe("OPEN_TEST");
    expect(baseState.modules).toEqual([]);
    expect(baseState.current_module).toBeNull();
    expect(baseState.server_module_end_time).toBeNull();
  });

  it("marks submit as submitted when advance completes the attempt", () => {
    const next = reducer(
      { ...baseState, advance_status: "advancing" },
      advanceModule.fulfilled({ completed: true, normalized: null }, "req", {})
    );
    expect(next.submit_status).toBe("submitted");
    expect(next.advance_status).toBe("idle");
  });

  it("swaps to the next module's questions/timer on advance", () => {
    const normalized = {
      attempt_id: "a1",
      test_id: "t1",
      question_order: ["q10", "q11"],
      questions: { q10: { id: "q10" }, q11: { id: "q11" } },
      answers: {},
      marked_for_review: [],
      current_question_index: 0,
      server_end_time: 2000,
      clock_offset_ms: 0,
      violations: baseState.violations,
      proctoring_config: baseState.proctoring_config,
      assessment_format: "MODULE_TEST",
      modules: [
        { key: "QUANT", name: "Quantitative Aptitude", order: 1, status: "MANUAL_SUBMIT", isCurrent: false },
        { key: "REASONING", name: "Logical Reasoning", order: 2, status: "ACTIVE", isCurrent: true },
      ],
      current_module: { key: "REASONING", name: "Logical Reasoning", order: 2 },
      server_module_end_time: 1500,
    };

    const prev = {
      ...baseState,
      changed_answer_ids: ["q1"],
      current_question_index: 5,
      current_module: { key: "QUANT", order: 1 },
    };

    const next = reducer(prev, advanceModule.fulfilled({ completed: false, normalized }, "req", {}));

    expect(next.current_module.key).toBe("REASONING");
    expect(next.question_order).toEqual(["q10", "q11"]);
    expect(next.server_module_end_time).toBe(1500);
    expect(next.current_question_index).toBe(0);
    expect(next.changed_answer_ids).toEqual([]);
    expect(next.submit_status).not.toBe("submitted");
  });

  it("resets module fields on resetAttemptState", () => {
    const dirty = { ...baseState, assessment_format: "MODULE_TEST", modules: [{ key: "QUANT" }], current_module: { key: "QUANT" }, server_module_end_time: 99 };
    const next = reducer(dirty, resetAttemptState());
    expect(next.assessment_format).toBe("OPEN_TEST");
    expect(next.modules).toEqual([]);
    expect(next.current_module).toBeNull();
    expect(next.server_module_end_time).toBeNull();
  });
});
