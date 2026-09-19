import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminApi } from "@/services/api";
import { logoutAdmin } from "@/features/Admin/adminAuthSlice";

const initialState = {
  tests: { data: [], loading: false, error: null, pagination: { page: 1, limit: 20, total: 0, totalPages: 1 }, statusCounts: { ALL: 0, DRAFT: 0, SCHEDULED: 0, LIVE: 0, COMPLETED: 0, ARCHIVED: 0 } },
  questionBank: { data: [], loading: false, error: null },
  departments: { data: [], loading: false, error: null },
  batches: { data: [], loading: false, error: null },
  students: { data: [], loading: false, error: null },
  events: { data: [], loading: false, error: null },
  reportJobs: { data: [], loading: false, error: null },
};

export const fetchAdminTests = createAsyncThunk("adminPanel/fetchTests", async (params = "") => {
  return adminApi.getTests(params);
});

export const createAdminTest = createAsyncThunk("adminPanel/createTest", async (payload) => {
  return adminApi.createTest(payload);
});

export const updateAdminTest = createAsyncThunk("adminPanel/updateTest", async ({ testId, payload }) => {
  return adminApi.updateTest(testId, payload);
});

export const publishAdminTest = createAsyncThunk("adminPanel/publishTest", async (testId) => {
  return adminApi.publishTest(testId);
});

export const archiveAdminTest = createAsyncThunk("adminPanel/archiveTest", async (testId) => {
  return adminApi.archiveTest(testId);
});

export const transitionAdminTestStatus = createAsyncThunk("adminPanel/transitionTestStatus", async ({ testId, action }) => {
  return adminApi.transitionTestStatus(testId, action);
});

export const deleteAdminTest = createAsyncThunk("adminPanel/deleteTest", async (testId) => {
  await adminApi.deleteTest(testId);
  return { id: testId };
});

export const fetchQuestionBank = createAsyncThunk("adminPanel/fetchQuestionBank", async (params = "") => {
  return adminApi.getQuestionBank(params);
});

export const addQuestionBankItem = createAsyncThunk("adminPanel/addQuestionBankItem", async (payload) => {
  return adminApi.addQuestionBankItem(payload);
});

export const fetchBatches = createAsyncThunk("adminPanel/fetchBatches", async () => {
  return adminApi.getBatches();
});

export const fetchDepartments = createAsyncThunk("adminPanel/fetchDepartments", async () => {
  return adminApi.getDepartments();
});

export const createBatch = createAsyncThunk("adminPanel/createBatch", async (payload) => {
  return adminApi.createBatch(payload);
});

export const fetchStudents = createAsyncThunk("adminPanel/fetchStudents", async (params = "") => {
  return adminApi.getStudents(params);
});

export const fetchEvents = createAsyncThunk("adminPanel/fetchEvents", async () => {
  return adminApi.getEvents();
});

export const createEvent = createAsyncThunk("adminPanel/createEvent", async (payload) => {
  return adminApi.createEvent(payload);
});

export const fetchReportJobs = createAsyncThunk("adminPanel/fetchReportJobs", async () => {
  return adminApi.getReportJobs();
});

export const generateReport = createAsyncThunk("adminPanel/generateReport", async (payload) => {
  return adminApi.generateReport(payload);
});

const adminPanelSlice = createSlice({
  name: "adminPanel",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdminTests.pending, (state) => {
        state.tests.loading = true;
      })
      .addCase(fetchAdminTests.fulfilled, (state, action) => {
        state.tests.loading = false;
        state.tests.data = action.payload.data || [];
        state.tests.pagination = action.payload.pagination || state.tests.pagination;
        state.tests.statusCounts = action.payload.statusCounts || state.tests.statusCounts;
      })
      .addCase(fetchAdminTests.rejected, (state, action) => {
        state.tests.loading = false;
        state.tests.error = action.error.message;
      })
      .addCase(createAdminTest.fulfilled, (state, action) => {
        state.tests.data = [action.payload, ...state.tests.data];
      })
      .addCase(updateAdminTest.fulfilled, (state, action) => {
        state.tests.data = state.tests.data.map((test) => (test.id === action.payload.id ? action.payload : test));
      })
      .addCase(publishAdminTest.fulfilled, (state, action) => {
        state.tests.data = state.tests.data.map((test) => (test.id === action.payload.id ? action.payload : test));
      })
      .addCase(archiveAdminTest.fulfilled, (state, action) => {
        state.tests.data = state.tests.data.map((test) => (test.id === action.payload.id ? action.payload : test));
      })
      .addCase(transitionAdminTestStatus.fulfilled, (state, action) => {
        state.tests.data = state.tests.data.map((test) => (test.id === action.payload.id ? action.payload : test));
      })
      .addCase(deleteAdminTest.fulfilled, (state, action) => {
        state.tests.data = state.tests.data.filter((test) => test.id !== action.payload.id);
      })
      .addCase(fetchQuestionBank.pending, (state) => {
        state.questionBank.loading = true;
      })
      .addCase(fetchQuestionBank.fulfilled, (state, action) => {
        state.questionBank.loading = false;
        state.questionBank.data = action.payload.data || [];
      })
      .addCase(fetchQuestionBank.rejected, (state, action) => {
        state.questionBank.loading = false;
        state.questionBank.error = action.error.message;
      })
      .addCase(addQuestionBankItem.fulfilled, (state, action) => {
        state.questionBank.data = [action.payload, ...state.questionBank.data];
      })
      .addCase(addQuestionBankItem.rejected, (state, action) => {
        state.questionBank.loading = false;
        state.questionBank.error = action.error.message;
      })
      .addCase(fetchBatches.pending, (state) => {
        state.batches.loading = true;
      })
      .addCase(fetchBatches.fulfilled, (state, action) => {
        state.batches.loading = false;
        state.batches.data = action.payload.data || [];
      })
      .addCase(fetchBatches.rejected, (state, action) => {
        state.batches.loading = false;
        state.batches.error = action.error.message;
      })
      .addCase(fetchDepartments.pending, (state) => {
        state.departments.loading = true;
      })
      .addCase(fetchDepartments.fulfilled, (state, action) => {
        state.departments.loading = false;
        state.departments.data = Array.isArray(action.payload)
          ? action.payload
          : Array.isArray(action.payload?.data)
            ? action.payload.data
            : [];
      })
      .addCase(fetchDepartments.rejected, (state, action) => {
        state.departments.loading = false;
        state.departments.error = action.error.message;
      })
      .addCase(fetchStudents.pending, (state) => {
        state.students.loading = true;
      })
      .addCase(fetchStudents.fulfilled, (state, action) => {
        state.students.loading = false;
        state.students.data = action.payload.data || [];
      })
      .addCase(fetchStudents.rejected, (state, action) => {
        state.students.loading = false;
        state.students.error = action.error.message;
      })
      .addCase(fetchEvents.pending, (state) => {
        state.events.loading = true;
      })
      .addCase(fetchEvents.fulfilled, (state, action) => {
        state.events.loading = false;
        state.events.data = action.payload || [];
      })
      .addCase(createEvent.fulfilled, (state, action) => {
        state.events.data = [action.payload, ...state.events.data];
      })
      .addCase(fetchReportJobs.pending, (state) => {
        state.reportJobs.loading = true;
      })
      .addCase(fetchReportJobs.fulfilled, (state, action) => {
        state.reportJobs.loading = false;
        state.reportJobs.data = action.payload || [];
      })
      .addCase(fetchReportJobs.rejected, (state, action) => {
        state.reportJobs.loading = false;
        state.reportJobs.error = action.error.message;
      })
      .addCase(generateReport.pending, (state) => {
        state.reportJobs.error = null;
      })
      .addCase(generateReport.rejected, (state, action) => {
        state.reportJobs.error = action.error.message;
      })
      .addCase(logoutAdmin.fulfilled, () => {
        return initialState;
      });
  },
});

export default adminPanelSlice.reducer;
