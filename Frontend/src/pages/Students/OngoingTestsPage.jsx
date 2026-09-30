import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { BookOpen, CalendarClock, CheckCircle2, ClipboardCheck, Clock3, Eye, Lock, PlayCircle, Target, Timer, Users } from "lucide-react";
import { activeAttemptsQueryOptions, reportsQueryOptions } from "@/services/studentQueries";
import { studentApi } from "@/services/studentApi";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TestListSkeleton } from "@/components/common/page-skeletons";
import { EmptyState, MetaItem, PageHeader, SectionHeader, StatusBadge } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

const remainingTone = (ms) => {
  if (ms <= 60 * 1000) return "danger";
  if (ms <= 5 * 60 * 1000) return "warning";
  return "info";
};

const formatShortDateTime = (value) =>
  new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const pickId = (item) => item?.id || item?.test_id || item?.testId;

const computeAnswered = (test, totalQuestions) => {
  if (Number.isFinite(test?.answeredCount)) {
    return Number(test.answeredCount);
  }

  if (Array.isArray(test?.answers)) {
    return test.answers.length;
  }

  if (totalQuestions > 0 && Number.isFinite(test?.progress)) {
    return Math.round((Number(test.progress) / 100) * totalQuestions);
  }

  return 0;
};

const useServerNowRaf = (serverTime) => {
  const [now, setNow] = useState(serverTime || Date.now());
  const frameRef = useRef(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    const safeServerTime = serverTime || Date.now();
    offsetRef.current = safeServerTime - Date.now();

    const update = () => {
      setNow(Date.now() + offsetRef.current);
      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [serverTime]);

  return now;
};

const formatRemaining = (ms) => {
  if (ms <= 0) {
    return "Auto-submitted";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
};

const getAssignedDepartments = (test) => {
  const ids = Array.isArray(test?.assignedTo) ? test.assignedTo : [];
  return [...new Set(ids.filter(Boolean).map((id) => String(id)))];
};

export default function OngoingTestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [continueTarget, setContinueTarget] = useState(null);
  const backgroundSubmittedRef = useRef(new Set());

  const { data, isLoading, isFetched } = useQuery({
    ...activeAttemptsQueryOptions(),
    refetchInterval: 15 * 1000,
  });
  const reportsQuery = useQuery({
    ...reportsQueryOptions({ view: "overall" }),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 15 * 1000,
  });
  const now = useServerNowRaf(data?.serverTime);

  const submitMutation = useMutation({
    mutationFn: studentApi.submitAttempt,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["student", "attempts", "active"] });
    },
  });

  const attempts = useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((test) => {
      const totalQuestions = Number(test?.totalQuestions || test?.questions?.length || 0);
      const answered = computeAnswered(test, totalQuestions);
      const progress = totalQuestions > 0 ? Math.round((answered / totalQuestions) * 100) : Number(test?.progress || 0);
      const endTime = new Date(test?.server_end_time || test?.endsAt || test?.endTime || 0).getTime();
      const remainingMs = endTime - now;
      const id = pickId(test);

      return {
        ...test,
        id,
        totalQuestions,
        answered,
        progress: Number.isFinite(progress) ? progress : 0,
        endTime,
        remainingMs,
        autoSubmitted: remainingMs <= 0,
        canTryAgain: Boolean(test?.canTryAgain),
        isCompleted: Boolean(test?.isCompleted),
        attemptsUsed: Number(test?.attemptsUsed || 0),
        attemptsAllowed: Number(test?.attemptsAllowed || 1),
        attemptsRemaining: Number(test?.attemptsRemaining || 0),
      };
    });
  }, [data, now]);

  const completedTests = useMemo(() => {
    const rows = reportsQuery.data?.testWise || reportsQuery.data?.test_wise || [];
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows.map((row) => {
      const submissionId = row?.submissionId || row?.submission_id || null;
      const testId = row?.testId || row?.test_id || null;

      return {
        submissionId,
        testId,
        title: row?.testName || row?.test_name || row?.title || "Untitled Test",
        subject: row?.subject || "-",
        score: Number(row?.score || 0),
        accuracy: Number(row?.accuracy || 0),
        submittedAt: row?.submittedAt || row?.submitted_at || null,
        endDate: row?.endDate || row?.end_date || null,
        testStatus: row?.testStatus || row?.test_status || row?.test?.status || row?.test?.test_status || row?.status || null,
        isTestCompleted: Boolean(row?.isTestCompleted || row?.is_test_completed || row?.test?.isCompleted || row?.test?.is_completed),
      };
    });
  }, [reportsQuery.data]);

  useEffect(() => {
    attempts.forEach((attempt) => {
      if (!attempt.autoSubmitted || !attempt?.submissionId || !attempt?.id || attempt.isCompleted || attempt.canTryAgain) {
        return;
      }

      const cacheKey = `${attempt.id}:${attempt.submissionId}`;
      if (backgroundSubmittedRef.current.has(cacheKey)) {
        return;
      }

      backgroundSubmittedRef.current.add(cacheKey);
      submitMutation.mutate({ attemptId: attempt.submissionId, testId: attempt.id, reason: "time_expired" });
    });
  }, [attempts, submitMutation]);

  if (!isFetched && isLoading) {
    return <TestListSkeleton />;
  }

  const liveCount = attempts.filter((test) => !test.autoSubmitted && !test.isCompleted).length;

  return (
    <section className={ui.pageSection}>
      <PageHeader
        title="Ongoing tests"
        description="Tests that are open right now. Your answers are saved automatically while you work."
      />

      <div className="space-y-3">
        <SectionHeader title="Active now" count={liveCount} />

        {attempts.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No active tests right now"
            description="You're all clear. When a test opens, it will appear here."
            action={
              <Button variant="outline" className={ui.btn} onClick={() => navigate("/tests/upcoming")}>
                <CalendarClock className="size-4" />
                View upcoming tests
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {attempts.map((test) => {
              const departments = getAssignedDepartments(test).length;
              const isOpen = !test.autoSubmitted && !test.isCompleted;

              return (
                <li key={test.id} className={cn(ui.card, "p-4 sm:p-5", isOpen ? "" : "bg-muted/30")}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {isOpen ? (
                          <StatusBadge tone="success">
                            <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
                            Live
                          </StatusBadge>
                        ) : null}
                        {test.autoSubmitted ? <StatusBadge tone="warning">Auto-submitted</StatusBadge> : null}
                        {test.isCompleted ? <StatusBadge tone="success" icon={CheckCircle2}>Completed</StatusBadge> : null}
                        {test.canTryAgain ? (
                          <StatusBadge tone="info">Try again ({test.attemptsUsed}/{test.attemptsAllowed})</StatusBadge>
                        ) : null}
                      </div>
                      <h3 className="mt-2 truncate text-base font-semibold text-text-primary sm:text-lg">
                        {test.title || test.name || "Untitled Test"}
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {test.subject ? <MetaItem icon={BookOpen}>{test.subject}</MetaItem> : null}
                        {departments > 0 ? <MetaItem icon={Users}>Dept scope ({departments})</MetaItem> : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 md:flex-col md:items-end">
                      <StatusBadge tone={test.autoSubmitted ? "neutral" : remainingTone(test.remainingMs)} icon={Timer} className="h-8 px-3 text-sm tabular-nums">
                        {test.autoSubmitted ? "Time over" : `${formatRemaining(test.remainingMs)} left`}
                      </StatusBadge>
                      {isOpen ? (
                        <Button className={cn(ui.btn, "ml-auto md:ml-0")} onClick={() => setContinueTarget(test)}>
                          <PlayCircle className="size-4" />
                          {test.canTryAgain ? "Attend" : "Continue"}
                        </Button>
                      ) : (
                        <StatusBadge tone="neutral" icon={CheckCircle2} className="ml-auto md:ml-0">
                          {test.isCompleted ? "Completed" : "Closed"}
                        </StatusBadge>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-xs text-text-secondary">
                      <span>
                        <span className="font-medium text-text-primary tabular-nums">{test.answered}</span>/{test.totalQuestions || "-"} answered
                      </span>
                      <span className="tabular-nums">{test.progress}%</span>
                    </div>
                    <Progress
                      value={test.progress}
                      aria-label={`${test.progress}% answered`}
                      className="h-1.5 bg-muted **:data-[slot=progress-indicator]:bg-primary"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-3 pt-2">
        <SectionHeader
          title="Completed tests"
          description="Answer review unlocks once the test window closes."
          count={completedTests.length}
        />

        {reportsQuery.isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
            <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
          </div>
        ) : null}

        {!reportsQuery.isLoading && completedTests.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No completed tests yet"
            description="Once you submit a test, it will appear here with marks and answer review."
          />
        ) : null}

        {!reportsQuery.isLoading && completedTests.length > 0 ? (
          <ul className={cn(ui.card, "divide-y divide-border overflow-hidden")}>
            {completedTests.map((test, index) => {
              const endTime = test.endDate ? new Date(test.endDate).getTime() : Number.NaN;
              const testCompleted =
                test.isTestCompleted || ["COMPLETED", "COMPLETE"].includes(String(test.testStatus || "").trim().toUpperCase());
              const isClosed = Number.isFinite(endTime) ? now >= endTime : true;
              const canViewResults = Boolean(test.submissionId) && (isClosed || testCompleted);

              return (
                <li
                  key={test.submissionId || test.testId || `result-${index}`}
                  className="flex flex-col gap-3 p-4 sm:p-5 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-text-primary">{test.title}</h3>
                      <StatusBadge tone={isClosed || testCompleted ? "success" : "warning"}>
                        {testCompleted ? "Test Completed" : isClosed ? "Test Closed" : "Test Not Closed"}
                      </StatusBadge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <MetaItem icon={BookOpen}>{test.subject}</MetaItem>
                      <MetaItem icon={ClipboardCheck}>Marks: <span className="font-medium text-text-primary">{test.score}</span></MetaItem>
                      <MetaItem icon={Target}>
                        Accuracy: <span className="font-medium text-text-primary">{Number.isFinite(test.accuracy) ? `${test.accuracy}%` : "-"}</span>
                      </MetaItem>
                      {test.endDate ? <MetaItem icon={Clock3}>Ends {formatShortDateTime(test.endDate)}</MetaItem> : null}
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className={cn(ui.btn, "w-full md:w-auto")}
                    onClick={() => navigate(`/results/${test.submissionId}`)}
                    disabled={!canViewResults}
                  >
                    {canViewResults ? <Eye className="size-4" /> : <Lock className="size-4" />}
                    {canViewResults ? "View Answers" : "Available After Test Ends"}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <Dialog open={Boolean(continueTarget)} onOpenChange={(open) => !open && setContinueTarget(null)}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{continueTarget?.canTryAgain ? "Try test again?" : "Continue test?"}</DialogTitle>
            <DialogDescription>
              {continueTarget?.canTryAgain
                ? `You already submitted this test. You have ${continueTarget?.attemptsRemaining || 0} attempt(s) left.`
                : `You are resuming ${continueTarget?.title || continueTarget?.name || "this test"}. Proceed when you are ready.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className={ui.btn} onClick={() => setContinueTarget(null)}>Not now</Button>
            <Button
              className={ui.btn}
              onClick={() => {
                const target = continueTarget;
                setContinueTarget(null);
                if (target?.id) {
                  navigate(`/tests/${target.id}/instructions`);
                }
              }}
            >
              {continueTarget?.canTryAgain ? "Try Again" : "Continue Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
