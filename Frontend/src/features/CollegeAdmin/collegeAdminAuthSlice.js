import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminApi, collegeAdminTokenStorage } from "@/services/api";
import { normalizeAdminPrincipal } from "@/features/Admin/adminRole";

// College-Admin auth is fully separate from Admin auth: its own Redux slice
// (state.collegeAdminAuth) and its own in-memory token slot
// (collegeAdminTokenStorage). The shared adminApi.* calls resolve to the
// /college-admin/* endpoints at runtime because these thunks only run on
// college-admin routes.
const initialState = {
  admin: null,
  permissions: [],
  loading: false,
  initialized: false,
  error: null,
};

export const loginCollegeAdmin = createAsyncThunk("collegeAdminAuth/login", async (payload) => {
  const data = await adminApi.login(payload);
  collegeAdminTokenStorage.setTokens({ accessToken: data.accessToken });
  return normalizeAdminPrincipal(data.admin);
});

export const fetchCurrentCollegeAdmin = createAsyncThunk("collegeAdminAuth/me", async () => {
  const admin = await adminApi.me();
  return normalizeAdminPrincipal(admin);
});

export const logoutCollegeAdmin = createAsyncThunk("collegeAdminAuth/logout", async () => {
  try {
    await adminApi.logout();
  } finally {
    collegeAdminTokenStorage.clear();
  }
  return null;
});

const collegeAdminAuthSlice = createSlice({
  name: "collegeAdminAuth",
  initialState,
  reducers: {
    markCollegeAdminInitialized: (state) => {
      state.initialized = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginCollegeAdmin.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loginCollegeAdmin.fulfilled, (state, action) => {
        state.loading = false;
        state.admin = action.payload;
        state.permissions = action.payload?.permissions || [];
      })
      .addCase(loginCollegeAdmin.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(fetchCurrentCollegeAdmin.fulfilled, (state, action) => {
        state.admin = action.payload;
        state.permissions = action.payload?.permissions || [];
        state.initialized = true;
      })
      .addCase(fetchCurrentCollegeAdmin.rejected, (state) => {
        state.admin = null;
        state.permissions = [];
        state.initialized = true;
      })
      .addCase(logoutCollegeAdmin.fulfilled, (state) => {
        state.admin = null;
        state.permissions = [];
      })
      .addCase(logoutCollegeAdmin.rejected, (state) => {
        state.admin = null;
        state.permissions = [];
      });
  },
});

export const { markCollegeAdminInitialized } = collegeAdminAuthSlice.actions;

export default collegeAdminAuthSlice.reducer;
