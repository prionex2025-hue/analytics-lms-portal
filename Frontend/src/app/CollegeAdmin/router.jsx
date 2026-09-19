import { Suspense, createElement, lazy, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { injectReducer } from "@/app/store";
import { fetchCurrentCollegeAdmin, logoutCollegeAdmin } from "@/features/CollegeAdmin/collegeAdminAuthSlice";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { isAdminRole, isCollegeAdminRole } from "@/features/Admin/adminRole";
import CollegeAdminLoginPage from "@/pages/CollegeAdmin/LoginPage";
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

const CollegeAdminPortalLayout = lazyWithAdminReducers(() => import("@/components/CollegeAdmin/CollegeAdminPortalLayout"));
const CollegeAdminDashboardPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/DashboardPage"));
const CollegeAdminTestsPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/TestsPage"));
const LiveMonitoringPage = lazyWithAdminReducers(() => import("@/pages/Admin/LiveMonitoringPage"));
const CollegeAdminQuestionBankPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/QuestionBankPage"));
const CollegeAdminBatchesPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/BatchesPage"));
const CollegeAdminStudentsPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/StudentsPage"));
const CollegeAdminEventsPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/EventsPage"));
const CollegeAdminReportsPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/ReportsPage"));
const CollegeAdminSettingsPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/SettingsPage"));
const DepartmentsManagementPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/DepartmentsManagementPage"));
const AdminManagementPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/AdminManagementPage"));
const CollegeAnalyticsPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/CollegeAnalyticsPage"));
const CollegeAdminLearningResourcesPage = lazyWithAdminReducers(() => import("@/pages/CollegeAdmin/LearningResourcesPage"));
const PermissionDenied = lazy(() => import("@/components/Admin/PermissionDenied"));

const CollegeAdminPasswordResetPage = lazy(async () => {
  const [{ default: PasswordResetPage }, { adminApi }] = await Promise.all([
    import("@/pages/Auth/PasswordResetPage"),
    import("@/services/api"),
  ]);

  return {
    default: function CollegeAdminPasswordResetRoute() {
      return (
        <PasswordResetPage
          portalName="College Admin"
          portalLabel="College admin workspace"
          loginPath="/college-admin/login"
          mainPath="/college-admin"
          requestReset={adminApi.forgotCollegeAdminPassword}
          completeReset={adminApi.resetCollegeAdminPassword}
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
  const effectivePermissions = useSelector((state) => state.collegeAdminAuth.permissions || []);
  const required = permissions || (permission ? [permission] : []);
  const allowed = required.length === 0 || required.some((item) => effectivePermissions.includes(item));
  return allowed ? <Outlet /> : <PageRoute Page={() => <PermissionDenied action={action} />} />;
}

function CollegeAdminBootstrap() {
  const dispatch = useDispatch();
  const initialized = useSelector((state) => state.collegeAdminAuth.initialized);
  const admin = useSelector((state) => state.collegeAdminAuth.admin);
  useNoIndexRoute();

  useEffect(() => {
    dispatch(fetchCurrentCollegeAdmin());
  }, [dispatch]);

  if (!initialized) {
    return <div className="grid min-h-screen place-items-center text-text-secondary">Initializing college admin session...</div>;
  }

  return (
    <>
      <Outlet />
      <IdleSessionTimeout enabled={Boolean(admin)} onLogout={() => dispatch(logoutCollegeAdmin())} />
    </>
  );
}

function CollegeAdminProtectedRoute() {
  const admin = useSelector((state) => state.collegeAdminAuth.admin);
  if (!admin) {
    return <Navigate to="/college-admin/login" replace />;
  }
  if (isAdminRole(admin.role)) {
    return <HardRedirect to="/admin/dashboard" message="Redirecting to Admin portal..." />;
  }
  if (!isCollegeAdminRole(admin.role)) {
    return <Navigate to="/college-admin/login" replace />;
  }
  return <Outlet />;
}

function CollegeAdminPublicOnlyRoute() {
  const admin = useSelector((state) => state.collegeAdminAuth.admin);
  if (isCollegeAdminRole(admin?.role)) {
    return <Navigate to="/college-admin/dashboard" replace />;
  }
  if (isAdminRole(admin?.role)) {
    return <HardRedirect to="/admin/dashboard" message="Redirecting to Admin portal..." />;
  }
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <CollegeAdminBootstrap />,
    errorElement: <RouteErrorElement />,
    children: [
      {
        element: <CollegeAdminPublicOnlyRoute />,
        children: [{ path: "/college-admin/login", element: <CollegeAdminLoginPage /> }],
      },
      {
        path: "/college-admin/forgot-password",
        element: <PageRoute Page={CollegeAdminPasswordResetPage} />,
      },
      {
        path: "/college-admin/reset-password",
        element: <PageRoute Page={CollegeAdminPasswordResetPage} />,
      },
      {
        element: <CollegeAdminProtectedRoute />,
        children: [
          {
            element: <PageRoute Page={CollegeAdminPortalLayout} fallback={<div className="grid min-h-screen place-items-center text-text-secondary">Loading college admin workspace...</div>} />,
            children: [
              { path: "/college-admin", element: <Navigate to="/college-admin/dashboard" replace /> },
              { path: "/college-admin/dashboard", element: <PageRoute Page={CollegeAdminDashboardPage} /> },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_DEPARTMENTS} action="manage departments" />,
                children: [{ path: "/college-admin/departments", element: <PageRoute Page={DepartmentsManagementPage} /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_ADMINS} action="manage admins" />,
                children: [{ path: "/college-admin/admins", element: <PageRoute Page={AdminManagementPage} /> }],
              },
              { path: "/college-admin/tests", element: <PageRoute Page={CollegeAdminTestsPage} /> },
              { path: "/college-admin/tests/create", element: <PageRoute Page={CollegeAdminTestsPage} /> },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.VIEW_TESTS, ADMIN_PERMISSIONS.EDIT_TEST]} action="monitor live tests" />,
                children: [{ path: "/college-admin/tests/:testId/monitoring", element: <PageRoute Page={LiveMonitoringPage} /> }],
              },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.MANAGE_QUESTIONS, ADMIN_PERMISSIONS.VIEW_QUESTION_BANK]} action="access question bank" />,
                children: [{ path: "/college-admin/question-bank", element: <PageRoute Page={CollegeAdminQuestionBankPage} /> }],
              },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.VIEW_RESOURCES, ADMIN_PERMISSIONS.MANAGE_RESOURCES]} action="access learning resources" />,
                children: [{ path: "/college-admin/resources", element: <PageRoute Page={CollegeAdminLearningResourcesPage} /> }],
              },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.MANAGE_BATCHES, ADMIN_PERMISSIONS.VIEW_BATCHES]} action="access batches" />,
                children: [{ path: "/college-admin/batches", element: <PageRoute Page={CollegeAdminBatchesPage} /> }],
              },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.MANAGE_STUDENTS, ADMIN_PERMISSIONS.VIEW_STUDENTS]} action="access students" />,
                children: [{ path: "/college-admin/students", element: <PageRoute Page={CollegeAdminStudentsPage} /> }],
              },
              {
                element: <PermissionRoute permissions={[ADMIN_PERMISSIONS.MANAGE_EVENTS, ADMIN_PERMISSIONS.VIEW_EVENTS]} action="access events" />,
                children: [{ path: "/college-admin/events", element: <PageRoute Page={CollegeAdminEventsPage} /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.VIEW_REPORTS} action="view reports" />,
                children: [{ path: "/college-admin/reports", element: <PageRoute Page={CollegeAdminReportsPage} /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.VIEW_ANALYTICS} action="view analytics" />,
                children: [{ path: "/college-admin/analytics", element: <PageRoute Page={CollegeAnalyticsPage} /> }],
              },
              { path: "/college-admin/settings", element: <PageRoute Page={CollegeAdminSettingsPage} /> },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/college-admin/login" replace /> },
    ],
  },
]);

export default function CollegeAdminRouter() {
  return <RouterProvider router={router} />;
}
