import { act, render, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TestCreationDialog from "@/components/Admin/TestCreationDialog";
import testCreationReducer, {
  openTestEditDialog,
  setTestCreationContext,
  setTestCreationStep,
} from "@/features/Admin/testCreationSlice";
import superAdminPanelReducer from "@/features/SuperAdmin/superAdminPanelSlice";
import superQuestionBankReducer from "@/features/SuperAdmin/superQuestionBankSlice";
import { superAdminApi } from "@/services/api";

vi.mock("@/services/api", () => ({
  adminApi: {
    getSettings: vi.fn(),
  },
  superAdminApi: {
    getColleges: vi.fn(),
    getDepartments: vi.fn(),
    getBatches: vi.fn(),
    getQuestionSubjects: vi.fn(),
  },
}));

const createDeferred = () => {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const createStore = () => {
  const store = configureStore({
    reducer: {
      testCreation: testCreationReducer,
      superAdminPanel: superAdminPanelReducer,
      superQuestionBank: superQuestionBankReducer,
      adminPanel: (
        state = {
          departments: { data: [] },
          batches: { data: [] },
          students: { data: [] },
        }
      ) => state,
      questionBank: (
        state = {
          filters: {},
          subjects: [],
          pagination: { limit: 20 },
          data: [],
        }
      ) => state,
    },
  });

  store.dispatch(setTestCreationContext("super_admin"));
  store.dispatch(openTestEditDialog({
    test: {
      id: "test-1",
      title: "Cloned Test",
      subject: "Algorithms",
      description: "Clone",
      durationMins: 60,
      totalMarks: 10,
      startsAt: "2026-05-10T10:00:00.000Z",
      endsAt: "2026-05-10T11:00:00.000Z",
      attemptsAllowed: 1,
      evaluationRule: "BEST_ATTEMPT",
      assignmentMethod: "batch_wise",
      status: "DRAFT",
      collegeId: "college-1",
      questions: [
        {
          order: 1,
          prompt: "What is 2 + 2?",
          type: "MCQ",
          options: ["4", "5"],
          correctOption: "4",
          marks: 10,
        },
      ],
      batchAssignments: [
        {
          batchId: "batch-1",
          batch: {
            id: "batch-1",
            name: "Batch 1",
            departmentId: "dept-1",
            collegeId: "college-1",
          },
        },
      ],
      restrictions: {
        enabled: true,
        fullscreenRequired: false,
        tabSwitch: "allowed",
        copyPaste: "allowed",
        windowBlur: false,
        screenshotDetection: false,
        rightClickDisabled: false,
        devtoolsDetection: false,
        violationThreshold: 2,
        paragraphWordLimit: 200,
      },
      testType: "STANDARD",
      proctoringPreset: "STANDARD_TEST",
    },
  }));
  store.dispatch(setTestCreationStep(2));

  return store;
};

const renderDialog = (store) => render(
  <MemoryRouter>
    <Provider store={store}>
      <TestCreationDialog context="super_admin" />
    </Provider>
  </MemoryRouter>
);

describe("TestCreationDialog clone scope handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    superAdminApi.getColleges.mockResolvedValue({
      data: [{ id: "college-1", name: "College 1" }],
    });
    superAdminApi.getQuestionSubjects.mockResolvedValue([]);
  });

  it("keeps selected clone scope while super-admin options are still loading", async () => {
    const departmentsDeferred = createDeferred();
    const batchesDeferred = createDeferred();

    superAdminApi.getDepartments.mockReturnValue(departmentsDeferred.promise);
    superAdminApi.getBatches.mockReturnValue(batchesDeferred.promise);

    const store = createStore();
    renderDialog(store);

    await waitFor(() => {
      expect(superAdminApi.getDepartments).toHaveBeenCalledWith("?page=1&limit=100");
      expect(superAdminApi.getBatches).toHaveBeenCalledWith("?page=1&limit=100&collegeId=college-1");
    });

    expect(store.getState().testCreation.form.departmentIds).toEqual(["dept-1"]);
    expect(store.getState().testCreation.form.batchIds).toEqual(["batch-1"]);

    await act(async () => {
      departmentsDeferred.resolve({
        data: [
          {
            id: "dept-1",
            name: "Department 1",
            collegeId: "college-1",
            college: { name: "College 1" },
          },
        ],
        pagination: { pages: 1 },
      });
      batchesDeferred.resolve({
        data: [
          {
            id: "batch-1",
            name: "Batch 1",
            collegeId: "college-1",
            departmentId: "dept-1",
            college: { name: "College 1" },
            department: { name: "Department 1" },
          },
        ],
        pagination: { pages: 1 },
      });
      await Promise.all([departmentsDeferred.promise, batchesDeferred.promise]);
    });

    await waitFor(() => {
      expect(store.getState().testCreation.form.departmentIds).toEqual(["dept-1"]);
      expect(store.getState().testCreation.form.batchIds).toEqual(["batch-1"]);
    });
  });

  it("keeps clone batch selections that arrive on later batch pages", async () => {
    superAdminApi.getDepartments.mockResolvedValue({
      data: [
        {
          id: "dept-1",
          name: "Department 1",
          collegeId: "college-1",
          college: { name: "College 1" },
        },
      ],
      pagination: { pages: 1 },
    });
    superAdminApi.getBatches.mockImplementation((query) => {
      if (query.includes("page=2")) {
        return Promise.resolve({
          data: [
            {
              id: "batch-1",
              name: "Batch 1",
              collegeId: "college-1",
              departmentId: "dept-1",
              college: { name: "College 1" },
              department: { name: "Department 1" },
            },
          ],
          pagination: { pages: 2 },
        });
      }

      return Promise.resolve({
        data: [
          {
            id: "batch-2",
            name: "Batch 2",
            collegeId: "college-1",
            departmentId: "dept-1",
            college: { name: "College 1" },
            department: { name: "Department 1" },
          },
        ],
        pagination: { pages: 2 },
      });
    });

    const store = createStore();
    renderDialog(store);

    await waitFor(() => {
      expect(superAdminApi.getBatches).toHaveBeenCalledWith("?page=2&limit=100&collegeId=college-1");
    });

    await waitFor(() => {
      expect(store.getState().testCreation.form.batchIds).toEqual(["batch-1"]);
    });
  });
});
