import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { api } from "@/services/api";

const initialState = {
  dashboard: null,
  reports: null,
  leaderboard: [],
  events: [],
  loading: false,
  dashboardLoading: false,
  reportsLoading: false,
  leaderboardLoading: false,
  eventsLoading: false,
  error: null,
};

export const fetchDashboard = createAsyncThunk("portal/dashboard", api.getDashboard);
export const fetchReports = createAsyncThunk("portal/reports", api.getReport);
export const fetchLeaderboard = createAsyncThunk("portal/leaderboard", async (params = "") => {
  const data = await api.getLeaderboard(params);
  return data.data || [];
});
export const fetchEvents = createAsyncThunk("portal/events", async (params = "") => {
  const data = await api.getEvents(params);
  return data.data || [];
});

const portalSlice = createSlice({
  name: "portal",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchDashboard.pending, (state) => {
        state.loading = true;
        state.dashboardLoading = true;
      })
      .addCase(fetchDashboard.fulfilled, (state, action) => {
        state.loading = false;
        state.dashboardLoading = false;
        state.dashboard = action.payload;
      })
      .addCase(fetchDashboard.rejected, (state, action) => {
        state.loading = false;
        state.dashboardLoading = false;
        state.error = action.error.message;
      })
      .addCase(fetchReports.pending, (state) => {
        state.reportsLoading = true;
      })
      .addCase(fetchReports.fulfilled, (state, action) => {
        state.reportsLoading = false;
        state.reports = action.payload;
      })
      .addCase(fetchReports.rejected, (state) => {
        state.reportsLoading = false;
      })
      .addCase(fetchLeaderboard.pending, (state) => {
        state.leaderboardLoading = true;
      })
      .addCase(fetchLeaderboard.fulfilled, (state, action) => {
        state.leaderboardLoading = false;
        state.leaderboard = action.payload;
      })
      .addCase(fetchLeaderboard.rejected, (state) => {
        state.leaderboardLoading = false;
      })
      .addCase(fetchEvents.pending, (state) => {
        state.eventsLoading = true;
      })
      .addCase(fetchEvents.fulfilled, (state, action) => {
        state.eventsLoading = false;
        state.events = action.payload;
      })
      .addCase(fetchEvents.rejected, (state) => {
        state.eventsLoading = false;
      });
  },
});

export default portalSlice.reducer;
