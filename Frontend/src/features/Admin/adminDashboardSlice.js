import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminApi } from "@/services/api";

const initialState = {
  data: null,
  loading: false,
  error: null,
};

export const fetchAdminDashboard = createAsyncThunk("adminDashboard/fetch", async () => {
  return adminApi.getDashboard();
});

const adminDashboardSlice = createSlice({
  name: "adminDashboard",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdminDashboard.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAdminDashboard.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
      })
      .addCase(fetchAdminDashboard.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      });
  },
});

export default adminDashboardSlice.reducer;
