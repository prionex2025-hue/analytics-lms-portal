import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSeo } from "@/hooks/useSeo";
import { SITE_NAME } from "@/lib/seoMetadata";

const extractResetUrl = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  return payload.resetUrl || payload.resetURL || payload.details?.resetUrl || "";
};

export default function PasswordResetPage({
  portalName,
  portalLabel,
  loginPath,
  mainPath = "/",
  requestReset,
  completeReset,
  buildForgotPayload = (identifier) => ({ email: identifier }),
  identifierLabel = "Email address",
  identifierPlaceholder = "name@example.com",
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const token = String(searchParams.get("token") || "").trim();
  const resetSuccessFromUrl = searchParams.get("reset") === "success";
  const [resetCompleted, setResetCompleted] = useState(resetSuccessFromUrl);
  const isResetMode = Boolean(token) || resetCompleted;
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [devResetUrl, setDevResetUrl] = useState("");

  const title = useMemo(
    () => (isResetMode ? `Reset ${portalName} Password` : `Forgot ${portalName} Password`),
    [isResetMode, portalName]
  );

  useSeo({
    title: `${title} | ${SITE_NAME}`,
    description: `${portalName} password recovery for ${SITE_NAME}.`,
    keywords: `${portalName} forgot password, ${portalName} reset password, Analytics Edify LMS password reset`,
  });

  const submitForgotPassword = async (event) => {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setDevResetUrl("");

    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) {
      setError(`Please enter your ${identifierLabel.toLowerCase()}.`);
      return;
    }

    setLoading(true);
    try {
      const payload = await requestReset(buildForgotPayload(normalizedIdentifier));
      setSuccessMessage("If an account matches, password reset instructions will be sent.");
      setDevResetUrl(extractResetUrl(payload));
    } catch (requestError) {
      setError(requestError?.message || "Unable to request a password reset right now.");
    } finally {
      setLoading(false);
    }
  };

  const submitResetPassword = async (event) => {
    event.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!token) {
      setError("Reset token is missing or invalid.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await completeReset({ token, password });
      setResetCompleted(true);
      setSuccessMessage("Password reset successfully. This reset link has expired.");
      setSearchParams({ reset: "success" }, { replace: true });
      setPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setError(requestError?.message || "Unable to reset the password. Please request a new link.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f5f9ff] p-4 text-slate-950 sm:p-6 lg:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(37,99,235,0.16),transparent_32%),radial-gradient(circle_at_88%_78%,rgba(14,165,233,0.14),transparent_34%),linear-gradient(180deg,#ffffff_0%,#f4f8ff_100%)]" />
      <Card className="relative w-full max-w-lg rounded-[24px] border-white/80 bg-white p-8 shadow-[0_32px_90px_-36px_rgba(15,35,71,0.55)] sm:p-10">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-7 text-slate-600 hover:text-blue-700">
            <Link to={loginPath}>
              <ArrowLeft className="size-4" />
              Back to login
            </Link>
          </Button>

          <Badge
            className="rounded-full bg-blue-600/12 px-4 py-1.5 text-xs font-bold tracking-wide text-blue-700 uppercase shadow-sm"
            variant="secondary"
          >
            <ShieldCheck className="mr-1.5 size-3.5" />
            {portalLabel}
          </Badge>
          <h1 className="mt-6 text-3xl leading-tight font-semibold tracking-tight text-slate-950 sm:text-4xl">
            {resetCompleted ? "Password reset successfully" : isResetMode ? "Set a new password" : "Reset your password"}
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-600">
            {resetCompleted
              ? "Your password has been updated and the reset link is now expired."
              : isResetMode
              ? "Choose a strong password for your account."
              : "Enter your account details and the portal will send password reset instructions if the account exists."}
          </p>
        </div>

        {resetCompleted ? (
          <div className="mt-9 rounded-2xl border border-emerald-200 bg-linear-to-br from-emerald-50 via-white to-blue-50 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="size-6" />
              </span>
              <div>
                <p className="text-base font-semibold text-slate-950">
                  Password reset successfully
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  This reset link has expired and cannot be used again. Continue with your new password.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Button asChild className="h-12 rounded-xl bg-linear-to-r from-blue-600 via-blue-600 to-blue-700 font-bold text-white shadow-[0_18px_40px_-18px_rgba(37,99,235,0.95)]">
                <Link to={loginPath}>Continue to login</Link>
              </Button>
              <Button asChild variant="outline" className="h-12 rounded-xl">
                <Link to={mainPath}>Open main portal</Link>
              </Button>
            </div>
          </div>
        ) : isResetMode ? (
          <form onSubmit={submitResetPassword} className="mt-9 space-y-5">
            <div>
              <label className="mb-2.5 block text-xs font-bold tracking-wide text-slate-600 uppercase">
                New password
              </label>
              <div className="flex h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition focus-within:border-blue-500 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.10)]">
                <KeyRound className="size-5 text-slate-500" />
                <Input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="h-auto border-0 bg-transparent p-0 text-base text-slate-700 shadow-none ring-0 placeholder:text-slate-400 focus-visible:ring-0"
                  placeholder="Enter new password"
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="text-slate-500 transition hover:text-blue-600"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2.5 block text-xs font-bold tracking-wide text-slate-600 uppercase">
                Confirm password
              </label>
              <div className="flex h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition focus-within:border-blue-500 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.10)]">
                <KeyRound className="size-5 text-slate-500" />
                <Input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="h-auto border-0 bg-transparent p-0 text-base text-slate-700 shadow-none ring-0 placeholder:text-slate-400 focus-visible:ring-0"
                  placeholder="Confirm new password"
                  required
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                  className="text-slate-500 transition hover:text-blue-600"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                >
                  {showConfirmPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
            </div>

            {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
            {successMessage ? (
              <p className="flex items-start gap-2 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="mt-0.5 size-4" />
                <span>{successMessage}</span>
              </p>
            ) : null}

            <Button
              type="submit"
              className="h-14 w-full rounded-xl bg-linear-to-r from-blue-600 via-blue-600 to-blue-700 text-base font-bold text-white shadow-[0_18px_40px_-18px_rgba(37,99,235,0.95)] transition hover:from-blue-700 hover:to-blue-800"
              disabled={loading || Boolean(successMessage)}
            >
              {loading ? "Resetting password..." : "Reset Password"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitForgotPassword} className="mt-9 space-y-5">
            <div>
              <label className="mb-2.5 block text-xs font-bold tracking-wide text-slate-600 uppercase">
                {identifierLabel}
              </label>
              <div className="flex h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition focus-within:border-blue-500 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.10)]">
                <Mail className="size-5 text-slate-500" />
                <Input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  type="text"
                  autoComplete="email"
                  className="h-auto border-0 bg-transparent p-0 text-base text-slate-700 shadow-none ring-0 placeholder:text-slate-400 focus-visible:ring-0"
                  placeholder={identifierPlaceholder}
                  required
                />
              </div>
            </div>

            {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
            {successMessage ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4" />
                  <span>{successMessage}</span>
                </div>
                {devResetUrl ? (
                  <Button asChild variant="link" className="mt-3 h-auto p-0 text-emerald-800 hover:text-emerald-900">
                    <a href={devResetUrl}>Open reset link</a>
                  </Button>
                ) : null}
              </div>
            ) : null}

            <Button
              type="submit"
              className="h-14 w-full rounded-xl bg-linear-to-r from-blue-600 via-blue-600 to-blue-700 text-base font-bold text-white shadow-[0_18px_40px_-18px_rgba(37,99,235,0.95)] transition hover:from-blue-700 hover:to-blue-800"
              disabled={loading}
            >
              {loading ? "Sending instructions..." : "Send Reset Instructions"}
            </Button>
          </form>
        )}
      </Card>
    </section>
  );
}
