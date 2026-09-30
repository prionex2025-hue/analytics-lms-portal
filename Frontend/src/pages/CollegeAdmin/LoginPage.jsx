import { useState } from "react";
import { BarChart3, Building2, Eye, EyeOff, GraduationCap, LifeBuoy, Loader2, Lock, User, Users } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loginCollegeAdmin, logoutCollegeAdmin } from "@/features/CollegeAdmin/collegeAdminAuthSlice";
import {
  isAdminRole,
  isCollegeAdminRole,
  normalizeAdminRole,
} from "@/features/Admin/adminRole";
import { useSeo } from "@/hooks/useSeo";
import { LOGIN_SEO } from "@/lib/seoMetadata";
import HardRedirect from "@/components/common/HardRedirect";
import AuthSplitLayout from "@/components/common/AuthSplitLayout";
import { openSupportMail } from "@/lib/supportMail";

const HIGHLIGHTS = [
  { icon: Building2, title: "Departments and admins", text: "Structure your college and delegate with scoped access." },
  { icon: Users, title: "Every student, one view", text: "Accounts, batches, imports, and annual year promotion." },
  { icon: BarChart3, title: "College-wide insight", text: "Performance, readiness, and integrity across departments." },
];

export default function CollegeAdminLoginPage() {
  useSeo(LOGIN_SEO.collegeAdmin);

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { admin, loading, error } = useSelector((state) => state.collegeAdminAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  if (isAdminRole(admin?.role)) {
    return <HardRedirect to="/admin/dashboard" message="Redirecting to Admin portal..." />;
  }

  if (isCollegeAdminRole(admin?.role)) {
    return <Navigate to="/college-admin/dashboard" replace />;
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    setLocalError("");
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setLocalError("Please enter your email and password.");
      return;
    }

    const result = await dispatch(loginCollegeAdmin({ email: normalizedEmail, password, keepLoggedIn: rememberMe }));

    if (loginCollegeAdmin.rejected.match(result)) {
      setLocalError(result.error?.message || "Unable to sign in. Please try again.");
      return;
    }

    if (loginCollegeAdmin.fulfilled.match(result)) {
      const role = normalizeAdminRole(result.payload?.role);
      if (isAdminRole(role)) {
        window.location.replace("/admin/dashboard");
        return;
      }
      if (!isCollegeAdminRole(role)) {
        await dispatch(logoutCollegeAdmin());
        setLocalError("This account is not mapped to a supported admin portal.");
        return;
      }
      navigate("/college-admin/dashboard", { replace: true });
    }
  };

  return (
    <AuthSplitLayout
      headline="Manage one college, end to end."
      subline="Control departments, faculty admins, students, tests, and outcomes with strict college-level isolation."
      highlights={HIGHLIGHTS}
      footnote="College Admin Portal"
      badgeIcon={GraduationCap}
      badgeLabel="College admin workspace"
      title="Welcome Back"
      description="Please enter your credentials to access your college workspace."
      footer={
        <p className="mt-8 flex items-center gap-1.5 text-sm text-text-secondary">
          <LifeBuoy className="size-4" aria-hidden="true" />
          Need assistance?
          <button
            type="button"
            onClick={() =>
              openSupportMail({
                category: "College Admin login support",
                subject: "LMS College Admin Login Help",
                message: "Please describe the problem you are facing while signing in.",
                reporter: { role: "College Admin", email: email.trim() || undefined },
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
          <label htmlFor="college-login-email" className="mb-1.5 block text-sm font-medium text-text-primary">College Admin Email</label>
          <div className="relative">
            <User className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <Input
              id="college-login-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={localError || error ? true : undefined}
              className="h-11 rounded-lg bg-card pl-10 text-base sm:text-sm"
              placeholder="collegeadmin@college.edu"
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="college-login-password" className="text-sm font-medium text-text-primary">Password</label>
            <Link to="/college-admin/forgot-password" className="rounded text-sm font-medium text-primary outline-none hover:text-primary-dark hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              Forgot Password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <Input
              id="college-login-password"
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
          <Checkbox checked={rememberMe} onCheckedChange={(checked) => setRememberMe(Boolean(checked))} />
          Keep me logged in for 30 days
        </label>

        {localError || error ? (
          <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm font-medium text-danger">
            {localError || error}
          </p>
        ) : null}

        <Button type="submit" className="h-11 w-full rounded-lg text-sm font-semibold" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
          {loading ? "Signing in..." : "Login as College Admin"}
        </Button>
      </form>
    </AuthSplitLayout>
  );
}
