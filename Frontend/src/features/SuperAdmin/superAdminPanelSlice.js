import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { superAdminApi } from "@/services/api";

const initialState = {
  colleges: [],
  admins: [],
  students: [],
  studentPagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  },
  tests: [],
  batches: [],
  events: [],
  reports: [],
  analytics: null,
  settings: null,
  loading: false,
  error: null,
};

export const fetchSuperColleges = createAsyncThunk("superAdminPanel/colleges", async (params = "?page=1&limit=100") => superAdminApi.getColleges(params));
export const createSuperCollege = createAsyncThunk("superAdminPanel/createCollege", async (payload) => superAdminApi.createCollege(payload));
export const fetchSuperAdmins = createAsyncThunk("superAdminPanel/admins", async (params = "") => superAdminApi.getAdmins(params));
export const createSuperAdminUser = createAsyncThunk("superAdminPanel/createAdmin", async (payload) => superAdminApi.createAdmin(payload));
export const fetchSuperStudents = createAsyncThunk("superAdminPanel/students", async (params = "") => superAdminApi.getStudents(params));
export const fetchSuperTests = createAsyncThunk("superAdminPanel/tests", async () => superAdminApi.getTests());
export const fetchSuperBatches = createAsyncThunk("superAdminPanel/batches", async () => superAdminApi.getBatches());
export const fetchSuperEvents = createAsyncThunk("superAdminPanel/events", async () => superAdminApi.getEvents());
export const createSuperEvent = createAsyncThunk("superAdminPanel/createEvent", async (payload) => superAdminApi.createEvent(payload));
export const fetchSuperReports = createAsyncThunk("superAdminPanel/reports", async (params = "") => superAdminApi.getReports(params));
export const generateSuperReport = createAsyncThunk("superAdminPanel/generateReport", async (payload) => superAdminApi.generateReport(payload));
export const fetchSuperAnalytics = createAsyncThunk("superAdminPanel/analytics", async () => superAdminApi.getAnalytics());
export const fetchSuperSettings = createAsyncThunk("superAdminPanel/settings", async () => superAdminApi.getSettings());
export const updateSuperSettings = createAsyncThunk("superAdminPanel/updateSettings", async (payload) => superAdminApi.updateSettings(payload));

const superAdminPanelSlice = createSlice({
  name: "superAdminPanel",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSuperColleges.fulfilled, (state, action) => {
        state.colleges = action.payload.data || [];
      })
      .addCase(createSuperCollege.fulfilled, (state, action) => {
        state.colleges = [action.payload, ...state.colleges];
      })
      .addCase(fetchSuperAdmins.fulfilled, (state, action) => {
        state.admins = action.payload.data || [];
      })
      .addCase(createSuperAdminUser.fulfilled, (state, action) => {
        state.admins = [action.payload, ...state.admins];
      })
      .addCase(fetchSuperStudents.fulfilled, (state, action) => {
        state.students = action.payload.data || [];
        state.studentPagination = action.payload.pagination || action.payload.meta?.pagination || state.studentPagination;
      })
      .addCase(fetchSuperTests.fulfilled, (state, action) => {
        state.tests = action.payload.data || [];
      })
      .addCase(fetchSuperBatches.fulfilled, (state, action) => {
        state.batches = action.payload.data || [];
      })
      .addCase(fetchSuperEvents.fulfilled, (state, action) => {
        state.events = action.payload.data || [];
      })
      .addCase(createSuperEvent.fulfilled, (state, action) => {
        state.events = [action.payload, ...state.events];
      })
      .addCase(fetchSuperReports.fulfilled, (state, action) => {
        state.reports = action.payload || [];
      })
      .addCase(generateSuperReport.fulfilled, (state, action) => {
        state.reports = [action.payload, ...state.reports];
      })
      .addCase(fetchSuperAnalytics.fulfilled, (state, action) => {
        state.analytics = action.payload;
      })
      .addCase(fetchSuperSettings.fulfilled, (state, action) => {
        state.settings = action.payload;
      })
      .addCase(updateSuperSettings.fulfilled, (state, action) => {
        state.settings = action.payload;
      });
  },
});

export default superAdminPanelSlice.reducer;
