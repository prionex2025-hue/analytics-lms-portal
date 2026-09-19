import { useSelector } from "react-redux";
import { loginAdmin, logoutAdmin, fetchCurrentAdmin } from "@/features/Admin/adminAuthSlice";
import { loginCollegeAdmin, logoutCollegeAdmin, fetchCurrentCollegeAdmin } from "@/features/CollegeAdmin/collegeAdminAuthSlice";

// Admin and College-Admin share the same pages/components but keep fully
// separate Redux memory (state.adminAuth vs state.collegeAdminAuth). These
// helpers resolve the correct portal by the active route so a shared component
// reads/dispatches against the portal it is currently rendered under. Each tab
// renders exactly one portal's router, so the route is stable within a tab.
//
// The route check is inlined (not imported from services/api) so this hook stays
// self-contained and does not depend on a module that tests commonly mock.
const isCollegeAdminRoute = () =>
  typeof window !== "undefined" &&
  (String(window.location?.pathname || "") === "/college-admin" ||
    String(window.location?.pathname || "").startsWith("/college-admin/"));

export const useAdminAuthState = () => {
  const isCollege = isCollegeAdminRoute();
  const adminState = useSelector((state) => state.adminAuth);
  const collegeState = useSelector((state) => state.collegeAdminAuth);
  return isCollege ? collegeState : adminState;
};

export const getPortalAuthThunks = () =>
  isCollegeAdminRoute()
    ? { login: loginCollegeAdmin, logout: logoutCollegeAdmin, fetchCurrent: fetchCurrentCollegeAdmin }
    : { login: loginAdmin, logout: logoutAdmin, fetchCurrent: fetchCurrentAdmin };
