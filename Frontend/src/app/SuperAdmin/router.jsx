import { Suspense, createElement, lazy, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from "react-router-dom";
import { injectReducer } from "@/app/store";
import { fetchCurrentSuperAdmin, logoutSuperAdmin } from "@/features/SuperAdmin/superAdminAuthSlice";
import SuperAdminLoginPage from "@/pages/SuperAdmin/LoginPage";
import IdleSessionTimeout from "@/components/common/IdleSessionTimeout";
import RouteErrorElement from "@/components/common/RouteErrorElement";
import { useNoIndexRoute } from "@/hooks/useNoIndexRoute";

const injectSuperAdminReducers = async () => {
  const [dashboard, panel, ui, questionBank, testCreation, learningResources] = await Promise.all([
    import("@/features/SuperAdmin/superAdminDashboardSlice"),
    import("@/features/SuperAdmin/superAdminPanelSlice"),
    import("@/features/SuperAdmin/superAdminUiSlice"),
    import("@/features/SuperAdmin/superQuestionBankSlice"),
    import("@/features/Admin/testCreationSlice"),
    import("@/features/LearningResources/learningResourcesSlice"),
  ]);

  injectReducer("superAdminDashboard", dashboard.default);
  injectReducer("superAdminPanel", panel.default);
  injectReducer("superAdminUi", ui.default);
  injectReducer("superQuestionBank", questionBank.default);
  injectReducer("testCreation", testCreation.default);
  injectReducer("learningResources", learningResources.default);
};

const lazyWithSuperAdminReducers = (loader) => lazy(async () => {
  const [module] = await Promise.all([loader(), injectSuperAdminReducers()]);
  return module;
});

const SuperAdminPortalLayout = lazyWithSuperAdminReducers(() => import("@/components/SuperAdmin/SuperAdminPortalLayout"));
const SuperAdminDashboardPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/DashboardPage"));
const CollegesPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/CollegesPage"));
const SystemAdministratorsPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/SystemAdministratorsPage"));
const AdminsPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/AdminsPage"));
const StudentsPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/StudentsPage"));
const DepartmentsPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/DepartmentsPage"));
const TestsPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/TestsPage"));
const LiveMonitoringPage = lazyWithSuperAdminReducers(() => import("@/pages/Admin/LiveMonitoringPage"));
const BatchesPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/BatchesPage"));
const EventsPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/EventsPage"));
const ReportsPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/ReportsPage"));
const AnalyticsPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/AnalyticsPage"));
const SettingsPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/SettingsPage"));
const QuestionBankPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/QuestionBankPage"));
const LearningResourcesPage = lazyWithSuperAdminReducers(() => import("@/pages/SuperAdmin/LearningResourcesPage"));

const SuperAdminPasswordResetPage = lazy(async () => {
  const [{ default: PasswordResetPage }, { superAdminApi }] = await Promise.all([
    import("@/pages/Auth/PasswordResetPage"),
    import("@/services/api"),
  ]);

  return {
    default: function SuperAdminPasswordResetRoute() {
      return (
        <PasswordResetPage
          portalName="Super Admin"
          portalLabel="Super admin workspace"
          loginPath="/super-admin/login"
          mainPath="/super-admin"
          requestReset={superAdminApi.forgotPassword}
          completeReset={superAdminApi.resetPassword}
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

function SuperAdminBootstrap() {
  const dispatch = useDispatch();
  const initialized = useSelector((state) => state.superAdminAuth.initialized);
  const superAdmin = useSelector((state) => state.superAdminAuth.superAdmin);
  useNoIndexRoute();

  useEffect(() => {
    dispatch(fetchCurrentSuperAdmin());
  }, [dispatch]);

  if (!initialized) {
    return <div className="grid min-h-screen place-items-center text-text-secondary">Initializing super admin session...</div>;
  }

  return (
    <>
      <Outlet />
      <IdleSessionTimeout enabled={Boolean(superAdmin)} onLogout={() => dispatch(logoutSuperAdmin())} />
    </>
  );
}

function SuperAdminProtectedRoute() {
  const superAdmin = useSelector((state) => state.superAdminAuth.superAdmin);
  return superAdmin ? <Outlet /> : <Navigate to="/super-admin/login" replace />;
}

function SuperAdminPublicOnlyRoute() {
  const superAdmin = useSelector((state) => state.superAdminAuth.superAdmin);
  return superAdmin ? <Navigate to="/super-admin/dashboard" replace /> : <Outlet />;
}

function SuperAdminAliasRedirect() {
  const location = useLocation();
  const nextPath = location.pathname.replace(/^\/superadmin(?=\/|$)/, "/super-admin");
  return <Navigate to={`${nextPath}${location.search}${location.hash}`} replace />;
}

const router = createBrowserRouter([
  {
    element: <SuperAdminBootstrap />,
    errorElement: <RouteErrorElement />,
    children: [
      { path: "/superadmin", element: <SuperAdminAliasRedirect /> },
      { path: "/superadmin/*", element: <SuperAdminAliasRedirect /> },
      {
        element: <SuperAdminPublicOnlyRoute />,
        children: [{ path: "/super-admin/login", element: <SuperAdminLoginPage /> }],
      },
      {
        path: "/super-admin/forgot-password",
        element: <PageRoute Page={SuperAdminPasswordResetPage} />,
      },
      {
        path: "/super-admin/reset-password",
        element: <PageRoute Page={SuperAdminPasswordResetPage} />,
      },
      {
        element: <SuperAdminProtectedRoute />,
        children: [
          {
            element: <PageRoute Page={SuperAdminPortalLayout} fallback={<div className="grid min-h-screen place-items-center text-text-secondary">Loading super admin workspace...</div>} />,
            children: [
              { path: "/super-admin", element: <Navigate to="/super-admin/dashboard" replace /> },
              { path: "/super-admin/dashboard", element: <PageRoute Page={SuperAdminDashboardPage} /> },
              { path: "/super-admin/colleges", element: <PageRoute Page={CollegesPage} /> },
              { path: "/super-admin/system-admins", element: <PageRoute Page={SystemAdministratorsPage} /> },
              { path: "/super-admin/admins", element: <PageRoute Page={AdminsPage} /> },
              { path: "/super-admin/students", element: <PageRoute Page={StudentsPage} /> },
              { path: "/super-admin/departments", element: <PageRoute Page={DepartmentsPage} /> },
              { path: "/super-admin/tests", element: <PageRoute Page={TestsPage} /> },
              { path: "/super-admin/tests/create", element: <PageRoute Page={TestsPage} /> },
              { path: "/super-admin/tests/:testId/monitoring", element: <PageRoute Page={LiveMonitoringPage} /> },
              { path: "/super-admin/question-bank", element: <PageRoute Page={QuestionBankPage} /> },
              { path: "/super-admin/resources", element: <PageRoute Page={LearningResourcesPage} /> },
              { path: "/super-admin/batches", element: <PageRoute Page={BatchesPage} /> },
              { path: "/super-admin/events", element: <PageRoute Page={EventsPage} /> },
              { path: "/super-admin/reports", element: <PageRoute Page={ReportsPage} /> },
              { path: "/super-admin/analytics", element: <PageRoute Page={AnalyticsPage} /> },
              { path: "/super-admin/settings", element: <PageRoute Page={SettingsPage} /> },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/super-admin/login" replace /> },
    ],
  },
]);

export default function SuperAdminRouter() {
  return <RouterProvider router={router} />;
}
