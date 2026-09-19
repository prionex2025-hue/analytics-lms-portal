import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminApi, getActiveAdminTokenStorage } from "@/services/api";
import { normalizeAdminPrincipal } from "@/features/Admin/adminRole";

const initialState = {
  admin: null,
  permissions: [],
  loading: false,
  initialized: false,
  error: null,
};

export const loginAdmin = createAsyncThunk("adminAuth/login", async (payload) => {
  const data = await adminApi.login(payload);
  getActiveAdminTokenStorage().setTokens({
    accessToken: data.accessToken,
  });
  return normalizeAdminPrincipal(data.admin);
});

export const fetchCurrentAdmin = createAsyncThunk("adminAuth/me", async () => {
  const admin = await adminApi.me();
  return normalizeAdminPrincipal(admin);
});

export const logoutAdmin = createAsyncThunk("adminAuth/logout", async () => {
  try {
    await adminApi.logout();
  } finally {
    getActiveAdminTokenStorage().clear();
  }
  return null;
});

const adminAuthSlice = createSlice({
  name: "adminAuth",
  initialState,
  reducers: {
    markAdminInitialized: (state) => {
      state.initialized = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginAdmin.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loginAdmin.fulfilled, (state, action) => {
        state.loading = false;
        state.admin = action.payload;
        state.permissions = action.payload?.permissions || [];
      })
      .addCase(loginAdmin.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(fetchCurrentAdmin.fulfilled, (state, action) => {
        state.admin = action.payload;
        state.permissions = action.payload?.permissions || [];
        state.initialized = true;
      })
      .addCase(fetchCurrentAdmin.rejected, (state) => {
        state.admin = null;
        state.permissions = [];
        state.initialized = true;
      })
      .addCase(logoutAdmin.fulfilled, (state) => {
        state.admin = null;
        state.permissions = [];
      })
      .addCase(logoutAdmin.rejected, (state) => {
        state.admin = null;
        state.permissions = [];
      });
  },
});

export const { markAdminInitialized } = adminAuthSlice.actions;

export default adminAuthSlice.reducer;
