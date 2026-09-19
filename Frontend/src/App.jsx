import { Suspense, lazy } from "react";
import AppErrorBoundary from "@/components/common/AppErrorBoundary";

const AppRouter = lazy(() => import("@/app/Students/router"));
const AdminRouter = lazy(() => import("@/app/Admin/router"));
const CollegeAdminRouter = lazy(() => import("@/app/CollegeAdmin/router"));
const SuperAdminRouter = lazy(() => import("@/app/SuperAdmin/router"));

const matchesRouteSegment = (pathname, segment) =>
  pathname === segment || pathname.startsWith(`${segment}/`);

function App() {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const isAdminPath = matchesRouteSegment(pathname, "/admin");
  const isCollegeAdminPath = matchesRouteSegment(pathname, "/college-admin");
  const isSuperAdminPath = matchesRouteSegment(pathname, "/super-admin") || matchesRouteSegment(pathname, "/superadmin");

  return (
    <AppErrorBoundary>
      <Suspense fallback={<div className="grid min-h-screen place-items-center text-text-secondary">Loading...</div>}>
        {isSuperAdminPath
          ? <SuperAdminRouter />
          : isCollegeAdminPath
            ? <CollegeAdminRouter />
            : isAdminPath
              ? <AdminRouter />
              : <AppRouter />}
      </Suspense>
    </AppErrorBoundary>
  );
}

export default App;
