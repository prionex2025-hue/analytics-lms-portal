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
    };
  } catch {
    return { sidebarCollapsed: false };
  }
};

const persistUiState = (state) => {
  try {
    localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        sidebarCollapsed: state.sidebarCollapsed,
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
  },
});

export const { setSidebarCollapsed, toggleSidebar, setMobileSidebarOpen } = uiSlice.actions;

export default uiSlice.reducer;
