import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { setAccessToken } from "@/services/httpClient";
import { studentApi } from "@/services/studentApi";

const ACCESS_TOKEN_KEY = "student_access_token";
const REFRESH_TOKEN_KEY = "student_refresh_token";
const SESSION_KEY = "student_session_id";
const LEGACY_SESSION_KEY = "session_id";
const USER_KEY = "student_user";

const safeReadStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeWriteStorage = (key, value) => {
  try {
    if (value === null || value === undefined || value === "") {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
};

const safeReadSessionStorage = (key) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeWriteSessionStorage = (key, value) => {
  try {
    if (value === null || value === undefined || value === "") {
      sessionStorage.removeItem(key);
      return;
    }

    sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
};

const readPersistedUser = () => {
  const raw = safeReadStorage(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const persistStudentAuth = ({ accessToken = null, sessionId = null, user = null }) => {
  safeWriteStorage(ACCESS_TOKEN_KEY, null);
  safeWriteSessionStorage(ACCESS_TOKEN_KEY, accessToken || null);
  safeWriteStorage(REFRESH_TOKEN_KEY, null);
  safeWriteSessionStorage(REFRESH_TOKEN_KEY, null);
  safeWriteStorage(SESSION_KEY, sessionId || null);
  safeWriteStorage(LEGACY_SESSION_KEY, sessionId || null);
  safeWriteStorage(USER_KEY, user ? JSON.stringify(user) : null);
};

const clearPersistedStudentAuth = () => {
  safeWriteStorage(ACCESS_TOKEN_KEY, null);
  safeWriteSessionStorage(ACCESS_TOKEN_KEY, null);
  safeWriteStorage(REFRESH_TOKEN_KEY, null);
  safeWriteSessionStorage(REFRESH_TOKEN_KEY, null);
  safeWriteStorage(SESSION_KEY, null);
  safeWriteStorage(LEGACY_SESSION_KEY, null);
  safeWriteStorage(USER_KEY, null);
};

const isDefinitiveRefreshFailure = (error) => {
  const status = error?.status;
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  return status === 400 || status === 401 || status === 403 || /refresh token required|invalid refresh token/i.test(message) || code === "INVALID_REFRESH_TOKEN";
};

const persistedSessionId = safeReadStorage(SESSION_KEY) || safeReadStorage(LEGACY_SESSION_KEY);
const persistedAccessToken = safeReadSessionStorage(ACCESS_TOKEN_KEY) || null;
safeWriteStorage(ACCESS_TOKEN_KEY, null);
safeWriteStorage(REFRESH_TOKEN_KEY, null);
safeWriteSessionStorage(REFRESH_TOKEN_KEY, null);
setAccessToken(persistedAccessToken);

const initialState = {
  accessToken: persistedAccessToken,
  user: readPersistedUser(),
  loading: false,
  initialized: false,
  error: null,
  accountInactive: false,
  sessionId: persistedSessionId,
  sessionConflict: false,
};

export const loginStudent = createAsyncThunk("auth/login", async (payload, { rejectWithValue }) => {
  try {
    const data = await studentApi.login(payload);
    setAccessToken(data.accessToken || null);
    persistStudentAuth({
      accessToken: data.accessToken || null,
      sessionId: data.sessionId || null,
      user: data.user || null,
    });
    return data;
  } catch (error) {
    const code = String(error?.code || "");

    if (error?.code === "ACCOUNT_INACTIVE" || error?.status === 403) {
      return rejectWithValue({
        accountInactive: true,
        message: error?.message || "Account is inactive",
      });
    }

    if (code === "EMAIL_WRONG") {
      return rejectWithValue({
        accountInactive: false,
        message: "Email is wrong",
      });
    }

    if (code === "IDENTIFIER_WRONG") {
      return rejectWithValue({
        accountInactive: false,
        message: "Student ID is wrong",
      });
    }

    if (code === "PASSWORD_WRONG") {
      return rejectWithValue({
        accountInactive: false,
        message: "Password is wrong",
      });
    }

    return rejectWithValue({
      accountInactive: false,
      message: error?.message || "Login failed",
    });
  }
});

export const refreshSession = createAsyncThunk("auth/refresh", async (_, { rejectWithValue }) => {
  try {
    const data = await studentApi.refreshSession({});
    setAccessToken(data.accessToken || null);
    persistStudentAuth({
      accessToken: data.accessToken || null,
      sessionId: data.sessionId || null,
      user: data.user || null,
    });
    return data;
  } catch (error) {
    const forceLogout = isDefinitiveRefreshFailure(error);

    if (forceLogout) {
      setAccessToken(null);
      clearPersistedStudentAuth();
    }

    const isMissingRefreshToken = error?.status === 400 && /refresh token required/i.test(String(error?.message || ""));

    if (error?.code === "ACCOUNT_INACTIVE" || error?.status === 403) {
      return rejectWithValue({
        accountInactive: true,
        message: error?.message || "Account is inactive",
      });
    }

    return rejectWithValue({
      accountInactive: false,
      transient: !forceLogout,
      message: isMissingRefreshToken ? null : error?.message || "Session refresh failed",
    });
  }
});

export const fetchCurrentUser = createAsyncThunk("auth/me", async (_, { rejectWithValue }) => {
  try {
    return await studentApi.me();
  } catch (error) {
    return rejectWithValue({
      message: error?.message || "Unable to load profile",
    });
  }
});

export const logoutStudent = createAsyncThunk("auth/logout", async () => {
  try {
    await studentApi.logout({});
  } finally {
    setAccessToken(null);
    clearPersistedStudentAuth();
  }

  return null;
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setSessionConflict: (state, action) => {
      state.sessionConflict = Boolean(action.payload);
    },
    accountInactiveDetected: (state) => {
      state.accountInactive = true;
      state.initialized = true;
      state.loading = false;
    },
    applyRefreshPayload: (state, action) => {
      const payload = action.payload || {};
      state.accessToken = payload.accessToken || null;
      state.user = payload.user || state.user;
      state.sessionId = payload.sessionId || state.sessionId;
      state.initialized = true;
      state.loading = false;
      state.accountInactive = false;
      state.error = null;
    },
    sessionExpired: (state) => {
      state.accessToken = null;
      state.user = null;
      state.loading = false;
      state.initialized = true;
      state.sessionId = null;
      state.sessionConflict = false;
      state.error = null;
    },
    markInitialized: (state) => {
      state.initialized = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginStudent.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loginStudent.fulfilled, (state, action) => {
        state.loading = false;
        state.accessToken = action.payload?.accessToken || null;
        state.user = action.payload?.user || null;
        state.sessionId = action.payload?.sessionId || null;
        state.accountInactive = false;
        state.error = null;
      })
      .addCase(loginStudent.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || action.error.message;
        state.accountInactive = Boolean(action.payload?.accountInactive);
      })
      .addCase(refreshSession.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(refreshSession.fulfilled, (state, action) => {
        state.loading = false;
        state.accessToken = action.payload?.accessToken || null;
        state.user = action.payload?.user || null;
        state.sessionId = action.payload?.sessionId || null;
        state.initialized = true;
        state.accountInactive = false;
        state.error = null;
      })
      .addCase(refreshSession.rejected, (state, action) => {
        state.loading = false;
        state.initialized = true;
        if (!action.payload?.transient) {
          state.accessToken = null;
          state.user = null;
          state.sessionId = null;
        }
        state.accountInactive = Boolean(action.payload?.accountInactive);
        state.error = action.payload?.accountInactive ? action.payload?.message || null : null;
      })
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.user = action.payload || null;
      })
      .addCase(fetchCurrentUser.rejected, (state, action) => {
        state.error = action.payload?.message || action.error.message || state.error;
      })
      .addCase(logoutStudent.fulfilled, (state) => {
        state.accessToken = null;
        state.user = null;
        state.sessionId = null;
        state.sessionConflict = false;
        state.error = null;
      });
  },
});

export const { setSessionConflict, accountInactiveDetected, applyRefreshPayload, sessionExpired, markInitialized } = authSlice.actions;

export default authSlice.reducer;
