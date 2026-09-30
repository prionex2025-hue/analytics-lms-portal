import { useState } from "react";
import { BarChart3, Eye, EyeOff, FileCheck2, LifeBuoy, Loader2, Lock, ShieldCheck, User, Users } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { Link, Navigate } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loginAdmin, logoutAdmin } from "@/features/Admin/adminAuthSlice";
import { isAdminRole, isCollegeAdminRole, normalizeAdminRole } from "@/features/Admin/adminRole";
import { useSeo } from "@/hooks/useSeo";
import { LOGIN_SEO } from "@/lib/seoMetadata";
import HardRedirect from "@/components/common/HardRedirect";
import AuthSplitLayout from "@/components/common/AuthSplitLayout";
import { openSupportMail } from "@/lib/supportMail";

const HIGHLIGHTS = [
  { icon: FileCheck2, title: "Tests end to end", text: "Build, schedule, and monitor tests for your department." },
  { icon: Users, title: "Students and batches", text: "Manage accounts, batches, and bulk imports in one place." },
  { icon: BarChart3, title: "Actionable reports", text: "Scores, integrity flags, and trends per test and student." },
];

export default function AdminLoginPage() {
  useSeo(LOGIN_SEO.admin);

  const dispatch = useDispatch();
  const { admin, loading, error } = useSelector((state) => state.adminAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberAdmin, setRememberAdmin] = useState(false);
  const [localError, setLocalError] = useState("");

  if (admin && isCollegeAdminRole(admin.role)) {
    return <HardRedirect to="/college-admin/dashboard" message="Redirecting to College Admin portal..." />;
  }

  if (admin && isAdminRole(admin.role)) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    setLocalError("");
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setLocalError("Please enter your email and password.");
      return;
    }

    const result = await dispatch(loginAdmin({ email: normalizedEmail, password, keepLoggedIn: rememberAdmin }));

    if (loginAdmin.rejected.match(result)) {
      setLocalError(result.error?.message || "Unable to sign in. Please try again.");
      return;
    }

    if (loginAdmin.fulfilled.match(result)) {
      const role = normalizeAdminRole(result.payload?.role);
      if (isCollegeAdminRole(role)) {
        window.location.replace("/college-admin/dashboard");
        return;
      }
      if (isAdminRole(role)) {
        window.location.replace("/admin/dashboard");
        return;
      }

      await dispatch(logoutAdmin());
      setLocalError("This account is not mapped to a supported admin portal.");
    }
  };

  return (
    <AuthSplitLayout
      headline="Lead your campus with clarity."
      subline="Monitor students, assessments, and insights with centralized controls designed for your college administrators."
      highlights={HIGHLIGHTS}
      footnote="Admin Portal"
      badgeIcon={ShieldCheck}
      badgeLabel="Admin Portal"
      title="Welcome Back"
      description="Please enter your credentials to access your admin workspace."
      footer={
        <p className="mt-8 flex items-center gap-1.5 text-sm text-text-secondary">
          <LifeBuoy className="size-4" aria-hidden="true" />
          Need assistance?
          <button
            type="button"
            onClick={() =>
              openSupportMail({
                category: "Admin login support",
                subject: "LMS Admin Login Help",
                message: "Please describe the problem you are facing while signing in.",
                reporter: { role: "Admin", email: email.trim() || undefined },
              })
            }
            className="rounded font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Contact technical support
          </button>
        </p>
      }
    >
      <form method="post" onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <div>
          <label htmlFor="admin-login-email" className="mb-1.5 block text-sm font-medium text-text-primary">Admin Email</label>
          <div className="relative">
            <User className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <Input
              id="admin-login-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={localError || error ? true : undefined}
              className="h-11 rounded-lg bg-card pl-10 text-base sm:text-sm"
              placeholder="admin@college.edu"
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="admin-login-password" className="text-sm font-medium text-text-primary">Password</label>
            <Link to="/admin/forgot-password" className="rounded text-sm font-medium text-primary outline-none hover:text-primary-dark hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              Forgot Password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <Input
              id="admin-login-password"
              name="password"
              autoComplete="current-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={localError || error ? true : undefined}
              className="h-11 rounded-lg bg-card pr-11 pl-10 text-base sm:text-sm"
              placeholder="Enter password"
            />
            <button
              type="button"
              className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-md text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text-secondary">
          <Checkbox checked={rememberAdmin} onCheckedChange={(checked) => setRememberAdmin(Boolean(checked))} />
          Keep me logged in for 30 days
        </label>

        {localError || error ? (
          <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm font-medium text-danger">
            {localError || error}
          </p>
        ) : null}

        <Button type="submit" className="h-11 w-full rounded-lg text-sm font-semibold" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
          {loading ? "Signing in..." : "Login as Admin"}
        </Button>
      </form>
    </AuthSplitLayout>
  );
}
