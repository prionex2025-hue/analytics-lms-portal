import { createSlice } from "@reduxjs/toolkit";

const UI_STORAGE_KEY = "lms_student_ui";

const getStoredUiState = () => {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) {
      return { sidebarCollapsed: false };
    }

    const parsed = JSON.parse(raw);
    return {
      sidebarCollapsed: Boolean(parsed?.sidebarCollapsed),
      theme: parsed?.theme || "system",
    };
  } catch {
    return { sidebarCollapsed: false, theme: "system" };
  }
};

const persistUiState = (state) => {
  try {
    localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      })
    );
  } catch {
    // Ignore storage failures.
  }
};

const initialState = {
  ...getStoredUiState(),
  mobileSidebarOpen: false,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setSidebarCollapsed: (state, action) => {
      state.sidebarCollapsed = Boolean(action.payload);
      persistUiState(state);
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      persistUiState(state);
    },
    setMobileSidebarOpen: (state, action) => {
      state.mobileSidebarOpen = Boolean(action.payload);
    },
    setTheme: (state, action) => {
      state.theme = action.payload || "system";
      persistUiState(state);
    },
  },
});

export const { setSidebarCollapsed, toggleSidebar, setMobileSidebarOpen, setTheme } = uiSlice.actions;

export default uiSlice.reducer;
