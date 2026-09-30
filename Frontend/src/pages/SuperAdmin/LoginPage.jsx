import { useState } from "react";
import { Activity, Eye, EyeOff, Globe2, LifeBuoy, Loader2, Lock, ShieldCheck, User, Users } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { Link, Navigate } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import AuthSplitLayout from "@/components/common/AuthSplitLayout";
import { loginSuperAdmin } from "@/features/SuperAdmin/superAdminAuthSlice";
import { useSeo } from "@/hooks/useSeo";
import { LOGIN_SEO } from "@/lib/seoMetadata";
import { openSupportMail } from "@/lib/supportMail";

const HIGHLIGHTS = [
  { icon: Globe2, title: "Global visibility", text: "Every college, admin, student, and test in one place." },
  { icon: Activity, title: "Live oversight", text: "Monitor running tests, system health, and escalations." },
  { icon: Users, title: "Scoped administration", text: "Delegate to college and department admins with audited access." },
];

export default function SuperAdminLoginPage() {
  useSeo(LOGIN_SEO.superAdmin);

  const dispatch = useDispatch();
  const { superAdmin, loading, error } = useSelector((state) => state.superAdminAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberSuperAdmin, setRememberSuperAdmin] = useState(false);

  if (superAdmin) {
    return <Navigate to="/super-admin/dashboard" replace />;
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    await dispatch(loginSuperAdmin({ email, password, keepLoggedIn: rememberSuperAdmin }));
  };

  return (
    <AuthSplitLayout
      headline="Govern your entire platform."
      subline="Supervise colleges, admins, and system-wide analytics from one secure global control center."
      highlights={HIGHLIGHTS}
      footnote="Super Admin Portal"
      badgeIcon={ShieldCheck}
      badgeLabel="Super Admin Portal"
      title="Welcome Back"
      description="Please enter your credentials to access your global control panel."
      footer={
        <p className="mt-8 flex items-center gap-1.5 text-sm text-text-secondary">
          <LifeBuoy className="size-4" aria-hidden="true" />
          Need assistance?
          <button
            type="button"
            onClick={() =>
              openSupportMail({
                category: "Super admin login support",
                subject: "LMS Super Admin Login Help",
                message: "Please describe the problem you are facing while signing in.",
                reporter: { role: "Super Admin", email: email.trim() || undefined },
              })
            }
            className="rounded font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Contact technical support
          </button>
        </p>
      }
    >
      <form method="post" onSubmit={onSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="super-admin-email" className="mb-1.5 block text-sm font-medium text-text-primary">Super Admin Email</label>
          <div className="relative">
            <User className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <Input
              id="super-admin-email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              aria-invalid={error ? true : undefined}
              className="h-11 rounded-lg bg-card pl-10 text-base sm:text-sm"
              placeholder="superadmin@lms.com"
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="super-admin-password" className="text-sm font-medium text-text-primary">Password</label>
            <Link to="/super-admin/forgot-password" className="rounded text-sm font-medium text-primary outline-none hover:text-primary-dark hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              Forgot Password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <Input
              id="super-admin-password"
              name="password"
              autoComplete="current-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-invalid={error ? true : undefined}
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
          <Checkbox checked={rememberSuperAdmin} onCheckedChange={(checked) => setRememberSuperAdmin(Boolean(checked))} />
          Keep me logged in for 30 days
        </label>

        {error ? (
          <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="h-11 w-full rounded-lg text-sm font-semibold" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
          {loading ? "Signing in..." : "Login as Super Admin"}
        </Button>
      </form>
    </AuthSplitLayout>
  );
}
