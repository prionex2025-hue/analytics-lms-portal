import { Suspense, createElement, lazy, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from "react-router-dom";
import {
  accountInactiveDetected,
  applyRefreshPayload,
  markInitialized,
  refreshSession,
  logoutStudent,
  sessionExpired,
  setSessionConflict,
} from "@/features/Students/authSlice";
import { injectReducer } from "@/app/store";
import OfflineBanner from "@/components/common/OfflineBanner";
import IdleSessionTimeout from "@/components/common/IdleSessionTimeout";
import LoginPage from "@/pages/Students/LoginPage";
import { registerAuthInterceptorHandlers } from "@/services/httpClient";
import RouteErrorElement from "@/components/common/RouteErrorElement";

const STUDENT_ACCESS_TOKEN_KEY = "student_access_token";
const STUDENT_REFRESH_TOKEN_KEY = "student_refresh_token";
const STUDENT_SESSION_ID_KEY = "student_session_id";
const LEGACY_SESSION_KEY = "session_id";
const STUDENT_USER_KEY = "student_user";

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

const persistStudentAuth = (payload = {}) => {
  safeWriteStorage(STUDENT_ACCESS_TOKEN_KEY, null);
  safeWriteSessionStorage(STUDENT_ACCESS_TOKEN_KEY, payload.accessToken || null);
  safeWriteStorage(STUDENT_REFRESH_TOKEN_KEY, null);
  safeWriteSessionStorage(STUDENT_REFRESH_TOKEN_KEY, null);
  safeWriteStorage(STUDENT_SESSION_ID_KEY, payload.sessionId || null);
  safeWriteStorage(LEGACY_SESSION_KEY, payload.sessionId || null);
  safeWriteStorage(STUDENT_USER_KEY, payload.user ? JSON.stringify(payload.user) : null);
};

const clearStudentAuth = () => {
  safeWriteStorage(STUDENT_ACCESS_TOKEN_KEY, null);
  safeWriteSessionStorage(STUDENT_ACCESS_TOKEN_KEY, null);
  safeWriteStorage(STUDENT_REFRESH_TOKEN_KEY, null);
  safeWriteSessionStorage(STUDENT_REFRESH_TOKEN_KEY, null);
  safeWriteStorage(STUDENT_SESSION_ID_KEY, null);
  safeWriteStorage(LEGACY_SESSION_KEY, null);
  safeWriteStorage(STUDENT_USER_KEY, null);
};

const injectStudentReducers = async () => {
  const [portal, test, ui, learningResources] = await Promise.all([
    import("@/features/Students/portalSlice"),
    import("@/features/Students/testSlice"),
    import("@/features/Students/uiSlice"),
    import("@/features/LearningResources/learningResourcesSlice"),
  ]);

  injectReducer("portal", portal.default);
  injectReducer("test", test.default);
  injectReducer("ui", ui.default);
  injectReducer("learningResources", learningResources.default);
};

const lazyWithStudentReducers = (loader) => lazy(async () => {
  const [module] = await Promise.all([loader(), injectStudentReducers()]);
  return module;
});

const AppShell = lazyWithStudentReducers(() => import("@/components/Studetns/AppShell"));
const MyTestsPage = lazyWithStudentReducers(() => import("@/pages/Students/MyTestsPage"));
const OngoingTestsPage = lazyWithStudentReducers(() => import("@/pages/Students/OngoingTestsPage"));
const UpcomingTestsPage = lazyWithStudentReducers(() => import("@/pages/Students/UpcomingTestsPage"));
const ReportsPage = lazyWithStudentReducers(() => import("@/pages/Students/ReportsPage"));
const LeaderboardPage = lazyWithStudentReducers(() => import("@/pages/Students/LeaderboardPage"));
const SubmissionPage = lazyWithStudentReducers(() => import("@/pages/Students/SubmissionPage"));
const ResultsPage = lazyWithStudentReducers(() => import("@/pages/Students/ResultsPage"));
const ResumeAttemptPage = lazyWithStudentReducers(() => import("@/pages/Students/ResumeAttemptPage"));
const TestEnvironmentPage = lazyWithStudentReducers(() => import("@/pages/Students/TestEnvironmentPage"));
const TestInstructionsPage = lazyWithStudentReducers(() => import("@/pages/Students/TestInstructionsPage"));
const EventsPage = lazyWithStudentReducers(() => import("@/pages/Students/EventsPage"));
const LearningResourcesPage = lazyWithStudentReducers(() => import("@/pages/Students/LearningResourcesPage"));
const ProfilePage = lazyWithStudentReducers(() => import("@/pages/Students/ProfilePage"));
const SettingsPage = lazyWithStudentReducers(() => import("@/pages/Students/SettingsPage"));
const SessionConflictDialog = lazy(() => import("@/components/Students/SessionConflictDialog"));

const StudentPasswordResetPage = lazy(async () => {
  const [{ default: PasswordResetPage }, { studentApi }] = await Promise.all([
    import("@/pages/Auth/PasswordResetPage"),
    import("@/services/studentApi"),
  ]);

  return {
    default: function StudentPasswordResetRoute() {
      return (
        <PasswordResetPage
          portalName="Student"
          portalLabel="Student portal"
          loginPath="/login"
          mainPath="/"
          requestReset={studentApi.forgotPassword}
          completeReset={studentApi.resetPassword}
          buildForgotPayload={(identifier) => ({ identifier })}
          identifierLabel="Email or student ID"
          identifierPlaceholder="student@example.edu or STU123"
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

function AuthBootstrap() {
  const dispatch = useDispatch();
  const { initialized, accountInactive, sessionConflict, sessionId, user, accessToken } = useSelector((state) => state.auth);

  useEffect(() => {
    if (accessToken) {
      dispatch(markInitialized());
      return;
    }

    dispatch(refreshSession());
  }, [accessToken, dispatch]);

  useEffect(() => {
    registerAuthInterceptorHandlers({
      onRefreshSuccess: (payload) => {
        persistStudentAuth(payload || {});
        dispatch(applyRefreshPayload(payload));
      },
      onRefreshFailure: (_error, options = {}) => {
        if (!options?.forceLogout) {
          return;
        }

        clearStudentAuth();
        dispatch(sessionExpired());
      },
      onAccountInactive: () => {
        dispatch(accountInactiveDetected());
      },
    });
  }, [dispatch]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== STUDENT_SESSION_ID_KEY && event.key !== LEGACY_SESSION_KEY) {
        return;
      }

      if (!user || !sessionId) {
        return;
      }

      if (event.newValue && event.newValue !== sessionId) {
        dispatch(setSessionConflict(true));
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [dispatch, sessionId, user]);

  if (!initialized) {
    return <div className="grid min-h-screen place-items-center text-text-secondary">Initializing...</div>;
  }

  if (accountInactive) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted p-6">
        <div className="w-full max-w-xl rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-text-primary">Account Access Blocked</h1>
          <p className="mt-3 text-sm text-text-secondary">
            Your account is currently inactive. Please contact your institution administrator to reactivate access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <OfflineBanner />
      <Outlet />
      <IdleSessionTimeout enabled={Boolean(user)} onLogout={() => dispatch(logoutStudent())} />
      {sessionConflict ? (
        <Suspense fallback={null}>
          <SessionConflictDialog />
        </Suspense>
      ) : null}
    </>
  );
}

function ProtectedRoute() {
  const user = useSelector((state) => state.auth.user);
  const location = useLocation();
  return user ? <Outlet /> : <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
}

function PublicOnlyRoute() {
  const user = useSelector((state) => state.auth.user);
  const location = useLocation();
  const from = location.state?.from;
  return user ? <Navigate to={from || "/resume"} replace /> : <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <AuthBootstrap />,
    errorElement: <RouteErrorElement />,
    children: [
      {
        element: <PublicOnlyRoute />,
        children: [{ path: "/login", element: <LoginPage /> }],
      },
      {
        path: "/forgot-password",
        element: <PageRoute Page={StudentPasswordResetPage} />,
      },
      {
        path: "/reset-password",
        element: <PageRoute Page={StudentPasswordResetPage} />,
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <PageRoute Page={AppShell} fallback={<div className="grid min-h-screen place-items-center text-text-secondary">Loading portal...</div>} />,
            children: [
              { path: "/", element: <Navigate to="/resume" replace /> },
              { path: "/resume", element: <PageRoute Page={ResumeAttemptPage} /> },
              { path: "/tests", element: <PageRoute Page={MyTestsPage} /> },
              { path: "/tests/ongoing", element: <PageRoute Page={OngoingTestsPage} /> },
              { path: "/tests/upcoming", element: <PageRoute Page={UpcomingTestsPage} /> },
              { path: "/reports", element: <PageRoute Page={ReportsPage} /> },
              { path: "/leaderboard", element: <PageRoute Page={LeaderboardPage} /> },
              { path: "/resources", element: <PageRoute Page={LearningResourcesPage} /> },
              { path: "/events", element: <PageRoute Page={EventsPage} /> },
              { path: "/profile", element: <PageRoute Page={ProfilePage} /> },
              { path: "/settings", element: <PageRoute Page={SettingsPage} /> },
              { path: "/results/:attemptId", element: <PageRoute Page={ResultsPage} /> },
            ],
          },
          {
            path: "/tests/:testId/take",
            element: <PageRoute Page={TestEnvironmentPage} fallback={<div className="grid min-h-screen place-items-center text-text-secondary">Loading secure test environment...</div>} />,
          },
          {
            path: "/tests/:testId/instructions",
            element: <PageRoute Page={TestInstructionsPage} />,
          },
          {
            path: "/test/:attemptId",
            element: <PageRoute Page={TestEnvironmentPage} fallback={<div className="grid min-h-screen place-items-center text-text-secondary">Loading secure test environment...</div>} />,
          },
          { path: "/submission/:submissionId", element: <PageRoute Page={SubmissionPage} /> },
        ],
      },
      { path: "*", element: <Navigate to="/login" replace /> },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
