import { combineReducers, configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/Students/authSlice";
import adminAuthReducer from "@/features/Admin/adminAuthSlice";
import collegeAdminAuthReducer from "@/features/CollegeAdmin/collegeAdminAuthSlice";
import superAdminAuthReducer from "@/features/SuperAdmin/superAdminAuthSlice";

const staticReducers = {
  auth: authReducer,
  adminAuth: adminAuthReducer,
  collegeAdminAuth: collegeAdminAuthReducer,
  superAdminAuth: superAdminAuthReducer,
};

const asyncReducers = {};

const createRootReducer = () => combineReducers({
  ...staticReducers,
  ...asyncReducers,
});

export const store = configureStore({
  reducer: createRootReducer(),
});

export const injectReducer = (key, reducer) => {
  if (!key || asyncReducers[key]) {
    return;
  }

  asyncReducers[key] = reducer;
  store.replaceReducer(createRootReducer());
};
