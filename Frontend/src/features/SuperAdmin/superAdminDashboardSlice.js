import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { superAdminApi } from "@/services/api";

const initialState = {
  data: null,
  loading: false,
  error: null,
  health: null,
  healthLoading: false,
  healthError: null,
};

export const fetchSuperAdminDashboard = createAsyncThunk("superAdminDashboard/fetch", async () => {
  return superAdminApi.getDashboard();
});

export const fetchSuperAdminHealth = createAsyncThunk("superAdminDashboard/health", async () => {
  return superAdminApi.getSystemHealth();
});

const superAdminDashboardSlice = createSlice({
  name: "superAdminDashboard",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSuperAdminDashboard.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSuperAdminDashboard.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
      })
      .addCase(fetchSuperAdminDashboard.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(fetchSuperAdminHealth.pending, (state) => {
        state.healthLoading = true;
        state.healthError = null;
      })
      .addCase(fetchSuperAdminHealth.fulfilled, (state, action) => {
        state.healthLoading = false;
        state.health = action.payload;
      })
      .addCase(fetchSuperAdminHealth.rejected, (state, action) => {
        state.healthLoading = false;
        state.healthError = action.error.message;
      });
  },
});

export default superAdminDashboardSlice.reducer;
