import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, FileText, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { testAccessQueryOptions } from "@/services/studentQueries";
import { studentApi } from "@/services/studentApi";

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const splitInstructions = (value) =>
  String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const blockedCopy = {
  TEST_NOT_AVAILABLE: "This test is not available for students.",
  TEST_NOT_STARTED: "This test has not started yet.",
  TEST_ENDED: "This test window has ended.",
  MAX_ATTEMPTS_REACHED: "You have used all allowed attempts for this test.",
};

export default function TestInstructionsPage() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);

  const accessQuery = useQuery(testAccessQueryOptions(testId));
  const test = accessQuery.data?.test || null;

  const instructions = useMemo(() => splitInstructions(test?.instructions), [test?.instructions]);

  const startMutation = useMutation({
    mutationFn: async () => {
      await studentApi.agreeToTestInstructions(testId);
      return studentApi.startAttempt({ test_id: testId });
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ["student", "attempts", "active"] });
      const attemptId = payload?.attempt_id || payload?.attemptId || payload?.submission?.id;
      if (!attemptId) {
        toast.error("Attempt started, but the attempt id was missing. Please use Resume.");
        navigate("/resume", { replace: true });
        return;
      }
      navigate(`/test/${attemptId}`, { replace: true });
    },
    onError: (error) => {
      if (error?.code === "TEST_INSTRUCTIONS_AGREEMENT_REQUIRED") {
        toast.error("Please confirm the instruction agreement before starting.");
        return;
      }
      toast.error(error?.message || "Unable to start this test.");
      queryClient.invalidateQueries({ queryKey: ["student", "tests", "access", testId] });
    },
  });

  if (accessQuery.isLoading) {
    return <div className="grid min-h-screen place-items-center text-text-secondary">Loading test instructions...</div>;
  }

  if (accessQuery.isError) {
    return (
      <section className="grid min-h-screen place-items-center bg-muted p-4">
        <Card className="w-full max-w-xl rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-danger">
            <AlertTriangle className="size-5" />
            <h1 className="text-lg font-semibold">Unable to open test link</h1>
          </div>
          <p className="mt-3 text-sm text-text-secondary">
            {accessQuery.error?.message || "This link is invalid, expired, or not assigned to your account."}
          </p>
          <Button className="mt-5" variant="outline" onClick={() => navigate("/tests/ongoing", { replace: true })}>
            Back to Tests
          </Button>
        </Card>
      </section>
    );
  }

  const blockedReason = test?.blockedReason;
  const canStart = Boolean(test?.canStart);
  const hasActiveAttempt = Boolean(test?.hasActiveAttempt && test?.activeSubmissionId);

  return (
    <section className="min-h-screen bg-muted px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <Card className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="bg-primary/10 text-primary-dark">
                  {test?.subject || "Test"}
                </Badge>
                {hasActiveAttempt ? (
                  <Badge variant="secondary" className="bg-success/10 text-success">Active attempt found</Badge>
                ) : null}
              </div>
              <h1 className="mt-3 text-2xl font-semibold text-text-primary sm:text-3xl">{test?.title || "Test Instructions"}</h1>
              {test?.description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">{test.description}</p> : null}
            </div>
            <Button variant="outline" onClick={() => navigate("/tests/ongoing")}>Back</Button>
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="rounded-lg border border-border bg-card p-4">
            <CalendarClock className="size-5 text-primary" />
            <p className="mt-2 text-xs text-text-secondary">Window</p>
            <p className="mt-1 text-sm font-semibold text-text-primary">{formatDateTime(test?.startsAt)}</p>
            <p className="text-xs text-text-secondary">to {formatDateTime(test?.endsAt)}</p>
          </Card>
          <Card className="rounded-lg border border-border bg-card p-4">
            <Clock3 className="size-5 text-primary" />
            <p className="mt-2 text-xs text-text-secondary">Duration</p>
            <p className="mt-1 text-sm font-semibold text-text-primary">{test?.durationMins || 0} minutes</p>
          </Card>
          <Card className="rounded-lg border border-border bg-card p-4">
            <FileText className="size-5 text-primary" />
            <p className="mt-2 text-xs text-text-secondary">Questions / Marks</p>
            <p className="mt-1 text-sm font-semibold text-text-primary">{test?.questionCount || 0} / {test?.totalMarks || 0}</p>
          </Card>
          <Card className="rounded-lg border border-border bg-card p-4">
            <ShieldCheck className="size-5 text-primary" />
            <p className="mt-2 text-xs text-text-secondary">Attempts</p>
            <p className="mt-1 text-sm font-semibold text-text-primary">
              {test?.attemptsUsed || 0}/{test?.attemptsAllowed || 1} used
            </p>
          </Card>
        </div>

        <Card className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-text-primary">Instructions</h2>
          <div className="mt-4 space-y-3">
            {instructions.map((item, index) => (
              <div key={`${item}-${index}`} className="flex gap-3 rounded-lg bg-background px-3 py-3 text-sm text-text-secondary">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                <p>{item}</p>
              </div>
            ))}
          </div>
        </Card>

        {blockedReason ? (
          <Card className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            {blockedCopy[blockedReason] || "This test cannot be started right now."}
          </Card>
        ) : null}

        <Card className="rounded-xl border border-border bg-card p-5">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox checked={agreed} onCheckedChange={(value) => setAgreed(Boolean(value))} disabled={!canStart} />
            <span className="text-sm leading-6 text-text-secondary">
              I have read the test details and instructions, and I agree to follow them before starting the exam.
            </span>
          </label>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => navigate("/tests/ongoing")}>Not Now</Button>
            <Button
              type="button"
              disabled={!canStart || !agreed || startMutation.isPending}
              onClick={() => startMutation.mutate()}
            >
              {startMutation.isPending ? "Starting..." : hasActiveAttempt ? "Resume Exam" : "Agree and Start Exam"}
            </Button>
          </div>
        </Card>
      </div>
    </section>
  );
}
