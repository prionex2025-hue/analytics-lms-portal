import { useMemo, useState } from "react";
import { Check, Circle, Eye, EyeOff, Loader2, LockKeyhole, Mail, MessageSquareText, ShieldAlert } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { studentApi } from "@/services/studentApi";
import { profileQueryOptions } from "@/services/studentQueries";
import { openSupportMail } from "@/lib/supportMail";
import { FieldLabel, PageHeader, SettingsSection } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

function PasswordField({ id, label, value, onChange, autoComplete, invalid }) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          aria-invalid={invalid || undefined}
          className={cn(ui.field, "pr-11")}
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-md text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function Requirement({ met, children }) {
  return (
    <li className={cn("flex items-center gap-2 text-sm", met ? "text-success" : "text-text-secondary")}>
      {met ? <Check className="size-4" aria-hidden="true" /> : <Circle className="size-3.5" aria-hidden="true" />}
      <span>{children}</span>
      <span className="sr-only">{met ? "(met)" : "(not met)"}</span>
    </li>
  );
}

export default function SettingsPage() {
  const profileQuery = useQuery(profileQueryOptions());
  const user = profileQuery.data;

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [feedback, setFeedback] = useState("");
  const [complaint, setComplaint] = useState("");
  const [inlineError, setInlineError] = useState("");

  const passwordValidationError = useMemo(() => {
    if (!passwordForm.currentPassword && !passwordForm.newPassword && !passwordForm.confirmPassword) {
      return "";
    }

    if (passwordForm.newPassword.length < 8) {
      return "New password must be at least 8 characters.";
    }

    if (passwordForm.newPassword === passwordForm.currentPassword) {
      return "New password must be different from current password.";
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      return "Password confirmation does not match.";
    }

    return "";
  }, [passwordForm]);

  const updatePasswordMutation = useMutation({
    mutationFn: () =>
      studentApi.changeMyPassword({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
      }),
    onSuccess: () => {
      setInlineError("");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("Password updated successfully.");
    },
    onError: (error) => {
      if (error?.code === "WRONG_CURRENT_PASSWORD") {
        setInlineError("Current password is incorrect.");
        return;
      }
      setInlineError("");
      toast.error(error?.message || "Unable to update password.");
    },
  });

  const updatePassword = () => {
    setInlineError("");
    if (passwordValidationError) {
      setInlineError(passwordValidationError);
      return;
    }

    updatePasswordMutation.mutate();
  };

  const openStudentMail = (type) => {
    const isComplaint = type === "complaint";
    const message = (isComplaint ? complaint : feedback).trim();

    if (!message) {
      toast.error(`Please write your ${isComplaint ? "complaint" : "feedback"} before opening mail.`);
      return;
    }

    openSupportMail({
      category: isComplaint ? "Student complaint" : "Student feedback",
      subject: isComplaint ? "LMS Student Complaint" : "LMS Student Feedback",
      message,
      reporter: {
        name: user?.fullName || user?.name,
        email: user?.email,
        role: "Student",
        id: user?.rollNumber || user?.studentId,
        college: user?.college?.name || user?.college,
        department: user?.department?.name || user?.department,
      },
    });
  };

  const hasNewPassword = passwordForm.newPassword.length > 0;
  const requirements = [
    { met: passwordForm.newPassword.length >= 8, label: "At least 8 characters" },
    { met: hasNewPassword && passwordForm.newPassword !== passwordForm.currentPassword, label: "Different from current password" },
    { met: hasNewPassword && passwordForm.newPassword === passwordForm.confirmPassword, label: "Confirmation matches" },
  ];
  const canSubmitPassword = Boolean(passwordForm.currentPassword) && hasNewPassword && !updatePasswordMutation.isPending;

  return (
    <section className={ui.pageSection}>
      <PageHeader title="Settings" description="Manage your password and how you reach support." />

      <SettingsSection
        icon={LockKeyhole}
        title="Change password"
        description="Use a strong password you don't reuse elsewhere. Adding numbers and symbols makes it harder to guess."
      >
        <form
          className="grid max-w-lg gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            updatePassword();
          }}
          noValidate
        >
          <PasswordField
            id="current-password"
            label="Current password"
            autoComplete="current-password"
            value={passwordForm.currentPassword}
            invalid={inlineError === "Current password is incorrect."}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
          />
          <PasswordField
            id="new-password"
            label="New password"
            autoComplete="new-password"
            value={passwordForm.newPassword}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
          />
          <PasswordField
            id="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            value={passwordForm.confirmPassword}
            invalid={Boolean(passwordForm.confirmPassword) && passwordForm.confirmPassword !== passwordForm.newPassword}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
          />

          <ul className="grid gap-1.5 rounded-lg bg-muted/50 p-3" aria-label="Password requirements">
            {requirements.map((item) => (
              <Requirement key={item.label} met={item.met}>{item.label}</Requirement>
            ))}
          </ul>

          {inlineError ? (
            <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
              <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
              {inlineError}
            </p>
          ) : null}

          <div>
            <Button type="submit" className={ui.btn} disabled={!canSubmitPassword}>
              {updatePasswordMutation.isPending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              {updatePasswordMutation.isPending ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection
        icon={MessageSquareText}
        title="Feedback & support"
        description="Your message opens in your email app, pre-filled with your student details so the team can help faster."
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="flex flex-col gap-3">
            <FieldLabel htmlFor="student-feedback" hint={`${feedback.length} chars`}>Feedback</FieldLabel>
            <Textarea
              id="student-feedback"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="What's working well, or what could be better?"
              className="-mt-1.5 min-h-32 rounded-lg bg-card"
            />
            <div>
              <Button type="button" variant="outline" className={ui.btn} onClick={() => openStudentMail("feedback")}>
                <Mail className="size-4" />
                Send Feedback
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <FieldLabel htmlFor="student-complaint" hint={`${complaint.length} chars`}>Raise a complaint</FieldLabel>
            <Textarea
              id="student-complaint"
              value={complaint}
              onChange={(event) => setComplaint(event.target.value)}
              placeholder="Describe the issue, including the test or page if relevant."
              className="-mt-1.5 min-h-32 rounded-lg bg-card"
            />
            <div>
              <Button type="button" variant="outline" className={ui.btn} onClick={() => openStudentMail("complaint")}>
                <Mail className="size-4" />
                Raise Complaint
              </Button>
            </div>
          </div>
        </div>
      </SettingsSection>
    </section>
  );
}
