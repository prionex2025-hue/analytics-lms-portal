import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { superAdminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { SUPPORT_EMAIL, openSupportMail } from "@/lib/supportMail";
import { Info, KeyRound, LifeBuoy, MessageSquareText, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { Callout, DetailList, FormField, PageHeader, SettingsSection, StatusBadge } from "@/components/common/page-kit";
import { ui } from "@/styles/ui-tokens";

const FAQS = [
  { q: "How to reset a student password?", a: "Navigate to Student Management → Select Student → Reset Password." },
  { q: "How to publish exams?", a: "Create the exam, assign departments, then click publish in the exam panel." },
  { q: "How are audit logs maintained?", a: "Every admin action is securely tracked with timestamps and role-based visibility." },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    maxAttemptsDefault: 1,
    defaultViolationLimit: 3,
    globalRules: "{}",
  });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [feedback, setFeedback] = useState("");
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });

  const settingsQuery = useQuery({
    queryKey: ["superadmin-settings"],
    queryFn: superAdminApi.getSettings,
  });

  useEffect(() => {
    const settings = settingsQuery.data?.settings || settingsQuery.data || null;
    if (settings?.value || settings) {
      const value = settings.value ?? settings;
      setForm({
        maxAttemptsDefault: value.maxAttemptsDefault ?? 1,
        defaultViolationLimit: value.defaultViolationLimit ?? 3,
        globalRules: JSON.stringify(value.globalRules || {}, null, 2),
      });
    }
  }, [settingsQuery.data]);

  const updateMutation = useMutation({
    mutationFn: superAdminApi.updateSettings,
    onSuccess: () => {
      toast.success("Settings updated.");
      setBanner({
        type: "success",
        title: "Settings saved",
        message: "Global settings were updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["superadmin-settings"] });
    },
    onError: (error) => {
      setBanner({
        type: "error",
        title: "Save failed",
        message: error?.message || "Unable to update settings.",
      });
      toast.error(error?.message || "Failed to update settings.");
    },
  });

  const passwordMutation = useMutation({
    mutationFn: superAdminApi.changePassword,
    onSuccess: () => {
      toast.success("Password changed.");
      setBanner({ type: "success", title: "Password updated", message: "Your password has been changed." });
      setPasswordForm({ currentPassword: "", newPassword: "" });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Password change failed", message: error?.message || "Could not update password." });
      toast.error(error?.message || "Failed to change password.");
    },
  });

  const save = () => {
    try {
      updateMutation.mutate({
        maxAttemptsDefault: Number(form.maxAttemptsDefault),
        defaultViolationLimit: Number(form.defaultViolationLimit),
        globalRules: JSON.parse(form.globalRules || "{}"),
      });
    } catch {
      setBanner({
        type: "error",
        title: "Invalid JSON",
        message: "Global rules must be valid JSON.",
      });
    }
  };

  // The settings endpoint only returns platform defaults; identity comes from the signed-in session.
  const sessionSuperAdmin = useSelector((state) => state.superAdminAuth.superAdmin);
  const profile = settingsQuery.data?.profile || sessionSuperAdmin;

  const submitFeedback = () => {
    const message = feedback.trim();

    if (!message) {
      toast.error("Please write your feedback before opening mail.");
      return;
    }

    openSupportMail({
      category: "Super Admin feedback",
      subject: "LMS Super Admin Panel Feedback",
      message,
      reporter: {
        name: profile?.fullName || profile?.name,
        email: profile?.email,
        role: profile?.role || "Super Admin",
        id: profile?.employeeId,
        college: profile?.college?.name,
        department: profile?.department?.name,
      },
    });
  };

  const passwordError = (() => {
    if (!passwordForm.currentPassword && !passwordForm.newPassword) return "";
    if (passwordForm.newPassword.length < 8) return "New password must be at least 8 characters.";
    if (passwordForm.newPassword === passwordForm.currentPassword) return "New password must differ from current password.";
    return "";
  })();

  const bannerTone = banner.type === "error" ? "danger" : banner.type === "warning" ? "warning" : "success";

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Your account, platform-wide defaults, and support resources." />

      {banner.type ? (
        <Callout tone={bannerTone} title={banner.title}>
          {banner.message}
        </Callout>
      ) : null}

      <SettingsSection icon={UserRound} title="Admin profile" description="Read-only identity context used for scoped access and audit trails.">
        <DetailList
          columns={3}
          items={[
            { label: "Name", value: profile?.fullName || profile?.name || "-" },
            { label: "Email", value: profile?.email || "-" },
            { label: "Role", value: <StatusBadge tone="info">{String(profile?.role || "SUPER_ADMIN").replace(/_/g, " ")}</StatusBadge> },
            ...(profile?.lastLoginAt ? [{ label: "Last sign-in", value: new Date(profile.lastLoginAt).toLocaleString() }] : []),
          ]}
        />
      </SettingsSection>

      <SettingsSection icon={SlidersHorizontal} title="Global defaults" description="Default attempt limits and platform rules applied to new tests.">
        <form
          className="max-w-2xl space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Default attempts" htmlFor="max-attempts-default" hint="Attempts allowed per student by default.">
              <Input
                id="max-attempts-default"
                type="number"
                min={1}
                className={ui.field}
                value={form.maxAttemptsDefault}
                onChange={(event) => setForm((prev) => ({ ...prev, maxAttemptsDefault: event.target.value }))}
              />
            </FormField>
            <FormField label="Violation limit" htmlFor="default-violation-limit" hint="Proctoring violations before auto-submit.">
              <Input
                id="default-violation-limit"
                type="number"
                min={1}
                className={ui.field}
                value={form.defaultViolationLimit}
                onChange={(event) => setForm((prev) => ({ ...prev, defaultViolationLimit: event.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Global rules (JSON)" htmlFor="global-rules" hint="Must be valid JSON.">
            <Textarea
              id="global-rules"
              value={form.globalRules}
              onChange={(event) => setForm((prev) => ({ ...prev, globalRules: event.target.value }))}
              className="min-h-36 rounded-lg font-mono text-xs"
              spellCheck={false}
            />
          </FormField>
          <Button type="submit" className={ui.btn} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save Defaults"}
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection icon={KeyRound} title="Change password" description="Password updates take effect immediately and are audited.">
        <form
          className="grid max-w-2xl gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!passwordForm.currentPassword || !passwordForm.newPassword || passwordError || passwordMutation.isPending) return;
            passwordMutation.mutate(passwordForm);
          }}
        >
          <FormField label="Current password" htmlFor="super-current-password">
            <Input
              id="super-current-password"
              type="password"
              autoComplete="current-password"
              className={ui.field}
              value={passwordForm.currentPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
            />
          </FormField>
          <FormField label="New password" htmlFor="super-new-password" error={passwordError || undefined}>
            <Input
              id="super-new-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={passwordError ? true : undefined}
              className={ui.field}
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
            />
          </FormField>
          <div className="sm:col-span-2">
            <Button
              type="submit"
              className={ui.btn}
              disabled={!passwordForm.currentPassword || !passwordForm.newPassword || Boolean(passwordError) || passwordMutation.isPending}
            >
              {passwordMutation.isPending ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection icon={ShieldCheck} title="Security" description="Additional account protection options.">
        <ul className="max-w-2xl divide-y divide-border rounded-lg border border-border">
          {[
            { title: "Two Factor Authentication", text: "Add extra protection to admin accounts." },
            { title: "Login Alerts", text: "Receive alerts for suspicious logins." },
          ].map((item) => (
            <li key={item.title} className="flex items-center justify-between gap-3 p-3.5">
              <div>
                <p className="text-sm font-medium text-text-primary">{item.title}</p>
                <p className="text-xs text-text-secondary">{item.text}</p>
              </div>
              <StatusBadge tone="neutral">Not yet available</StatusBadge>
            </li>
          ))}
        </ul>
      </SettingsSection>

      <SettingsSection icon={MessageSquareText} title="Feedback & suggestions" description="Share platform issues, UI improvements, feature requests, and suggestions.">
        <form
          className="max-w-2xl space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitFeedback();
          }}
        >
          <FormField label="Your feedback" htmlFor="super-feedback">
            <Textarea
              id="super-feedback"
              placeholder="Write your feedback here..."
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              className="min-h-32 rounded-lg"
            />
          </FormField>
          <Button type="submit" variant="outline" className={ui.btn}>Submit Feedback</Button>
        </form>
      </SettingsSection>

      <SettingsSection icon={LifeBuoy} title="Help & support" description="Technical support contacts and quick answers.">
        <div className="max-w-2xl space-y-5">
          <DetailList
            items={[
              { label: "Support email", value: <a className="text-primary hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> },
              { label: "Emergency contact", value: <a className="text-primary hover:underline" href="tel:+919025895743">+91 9025895743</a> },
              { label: "Working hours", value: "Mon - Sat | 9:00 AM - 5:00 PM" },
              { label: "Version", value: "LMS v2.4.1" },
            ]}
          />
          <div>
            <p className="mb-2 text-sm font-medium text-text-primary">Frequently asked questions</p>
            <div className="divide-y divide-border rounded-lg border border-border">
              {FAQS.map((item) => (
                <details key={item.q} className="group px-3.5 py-3">
                  <summary className="cursor-pointer list-none text-sm font-medium text-text-primary marker:hidden">
                    <span className="flex items-center justify-between gap-3">
                      {item.q}
                      <span className="text-text-secondary transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                    </span>
                  </summary>
                  <p className="mt-2 text-sm text-text-secondary">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={Info} title="About platform" description="Platform credits, build details, and system information.">
        <div className="max-w-2xl space-y-2 text-sm text-text-secondary">
          <p>AI-powered Learning Management System for colleges and institutions.</p>
          <p>Built with scalable architecture, role-based access, audit logging, secure examination workflows, and analytics dashboards.</p>
          <p className="pt-2 text-text-primary">
            <span className="font-semibold">Built by Prionex</span>
            <span className="text-text-secondary"> · Empowering educational institutions with secure digital infrastructure.</span>
          </p>
        </div>
      </SettingsSection>
    </div>
  );
}
