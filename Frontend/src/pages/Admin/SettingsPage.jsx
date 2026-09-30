import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORT_EMAIL, openSupportMail } from "@/lib/supportMail";
import { Info, KeyRound, LifeBuoy, MessageSquareText, ShieldCheck, UserRound } from "lucide-react";
import { Callout, DetailList, FormField, PageHeader, SettingsSection, StatusBadge } from "@/components/common/page-kit";
import { ui } from "@/styles/ui-tokens";

const FAQS = [
  { q: "How to reset a student password?", a: "Navigate to Student Management → Select Student → Reset Password." },
  { q: "How to publish exams?", a: "Create the exam, assign departments, then click publish in the exam panel." },
  { q: "How are audit logs maintained?", a: "Every admin action is securely tracked with timestamps and role-based visibility." },
];


export default function AdminSettingsPage() {
  const authenticatedAdmin = useAdminAuthState()?.admin;
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
  });
  const [feedback, setFeedback] = useState("");
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });

  const settingsQuery = useQuery({
    queryKey: ["admin-settings"],
    queryFn: adminApi.getSettings,
  });

  const passwordMutation = useMutation({
    mutationFn: adminApi.changePassword,
    onSuccess: () => {
      toast.success("Password changed.");
      setBanner({
        type: "success",
        title: "Password updated",
        message: "Your admin password has been changed.",
      });
      setPasswordForm({ currentPassword: "", newPassword: "" });
    },
    onError: (error) => {
      setBanner({
        type: "error",
        title: "Password change failed",
        message: error?.message || "Could not update password.",
      });
      toast.error(error?.message || "Failed to change password.");
    },
  });

  const profile = settingsQuery.data?.profile || settingsQuery.data?.admin || authenticatedAdmin;

  const submitFeedback = () => {
    const message = feedback.trim();

    if (!message) {
      toast.error("Please write your feedback before opening mail.");
      return;
    }

    openSupportMail({
      category: "Admin feedback",
      subject: "LMS Admin Panel Feedback",
      message,
      reporter: {
        name: profile?.fullName,
        email: profile?.email,
        role: profile?.role || "Admin",
        id: profile?.employeeId,
        college: profile?.college?.name,
        department: profile?.department?.name,
      },
    });
  };

  const passwordError = (() => {
    if (!passwordForm.currentPassword && !passwordForm.newPassword) return "";
    if (passwordForm.newPassword.length < 8)
      return "New password must be at least 8 characters.";
    if (passwordForm.newPassword === passwordForm.currentPassword)
      return "New password must differ from current password.";
    return "";
  })();

  const bannerTone = banner.type === "error" ? "danger" : banner.type === "warning" ? "warning" : "success";

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Your account, security, and support resources." />

      {banner.type ? (
        <Callout tone={bannerTone} title={banner.title}>
          {banner.message}
        </Callout>
      ) : null}

      {settingsQuery.isError ? (
        <Callout tone="warning" title="Profile fetch failed">
          {settingsQuery.error?.message || "Could not load the latest admin profile. Showing saved session details where available."}
        </Callout>
      ) : null}

      <SettingsSection icon={UserRound} title="Admin profile" description="Read-only identity context used for scoped access and audit trails.">
        {settingsQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : (
          <DetailList
            columns={3}
            items={[
              { label: "Name", value: profile?.fullName || "-" },
              { label: "Email", value: profile?.email || "-" },
              { label: "Employee ID", value: profile?.employeeId || "-" },
              { label: "Role", value: profile?.role ? <StatusBadge tone="info">{profile.role}</StatusBadge> : "-" },
              { label: "College", value: profile?.college?.name || "-" },
              { label: "Department", value: profile?.department?.name || "-" },
            ]}
          />
        )}
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
          <FormField label="Current password" htmlFor="admin-current-password">
            <Input
              id="admin-current-password"
              type="password"
              autoComplete="current-password"
              className={ui.field}
              value={passwordForm.currentPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
            />
          </FormField>
          <FormField label="New password" htmlFor="admin-new-password" error={passwordError || undefined}>
            <Input
              id="admin-new-password"
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
          <FormField label="Your feedback" htmlFor="admin-feedback">
            <Textarea
              id="admin-feedback"
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
