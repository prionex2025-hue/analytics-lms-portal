import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { superAdminApi, superAdminTokenStorage } from "@/services/api";

const initialState = {
  superAdmin: null,
  loading: false,
  initialized: false,
  error: null,
};

export const loginSuperAdmin = createAsyncThunk("superAdminAuth/login", async (payload) => {
  const data = await superAdminApi.login(payload);
  superAdminTokenStorage.setTokens({
    accessToken: data.accessToken,
  });
  return data.superAdmin;
});

export const fetchCurrentSuperAdmin = createAsyncThunk("superAdminAuth/me", async () => {
  return superAdminApi.me();
});

export const logoutSuperAdmin = createAsyncThunk("superAdminAuth/logout", async () => {
  await superAdminApi.logout();
  superAdminTokenStorage.clear();
  return null;
});

const superAdminAuthSlice = createSlice({
  name: "superAdminAuth",
  initialState,
  reducers: {
    markSuperAdminInitialized: (state) => {
      state.initialized = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginSuperAdmin.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loginSuperAdmin.fulfilled, (state, action) => {
        state.loading = false;
        state.superAdmin = action.payload;
      })
      .addCase(loginSuperAdmin.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      .addCase(fetchCurrentSuperAdmin.fulfilled, (state, action) => {
        state.superAdmin = action.payload;
        state.initialized = true;
      })
      .addCase(fetchCurrentSuperAdmin.rejected, (state) => {
        state.superAdmin = null;
        state.initialized = true;
      })
      .addCase(logoutSuperAdmin.fulfilled, (state) => {
        state.superAdmin = null;
      });
  },
});

export const { markSuperAdminInitialized } = superAdminAuthSlice.actions;

export default superAdminAuthSlice.reducer;
