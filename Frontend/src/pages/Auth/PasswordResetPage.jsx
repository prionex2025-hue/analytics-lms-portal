import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FIELD = "h-11 rounded-lg bg-card pl-10 text-base sm:text-sm";
const ICON = "pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-secondary";
const TOGGLE =
  "absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-md text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50";
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
    <section className="grid min-h-screen place-items-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Button asChild variant="ghost" className="-ml-3 h-9 rounded-lg px-3 text-text-secondary">
            <Link to={loginPath}>
              <ArrowLeft className="size-4" />
              Back to login
            </Link>
          </Button>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          {portalLabel}
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-text-primary">
          {resetCompleted ? "Password reset successfully" : isResetMode ? "Set a new password" : "Reset your password"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          {resetCompleted
            ? "Your password has been updated and the reset link is now expired."
            : isResetMode
              ? "Choose a strong password for your account."
              : "Enter your account details and the portal will send password reset instructions if the account exists."}
        </p>

        {resetCompleted ? (
          <div className="mt-8 rounded-xl border border-success/30 bg-success/5 p-5" role="status">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                <CheckCircle2 className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-text-primary">Password reset successfully</p>
                <p className="mt-1 text-sm leading-6 text-text-secondary">
                  This reset link has expired and cannot be used again. Continue with your new password.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Button asChild className="h-11 rounded-lg font-semibold">
                <Link to={loginPath}>Continue to login</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-lg">
                <Link to={mainPath}>Open main portal</Link>
              </Button>
            </div>
          </div>
        ) : isResetMode ? (
          <form onSubmit={submitResetPassword} className="mt-8 space-y-5">
            <div>
              <label htmlFor="reset-new-password" className="mb-1.5 block text-sm font-medium text-text-primary">
                New password
              </label>
              <div className="relative">
                <KeyRound className={ICON} aria-hidden="true" />
                <Input
                  id="reset-new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className={`${FIELD} pr-11`}
                  placeholder="At least 8 characters"
                  required
                />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} className={TOGGLE} onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="reset-confirm-password" className="mb-1.5 block text-sm font-medium text-text-primary">
                Confirm password
              </label>
              <div className="relative">
                <KeyRound className={ICON} aria-hidden="true" />
                <Input
                  id="reset-confirm-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  aria-invalid={confirmPassword && confirmPassword !== password ? true : undefined}
                  className={`${FIELD} pr-11`}
                  placeholder="Re-enter the new password"
                  required
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                  className={TOGGLE}
                  onClick={() => setShowConfirmPassword((value) => !value)}
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}
            {successMessage ? (
              <p className="flex items-start gap-2 text-sm font-medium text-success" role="status">
                <CheckCircle2 className="mt-0.5 size-4" />
                <span>{successMessage}</span>
              </p>
            ) : null}

            <Button type="submit" className="h-11 w-full rounded-lg text-sm font-semibold" disabled={loading || Boolean(successMessage)}>
              {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              {loading ? "Resetting password..." : "Reset Password"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitForgotPassword} className="mt-8 space-y-5">
            <div>
              <label htmlFor="reset-identifier" className="mb-1.5 block text-sm font-medium text-text-primary">
                {identifierLabel}
              </label>
              <div className="relative">
                <Mail className={ICON} aria-hidden="true" />
                <Input
                  id="reset-identifier"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  type="text"
                  autoComplete="email"
                  className={FIELD}
                  placeholder={identifierPlaceholder}
                  required
                />
              </div>
            </div>

            {error ? (
              <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}
            {successMessage ? (
              <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-text-primary" role="status">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>{successMessage}</span>
                </div>
                {devResetUrl ? (
                  <Button asChild variant="link" className="mt-2 h-auto p-0">
                    <a href={devResetUrl}>Open reset link</a>
                  </Button>
                ) : null}
              </div>
            ) : null}

            <Button type="submit" className="h-11 w-full rounded-lg text-sm font-semibold" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              {loading ? "Sending instructions..." : "Send Reset Instructions"}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
