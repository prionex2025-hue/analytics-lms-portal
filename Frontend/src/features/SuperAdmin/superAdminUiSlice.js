import { createSlice } from "@reduxjs/toolkit";

const STORAGE_KEY = "super_admin_sidebar_collapsed";

const readInitialCollapsed = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const persistCollapsed = (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // noop
  }
};

const initialState = {
  sidebarCollapsed: readInitialCollapsed(),
};

const superAdminUiSlice = createSlice({
  name: "superAdminUi",
  initialState,
  reducers: {
    setSidebarCollapsed: (state, action) => {
      state.sidebarCollapsed = Boolean(action.payload);
      persistCollapsed(state.sidebarCollapsed);
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      persistCollapsed(state.sidebarCollapsed);
    },
  },
});

export const { setSidebarCollapsed, toggleSidebar } = superAdminUiSlice.actions;

export default superAdminUiSlice.reducer;