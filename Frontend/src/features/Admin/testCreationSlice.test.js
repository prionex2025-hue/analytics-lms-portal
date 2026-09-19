import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import reducer, {
  openTestEditDialog,
  submitTestCreation,
} from "./testCreationSlice";
import { adminApi, superAdminApi } from "@/services/api";

vi.mock("@/services/api", () => ({
  adminApi: {
    createTest: vi.fn(),
    updateTest: vi.fn(),
  },
  superAdminApi: {
    createGlobalTest: vi.fn(),
    updateTest: vi.fn(),
  },
}));

const collegeId = "507f1f77bcf86cd799439011";
const departmentId = "507f1f77bcf86cd799439012";
const batchId = "507f1f77bcf86cd799439013";

const createStore = () => configureStore({
  reducer: {
    testCreation: reducer,
  },
});

const createValidForm = (overrides = {}) => {
  const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  return {
    name: "Production Readiness Test",
    description: "Contract regression",
    subject: "Algorithms",
    durationMins: 60,
    totalMarks: 10,
    startsAt,
    endsAt,
    attemptsAllowed: 1,
    evaluationRule: "BEST_ATTEMPT",
    negativeMarkingEnabled: false,
    negativeMarks: 0,
    skipOverlapCheck: false,
    assignmentMethod: "department_wise",
    years: [1, 2],
    departmentId,
    departmentIds: [departmentId],
    batchIds: [],
    questionInputMode: "manual",
    questions: [
      {
        type: "mcq",
        question: "What is 2 + 2?",
        options: ["4", "5"],
        correctAnswer: "4",
        marks: 10,
        difficulty: "EASY",
        topic: "Math",
      },
    ],
    shuffleQuestions: false,
    shuffleAnswers: false,
    restrictions: {
      enabled: true,
      tabSwitch: "monitored",
      copyPaste: "monitored",
      fullscreenRequired: false,
      windowBlur: false,
      screenshotDetection: false,
      rightClickDisabled: false,
      devtoolsDetection: false,
      violationThreshold: 2,
      autoNextSingle: false,
      paragraphWordLimit: 200,
    },
    testType: "STANDARD",
    proctoringPreset: "STANDARD_TEST",
    publishState: "DRAFT",
    allColleges: false,
    collegeIds: [collegeId],
    ...overrides,
  };
};

describe("submitTestCreation contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminApi.createTest.mockResolvedValue({ id: "admin-test-1" });
    superAdminApi.createGlobalTest.mockResolvedValue({ data: [{ id: "super-test-1" }] });
  });

  it("submits the provided form snapshot instead of stale store state", async () => {
    const store = createStore();
    const state = store.getState().testCreation;
    const snapshot = {
      ...state,
      form: createValidForm({
        publishState: "UPCOMING",
        skipOverlapCheck: true,
      }),
    };

    await store.dispatch(submitTestCreation(snapshot)).unwrap();

    expect(adminApi.createTest).toHaveBeenCalledWith(expect.objectContaining({
      publishState: "UPCOMING",
      skipOverlapCheck: true,
    }));
  });

  it("sends publishState and target scope to the super-admin test API", async () => {
    const store = createStore();
    const state = store.getState().testCreation;
    const snapshot = {
      ...state,
      context: "super_admin",
      form: createValidForm({
        publishState: "DRAFT",
        allColleges: false,
        collegeIds: [collegeId],
        assignmentMethod: "batch_wise",
        departmentIds: [],
        batchIds: [batchId],
      }),
    };

    await store.dispatch(submitTestCreation(snapshot)).unwrap();

    expect(superAdminApi.createGlobalTest).toHaveBeenCalledWith(expect.objectContaining({
      publishState: "DRAFT",
      allColleges: false,
      collegeIds: [collegeId],
      assignmentMethod: "batch_wise",
      batchIds: [batchId],
    }));
  });
});

describe("testCreationSlice edit hydration", () => {
  it("hydrates super-admin department-wise scope from assignedTo", () => {
    const state = reducer(
      undefined,
      openTestEditDialog({
        test: {
          id: "test-1",
          title: "Physics",
          assignmentMethod: "department_wise",
          collegeId: "college-1",
          assignedTo: ["dept-1", "dept-2"],
          batchAssignments: [],
        },
      })
    );

    expect(state.form.departmentIds).toEqual(["dept-1", "dept-2"]);
    expect(state.form.collegeIds).toEqual(["college-1"]);
  });
});
