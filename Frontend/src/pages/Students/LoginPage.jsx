import { useState } from "react";
import { BarChart3, Eye, EyeOff, GraduationCap, LifeBuoy, Loader2, Lock, ShieldCheck, Timer, User } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { loginStudent } from "@/features/Students/authSlice";
import { useSeo } from "@/hooks/useSeo";
import { LOGIN_SEO } from "@/lib/seoMetadata";
import { openSupportMail } from "@/lib/supportMail";
import AuthSplitLayout from "@/components/common/AuthSplitLayout";

const HIGHLIGHTS = [
  { icon: Timer, title: "Timed, proctored tests", text: "Answers autosave as you go, even on a shaky connection." },
  { icon: BarChart3, title: "Clear performance reports", text: "Score trends, topic strengths, and detailed answer review." },
  { icon: ShieldCheck, title: "Secure by default", text: "Single active session with automatic idle sign-out." },
];

export default function LoginPage() {
  useSeo(LOGIN_SEO.student);

  const dispatch = useDispatch();
  const { user, loading, error } = useSelector((state) => state.auth);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);

  if (user) return <Navigate to="/resume" replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier || !password) {
      return;
    }

    await dispatch(loginStudent({ identifier: normalizedIdentifier, password, keepLoggedIn }));
  };

  const openLoginSupport = () => {
    openSupportMail({
      category: "Student login support",
      subject: "LMS Student Login Help",
      message: "Please describe the problem you are facing while signing in.",
      reporter: { role: "Student", id: identifier.trim() || undefined },
    });
  };

  return (
    <AuthSplitLayout
      headline="Unlock your academic potential."
      subline="Take your tests, track your progress, and see exactly where to focus next — all in one quiet space."
      highlights={HIGHLIGHTS}
      footnote="Student Portal"
      badgeIcon={GraduationCap}
      badgeLabel="Student Portal"
      title="Welcome Back"
      description="Please enter your credentials to access your test portal."
      footer={
        <p className="mt-8 flex items-center gap-1.5 text-sm text-text-secondary">
          <LifeBuoy className="size-4" aria-hidden="true" />
          Need assistance?
          <button type="button" onClick={openLoginSupport} className="rounded font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            Contact technical support
          </button>
        </p>
      }
    >
      <form method="post" onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="student-identifier" className="mb-1.5 block text-sm font-medium text-text-primary">Student ID or Email</label>
          <div className="relative">
            <User className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <Input
              id="student-identifier"
              name="identifier"
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              className="h-11 rounded-lg bg-card pl-10 text-base sm:text-sm"
              placeholder="e.g. STU-882910"
              aria-invalid={error ? true : undefined}
              required
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="student-password" className="text-sm font-medium text-text-primary">Password</label>
            <Link to="/forgot-password" className="rounded text-sm font-medium text-primary outline-none hover:text-primary-dark hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              Forgot Password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <Input
              id="student-password"
              name="password"
              autoComplete="current-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 rounded-lg bg-card pr-11 pl-10 text-base sm:text-sm"
              placeholder="Enter password"
              aria-invalid={error ? true : undefined}
              required
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
          <Checkbox checked={keepLoggedIn} onCheckedChange={(checked) => setKeepLoggedIn(Boolean(checked))} />
          Keep me logged in for 30 days
        </label>

        {error ? (
          <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="h-11 w-full rounded-lg text-sm font-semibold" disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
          {loading ? "Logging in..." : "Login as Student"}
        </Button>
      </form>
    </AuthSplitLayout>
  );
}
