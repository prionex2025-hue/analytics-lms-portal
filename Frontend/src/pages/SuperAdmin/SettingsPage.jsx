import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { superAdminApi } from "@/services/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { SUPPORT_EMAIL, openSupportMail } from "@/lib/supportMail";

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

  const profile = settingsQuery.data?.profile;

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
        name: profile?.fullName,
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

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      {settingsQuery.isLoading ? (
        <Card className="rounded-2xl border-border">
          <CardContent className="space-y-3 p-6">
            <SkeletonBlock className="h-8" />
            <SkeletonBlock className="h-12" />
            <SkeletonBlock className="h-12" />
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Admin Profile</CardTitle>
          <CardDescription>
            Read-only identity context used for scoped access and audit trails.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <p className="text-sm text-text-secondary">
            <span className="font-semibold">Name:</span>{" "}
            {profile?.fullName || "-"}
          </p>
          <p className="text-sm text-text-secondary">
            <span className="font-semibold">Email:</span>{" "}
            {profile?.email || "-"}
          </p>
          <p className="text-sm text-text-secondary">
            <span className="font-semibold">Employee ID:</span>{" "}
            {profile?.employeeId || "-"}
          </p>
          <p className="text-sm text-text-secondary">
            <span className="font-semibold">Role:</span> {profile?.role || "-"}
          </p>
          <p className="text-sm text-text-secondary">
            <span className="font-semibold">College:</span>{" "}
            {profile?.college?.name || "-"}
          </p>
          <p className="text-sm text-text-secondary">
            <span className="font-semibold">Department:</span>{" "}
            {profile?.department?.name || "-"}
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Global Defaults</CardTitle>
          <CardDescription>Default attempt limits and platform rules for new tests.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="max-attempts-default" className="text-sm font-medium text-text-secondary">Default Attempts</label>
              <Input
                id="max-attempts-default"
                type="number"
                min={1}
                value={form.maxAttemptsDefault}
                onChange={(event) => setForm((prev) => ({ ...prev, maxAttemptsDefault: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="default-violation-limit" className="text-sm font-medium text-text-secondary">Violation Limit</label>
              <Input
                id="default-violation-limit"
                type="number"
                min={1}
                value={form.defaultViolationLimit}
                onChange={(event) => setForm((prev) => ({ ...prev, defaultViolationLimit: event.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="global-rules" className="text-sm font-medium text-text-secondary">Global Rules JSON</label>
            <Textarea
              id="global-rules"
              value={form.globalRules}
              onChange={(event) => setForm((prev) => ({ ...prev, globalRules: event.target.value }))}
              className="min-h-36 font-mono text-xs"
            />
          </div>
          <Button type="button" onClick={save} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save Defaults"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>Password updates are immediately audited.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Input
            type="password"
            placeholder="Current password"
            value={passwordForm.currentPassword}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
          />
          <Input
            type="password"
            placeholder="New password"
            value={passwordForm.newPassword}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
          />
          <Button
            type="button"
            onClick={() => passwordMutation.mutate(passwordForm)}
            disabled={!passwordForm.currentPassword || !passwordForm.newPassword || Boolean(passwordError) || passwordMutation.isPending}
          >
            {passwordMutation.isPending ? "Updating..." : "Update Password"}
          </Button>
          {passwordError ? <p className="sm:col-span-3 text-xs text-danger">{passwordError}</p> : null}
        </CardContent>
      </Card>

      
      <div className="grid gap-6 lg:grid-cols-2">
        {/* FAQ Card */}
        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>Frequently Asked Questions</CardTitle>
            <CardDescription>
              Common platform usage questions and quick guidance for
              administrators.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="border-b border-border pb-3">
              <h4 className="text-sm font-semibold">
                How to reset a student password?
              </h4>
              <p className="text-sm text-text-secondary mt-1">
                Navigate to Student Management → Select Student → Reset
                Password.
              </p>
            </div>

            <div className="border-b border-border pb-3">
              <h4 className="text-sm font-semibold">How to publish exams?</h4>
              <p className="text-sm text-text-secondary mt-1">
                Create the exam, assign departments, then click publish in the
                exam panel.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold">
                How are audit logs maintained?
              </h4>
              <p className="text-sm text-text-secondary mt-1">
                Every admin action is securely tracked with timestamps and
                role-based visibility.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Feedback Card */}
        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>Feedback & Suggestions</CardTitle>
            <CardDescription>
              Share platform issues, UI improvements, feature requests, and
              suggestions.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <textarea
              placeholder="Write your feedback here..."
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              className="min-h-[120px] w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={submitFeedback}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Submit Feedback
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Support & Contact */}
        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>Support & Contact</CardTitle>
            <CardDescription>
              Technical support and escalation contacts for the LMS platform.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-3">
            <p className="text-sm text-text-secondary">
              <span className="font-semibold">Support Email:</span>{" "}
              {SUPPORT_EMAIL}
            </p>

            <p className="text-sm text-text-secondary">
              <span className="font-semibold">Emergency Contact:</span> +91
             9025895743
            </p>

            <p className="text-sm text-text-secondary">
              <span className="font-semibold">Working Hours:</span> Mon - Sat |
              9:00 AM - 5:00 PM
            </p>

            <p className="text-sm text-text-secondary">
              <span className="font-semibold">Version:</span> LMS v2.4.1
            </p>
          </CardContent>
        </Card>

        {/* Security Settings */}
        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>Security Settings</CardTitle>
            <CardDescription>
              Configure account protection and authentication preferences.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <div>
                <h4 className="text-sm font-semibold">
                  Two Factor Authentication
                </h4>
                <p className="text-xs text-text-secondary">
                  Add extra protection to admin accounts.
                </p>
              </div>

              <button className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white">
                Enable
              </button>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <div>
                <h4 className="text-sm font-semibold">Login Alerts</h4>
                <p className="text-xs text-text-secondary">
                  Receive alerts for suspicious logins.
                </p>
              </div>

              <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium">
                Enabled
              </button>
            </div>
          </CardContent>
        </Card>

        {/* About Platform */}
        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>About Platform</CardTitle>
            <CardDescription>
              Platform credits, build details, and system information.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <p className="text-sm text-text-secondary">
              AI-powered Learning Management System for colleges and
              institutions.
            </p>

            <p className="text-sm text-text-secondary">
              Built with scalable architecture, role-based access, audit
              logging, secure examination workflows, and analytics dashboards.
            </p>

            <div className="rounded-xl border border-border p-3">
              <p className="text-sm font-semibold">Built by Prionex</p>
              <p className="text-xs text-text-secondary mt-1">
                Empowering educational institutions with secure digital
                infrastructure.
              </p>
            </div>
          </CardContent>
        </Card>
        
      </div>
    </div>
  );
}
