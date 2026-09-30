import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CalendarClock, Clock3, FileText, Loader2, PlayCircle, Repeat, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { testAccessQueryOptions } from "@/services/studentQueries";
import { studentApi } from "@/services/studentApi";
import { Callout, LoadingState, StatusBadge } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

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
    return <LoadingState fullScreen label="Loading test instructions..." />;
  }

  if (accessQuery.isError) {
    return (
      <section className="grid min-h-screen place-items-center bg-background p-4">
        <div role="alert" className={cn(ui.card, "w-full max-w-md p-6 text-center sm:p-8")}>
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-text-primary">Unable to open test link</h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            {accessQuery.error?.message || "This link is invalid, expired, or not assigned to your account."}
          </p>
          <Button className={cn(ui.btn, "mt-6")} variant="outline" onClick={() => navigate("/tests/ongoing", { replace: true })}>
            <ArrowLeft className="size-4" />
            Back to Tests
          </Button>
        </div>
      </section>
    );
  }

  const blockedReason = test?.blockedReason;
  const canStart = Boolean(test?.canStart);
  const hasActiveAttempt = Boolean(test?.hasActiveAttempt && test?.activeSubmissionId);

  const facts = [
    { icon: CalendarClock, label: "Window", value: formatDateTime(test?.startsAt), sub: `to ${formatDateTime(test?.endsAt)}` },
    { icon: Clock3, label: "Duration", value: `${test?.durationMins || 0} minutes` },
    { icon: FileText, label: "Questions / Marks", value: `${test?.questionCount || 0} / ${test?.totalMarks || 0}` },
    { icon: Repeat, label: "Attempts", value: `${test?.attemptsUsed || 0}/${test?.attemptsAllowed || 1} used` },
  ];

  return (
    <section className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <Button variant="ghost" className="-ml-2 h-9 rounded-lg px-2.5 text-text-secondary" onClick={() => navigate("/tests/ongoing")}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <span className="truncate text-sm font-medium text-text-primary">Test instructions</span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 pb-40 sm:px-6 sm:py-8 sm:pb-40">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">{test?.subject || "Test"}</StatusBadge>
            {hasActiveAttempt ? <StatusBadge tone="success" icon={RotateCcw}>Active attempt found</StatusBadge> : null}
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">{test?.title || "Test Instructions"}</h1>
          {test?.description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">{test.description}</p> : null}
        </div>

        <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="flex gap-3 bg-card p-4">
              <fact.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-xs text-text-secondary">{fact.label}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-text-primary">{fact.value}</dd>
                {fact.sub ? <dd className="text-xs text-text-secondary">{fact.sub}</dd> : null}
              </div>
            </div>
          ))}
        </dl>

        <div className={cn(ui.card, ui.cardPaddingLg)}>
          <h2 className={ui.titleLg}>Instructions</h2>
          {instructions.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary">No special instructions for this test.</p>
          ) : (
            <ol className="mt-4 space-y-3">
              {instructions.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-3 text-sm leading-6 text-text-primary">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
                    {index + 1}
                  </span>
                  <p className="pt-px">{item}</p>
                </li>
              ))}
            </ol>
          )}
        </div>

        {blockedReason ? (
          <Callout tone="warning" icon={AlertTriangle} title="You can't start this test right now">
            {blockedCopy[blockedReason] || "This test cannot be started right now."}
          </Callout>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <label className={cn("flex items-start gap-3", canStart ? "cursor-pointer" : "cursor-not-allowed opacity-60")}>
            <Checkbox className="mt-0.5 size-5" checked={agreed} onCheckedChange={(value) => setAgreed(Boolean(value))} disabled={!canStart} />
            <span className="text-sm leading-6 text-text-primary">
              I have read the test details and instructions, and I agree to follow them before starting the exam.
            </span>
          </label>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" className={cn(ui.btn, "flex-1 sm:flex-none")} onClick={() => navigate("/tests/ongoing")}>Not Now</Button>
            <Button
              type="button"
              className={cn(ui.btn, "flex-1 sm:flex-none")}
              disabled={!canStart || !agreed || startMutation.isPending}
              onClick={() => startMutation.mutate()}
            >
              {startMutation.isPending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <PlayCircle className="size-4" />}
              {startMutation.isPending ? "Starting..." : hasActiveAttempt ? "Resume Exam" : "Agree and Start Exam"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
