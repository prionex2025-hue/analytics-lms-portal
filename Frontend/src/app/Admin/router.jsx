import { Suspense, createElement, lazy, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { injectReducer } from "@/app/store";
import { fetchCurrentAdmin, logoutAdmin } from "@/features/Admin/adminAuthSlice";
import AdminLoginPage from "@/pages/Admin/LoginPage";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { isCollegeAdminRole } from "@/features/Admin/adminRole";
import HardRedirect from "@/components/common/HardRedirect";
import IdleSessionTimeout from "@/components/common/IdleSessionTimeout";
import RouteErrorElement from "@/components/common/RouteErrorElement";
import { useNoIndexRoute } from "@/hooks/useNoIndexRoute";

const injectAdminReducers = async () => {
  const [adminDashboard, adminPanel, testCreation, adminUi, questionBank, reports, learningResources] = await Promise.all([
    import("@/features/Admin/adminDashboardSlice"),
    import("@/features/Admin/adminPanelSlice"),
    import("@/features/Admin/testCreationSlice"),
    import("@/features/Admin/adminUiSlice"),
    import("@/features/Admin/questionBankSlice"),
    import("@/features/Admin/reportsSlice"),
    import("@/features/LearningResources/learningResourcesSlice"),
  ]);

  injectReducer("adminDashboard", adminDashboard.default);
  injectReducer("adminPanel", adminPanel.default);
  injectReducer("testCreation", testCreation.default);
  injectReducer("adminUi", adminUi.default);
  injectReducer("questionBank", questionBank.default);
  injectReducer("reports", reports.default);
  injectReducer("learningResources", learningResources.default);
};

const lazyWithAdminReducers = (loader) => lazy(async () => {
  const [module] = await Promise.all([loader(), injectAdminReducers()]);
  return module;
});

const AdminPortalLayout = lazyWithAdminReducers(() => import("@/components/Admin/AdminPortalLayout"));
const AdminDashboardPage = lazyWithAdminReducers(() => import("@/pages/Admin/DashboardPage"));
const ManageTestsPage = lazyWithAdminReducers(() => import("@/pages/Admin/ManageTestsPage"));
const LiveMonitoringPage = lazyWithAdminReducers(() => import("@/pages/Admin/LiveMonitoringPage"));
const QuestionBankPage = lazyWithAdminReducers(() => import("@/pages/Admin/QuestionBankPage"));
const BatchesPage = lazyWithAdminReducers(() => import("@/pages/Admin/BatchesPage"));
const StudentsPage = lazyWithAdminReducers(() => import("@/pages/Admin/StudentsPage"));
const EventsPage = lazyWithAdminReducers(() => import("@/pages/Admin/EventsPage"));
const ReportsPage = lazyWithAdminReducers(() => import("@/pages/Admin/ReportsPage"));
const AdminSettingsPage = lazyWithAdminReducers(() => import("@/pages/Admin/SettingsPage"));
const LearningResourcesPage = lazyWithAdminReducers(() => import("@/pages/Admin/LearningResourcesPage"));
const CollegeAnalyticsPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/CollegeAnalyticsPage"));
const PermissionDenied = lazy(() => import("@/components/Admin/PermissionDenied"));

const AdminPasswordResetPage = lazy(async () => {
  const [{ default: PasswordResetPage }, { adminApi }] = await Promise.all([
    import("@/pages/Auth/PasswordResetPage"),
    import("@/services/api"),
  ]);

  return {
    default: function AdminPasswordResetRoute() {
      return (
        <PasswordResetPage
          portalName="Admin"
          portalLabel="Admin workspace"
          loginPath="/admin/login"
          mainPath="/admin"
          requestReset={adminApi.forgotPassword}
          completeReset={adminApi.resetPassword}
        />
      );
    },
  };
});

function PageRoute({ Page, fallback = <div className="grid min-h-[40vh] place-items-center text-text-secondary">Loading...</div> }) {
  return (
    <Suspense fallback={fallback}>
      {createElement(Page)}
    </Suspense>
  );
}

function PermissionRoute({ permission, permissions, action }) {
  const effectivePermissions = useSelector((state) => state.adminAuth.permissions || []);
  const required = permissions || (permission ? [permission] : []);
  const allowed = required.length === 0 || required.some((item) => effectivePermissions.includes(item));
  return allowed ? <Outlet /> : <PageRoute Page={() => <PermissionDenied action={action} />} />;
}

function AdminAuthBootstrap() {
  const dispatch = useDispatch();
  const initialized = useSelector((state) => state.adminAuth.initialized);
  const admin = useSelector((state) => state.adminAuth.admin);
  useNoIndexRoute();

  useEffect(() => {
    dispatch(fetchCurrentAdmin());
  }, [dispatch]);

  if (!initialized) {
    return <div className="grid min-h-screen place-items-center text-text-secondary">Initializing admin session...</div>;
  }

  return (
    <>
      <Outlet />
      <IdleSessionTimeout enabled={Boolean(admin)} onLogout={() => dispatch(logoutAdmin())} />
    </>
  );
}

function AdminProtectedRoute() {
  const admin = useSelector((state) => state.adminAuth.admin);
  if (!admin) {
    return <Navigate to="/admin/login" replace />;
  }
  if (isCollegeAdminRole(admin.role)) {
    return <HardRedirect to="/college-admin/dashboard" message="Redirecting to College Admin portal..." />;
  }
  return <Outlet />;
}

function AdminPublicOnlyRoute() {
  const admin = useSelector((state) => state.adminAuth.admin);
  if (!admin) {
    return <Outlet />;
  }
  if (isCollegeAdminRole(admin.role)) {
    return <HardRedirect to="/college-admin/dashboard" message="Redirecting to College Admin portal..." />;
  }
  return <Navigate to="/admin/dashboard" replace />;
}

const router = createBrowserRouter([
  {
    element: <AdminAuthBootstrap />,
    errorElement: <RouteErrorElement />,
    children: [
      {
        element: <AdminPublicOnlyRoute />,
        children: [{ path: "/admin/login", element: <AdminLoginPage /> }],
      },
      {
        path: "/admin/forgot-password",
        element: <PageRoute Page={AdminPasswordResetPage} />,
      },
      {
        path: "/admin/reset-password",
        element: <PageRoute Page={AdminPasswordResetPage} />,
      },
      {
        element: <AdminProtectedRoute />,
        children: [
          {
            element: <PageRoute Page={AdminPortalLayout} fallback={<div className="grid min-h-screen place-items-center text-text-secondary">Loading admin workspace...</div>} />,
            children: [
              { path: "/admin", element: <Navigate to="/admin/dashboard" replace /> },
              { path: "/admin/dashboard", element: <PageRoute Page={AdminDashboardPage} /> },
              { path: "/admin/tests", element: <PageRoute Page={ManageTestsPage} /> },
              { path: "/admin/tests/create", element: <PageRoute Page={ManageTestsPage} /> },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.VIEW_TESTS, ADMIN_PERMISSIONS.EDIT_TEST]} action="monitor live tests" />,
                children: [{ path: "/admin/tests/:testId/monitoring", element: <PageRoute Page={LiveMonitoringPage} /> }],
              },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.MANAGE_QUESTIONS, ADMIN_PERMISSIONS.VIEW_QUESTION_BANK]} action="access question bank" />,
                children: [{ path: "/admin/question-bank", element: <PageRoute Page={QuestionBankPage} /> }],
              },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.VIEW_RESOURCES, ADMIN_PERMISSIONS.MANAGE_RESOURCES]} action="access learning resources" />,
                children: [{ path: "/admin/resources", element: <PageRoute Page={LearningResourcesPage} /> }],
              },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.MANAGE_BATCHES, ADMIN_PERMISSIONS.VIEW_BATCHES]} action="access batches" />,
                children: [{ path: "/admin/batches", element: <PageRoute Page={BatchesPage} /> }],
              },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.MANAGE_STUDENTS, ADMIN_PERMISSIONS.VIEW_STUDENTS]} action="access students" />,
                children: [{ path: "/admin/students", element: <PageRoute Page={StudentsPage} /> }],
              },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.MANAGE_EVENTS, ADMIN_PERMISSIONS.VIEW_EVENTS]} action="access events" />,
                children: [{ path: "/admin/events", element: <PageRoute Page={EventsPage} /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.VIEW_REPORTS} action="view reports" />,
                children: [{ path: "/admin/reports", element: <PageRoute Page={ReportsPage} /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.VIEW_ANALYTICS} action="view analytics" />,
                children: [{ path: "/admin/analytics", element: <PageRoute Page={CollegeAnalyticsPage} /> }],
              },
              { path: "/admin/settings", element: <PageRoute Page={AdminSettingsPage} /> },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/admin/login" replace /> },
    ],
  },
]);

export default function AdminRouter() {
  return <RouterProvider router={router} />;
}
