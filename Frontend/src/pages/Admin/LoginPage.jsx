import { useState } from "react";
import { Eye, EyeOff, Lock, ShieldCheck, User } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { Link, Navigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loginAdmin, logoutAdmin } from "@/features/Admin/adminAuthSlice";
import { isAdminRole, isCollegeAdminRole, normalizeAdminRole } from "@/features/Admin/adminRole";
import { useSeo } from "@/hooks/useSeo";
import { LOGIN_SEO } from "@/lib/seoMetadata";
import HardRedirect from "@/components/common/HardRedirect";

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
    <section className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f5f9ff] p-4 text-slate-950 sm:p-6 lg:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(37,99,235,0.16),transparent_32%),radial-gradient(circle_at_88%_78%,rgba(14,165,233,0.14),transparent_34%),linear-gradient(180deg,#ffffff_0%,#f4f8ff_100%)]" />
      <div className="pointer-events-none absolute inset-x-8 top-8 h-32 rounded-full bg-blue-500/10 blur-3xl" />

      <Card className="relative grid w-full max-w-7xl overflow-hidden rounded-[24px] border-white/80 bg-white shadow-[0_32px_90px_-36px_rgba(15,35,71,0.55)] lg:min-h-190 lg:grid-cols-[1.12fr_0.88fr]">
        <div className="relative hidden min-h-145 overflow-hidden bg-[#0837df] p-8 text-white lg:block lg:min-h-full lg:p-14">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#0c4cff_0%,#082bb7_44%,#06166f_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(56,189,248,0.34),transparent_30%),radial-gradient(circle_at_80%_70%,rgba(124,58,237,0.30),transparent_34%),radial-gradient(circle_at_44%_92%,rgba(14,165,233,0.22),transparent_28%)]" />
          <div className="absolute right-12 top-16 grid grid-cols-4 gap-3 opacity-50">
            {Array.from({ length: 16 }).map((_, index) => (
              <span key={index} className="size-1 rounded-full bg-white/70" />
            ))}
          </div>
          <div className="absolute left-8 bottom-22 grid grid-cols-4 gap-3 opacity-40">
            {Array.from({ length: 16 }).map((_, index) => (
              <span key={index} className="size-1 rounded-full bg-white/70" />
            ))}
          </div>
          <div className="absolute -left-24 top-28 h-80 w-80 rounded-full bg-sky-400/20 blur-3xl" />
          <div className="absolute -right-28 bottom-10 h-96 w-96 rounded-full bg-blue-300/16 blur-3xl" />
          <div className="absolute left-[-18%] top-[21%] h-64 w-[138%] rotate-[-31deg] rounded-[42px] border border-cyan-300/20 bg-white/3 shadow-[0_0_50px_rgba(34,211,238,0.16)]" />
          <div className="absolute left-[-12%] bottom-[12%] h-48 w-[130%] rotate-[-27deg] rounded-[36px] border border-blue-100/12 bg-blue-950/10" />
          <div className="absolute bottom-31 left-[-10%] h-px w-[120%] rotate-[-28deg] bg-linear-to-r from-transparent via-cyan-300/70 to-transparent shadow-[0_0_22px_rgba(34,211,238,0.8)]" />
          <div className="absolute bottom-18 left-[6%] h-px w-[110%] rotate-[-28deg] bg-linear-to-r from-transparent via-violet-300/65 to-transparent shadow-[0_0_20px_rgba(167,139,250,0.7)]" />
          <div className="absolute top-29 left-[12%] h-px w-[96%] rotate-[-31deg] bg-linear-to-r from-transparent via-blue-200/40 to-transparent" />
          <div className="relative z-10 flex h-full flex-col justify-between">
            <div>
              <img
                src="/analytics-logo-final.webp"
                alt="Analytics Logo"
                width="1976"
                height="630"
                decoding="async"
                className="h-11 w-auto max-w-72 object-contain brightness-0 invert"
              />
            </div>

            <div className="py-14 lg:py-0">
              <h1 className="max-w-xl text-5xl leading-[1.03] font-semibold tracking-tight text-white sm:text-6xl lg:text-[68px]">
                Lead your campus with clarity.
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-8 text-blue-50/90">
                Monitor students, assessments, and insights with centralized controls designed for your college administrators.
              </p>
            </div>

            <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-white/25 bg-white/10 px-5 py-4 text-sm font-semibold text-white shadow-[0_20px_55px_-24px_rgba(0,0,0,0.7)] backdrop-blur-xl">
              <span className="grid size-10 place-items-center rounded-full border border-white/35 bg-white/15 shadow-[0_0_26px_rgba(125,211,252,0.45)]">
                <ShieldCheck className="size-5" />
              </span>
              <span>Admins are managing exams this college</span>
            </div>
          </div>
        </div>

        <div className="flex items-center bg-white p-7 sm:p-10 lg:p-16">
          <div className="mx-auto w-full max-w-130">
            <Badge className="rounded-full bg-blue-600/12 px-4 py-1.5 text-xs font-bold tracking-wide text-blue-700 uppercase shadow-sm" variant="secondary">
              <ShieldCheck className="mr-1.5 size-3.5" />
              Admin Portal
            </Badge>
            <h2 className="mt-6 text-4xl leading-tight font-semibold tracking-tight text-slate-950 sm:text-5xl">Welcome Back</h2>
            <p className="mt-3 max-w-md text-base leading-7 text-slate-600">Please enter your credentials to access your admin portal.</p>

            <form method="post" onSubmit={onSubmit} className="mt-10 space-y-6">
              <div>
                <label className="mb-2.5 block text-xs font-bold tracking-wide text-slate-600 uppercase">Admin Email</label>
                <div className="flex h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.9)] transition focus-within:border-blue-500 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.10)]">
                  <User className="size-5 text-slate-500" />
                  <Input
                    name="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    required
                    className="h-auto border-0 bg-transparent p-0 text-base text-slate-700 shadow-none ring-0 placeholder:text-slate-400 focus-visible:ring-0"
                    placeholder="admin@college.edu"
                  />
                </div>
              </div>

              <div>
                <div className="mb-2.5 flex items-center justify-between text-xs font-bold tracking-wide text-slate-600 uppercase">
                  <span>Password</span>
                  <Link to="/admin/forgot-password" className="text-xs font-bold tracking-normal text-blue-600 normal-case hover:text-blue-700">
                    Forgot Password?
                  </Link>
                </div>
                <div className="flex h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.9)] transition focus-within:border-blue-500 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.10)]">
                  <Lock className="size-5 text-slate-500" />
                  <Input
                    name="password"
                    autoComplete="current-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-auto border-0 bg-transparent p-0 text-base text-slate-700 shadow-none ring-0 placeholder:text-slate-400 focus-visible:ring-0"
                    placeholder="Enter password"
                  />
                  <button type="button" className="text-slate-500 transition hover:text-blue-600" onClick={() => setShowPassword((prev) => !prev)}>
                    {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-3 text-base text-slate-600">
                <Checkbox
                  checked={rememberAdmin}
                  onCheckedChange={(checked) => setRememberAdmin(Boolean(checked))}
                  className="border-slate-300 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600"
                />
                Keep me logged in for 30 days
              </label>

              {(localError || error) ? <p className="text-sm font-medium text-danger">{localError || error}</p> : null}

              <Button
                type="submit"
                className="h-14 w-full rounded-xl bg-linear-to-r from-blue-600 via-blue-600 to-blue-700 text-base font-bold text-white shadow-[0_18px_40px_-18px_rgba(37,99,235,0.95)] transition hover:from-blue-700 hover:to-blue-800"
                disabled={loading}
              >
                {loading ? "Signing in..." : "Login as Admin"}
              </Button>
            </form>

            <p className="mt-9 text-sm text-slate-500">
              Need assistance? <button type="button" className="font-semibold text-blue-600 hover:text-blue-700">Contact technical support</button>
            </p>
          </div>
        </div>
      </Card>
    </section>
  );
}
