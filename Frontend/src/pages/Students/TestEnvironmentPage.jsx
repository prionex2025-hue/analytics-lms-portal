import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bookmark, BookmarkCheck, Check, ChevronLeft, ChevronRight, Clock3, CloudOff, Eraser, Loader2, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { LoadingState } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  clearAnswer,
  loadAttempt,
  resetAttemptState,
  setAnswer,
  setPendingSubmit,
  setCurrentQuestionIndex,
  submitAttempt,
  advanceModule,
  toggleMarkedForReview,
} from "@/features/Students/testSlice";
import { useAttemptTimer } from "@/hooks/useAttemptTimer";
import { useAttemptAutosave } from "@/hooks/useAttemptAutosave";
import { useProctoringGuard } from "@/hooks/useProctoringGuard";
import { useAttemptHeartbeat } from "@/hooks/useAttemptHeartbeat";
import { QuestionRenderer } from "@/components/Students/test-engine/QuestionRenderer";
import { TestNavigationPanel } from "@/components/Students/test-engine/TestNavigationPanel";

const pendingSubmitStorageKey = "lms:test:pending-submit";

const formatDuration = (remainingSeconds) => {
  const safe = Math.max(0, remainingSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const shouldAutoNextSingle = (proctoringConfig) => Boolean(proctoringConfig?.auto_next_single);

const exitFullscreenIfActive = async () => {
  if (typeof document === "undefined") {
    return;
  }

  if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
    try {
      await document.exitFullscreen();
    } catch {
      // Ignore exit failures and continue with navigation.
    }
  }
};

export default function TestEnvironmentPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { attemptId, testId } = useParams();
  const [submitWarningOpen, setSubmitWarningOpen] = useState(false);
  const [proctoringPaused, setProctoringPaused] = useState(false);

  const submitLockRef = useRef(false);
  const advanceLockRef = useRef(false);
  const retryDelayRef = useRef(1500);
  const [moduleAdvanceOpen, setModuleAdvanceOpen] = useState(false);

  const {
    attempt_id,
    test_id,
    question_order,
    questions,
    answers,
    marked_for_review,
    current_question_index,
    server_end_time,
    clock_offset_ms,
    proctoring_config,
    violations,
    save_status,
    submit_status,
    start_status,
    load_status,
    last_error,
    assessment_format,
    modules,
    current_module,
    server_module_end_time,
    advance_status,
  } = useSelector((state) => state.test);

  const isModuleTest = String(assessment_format || "").toUpperCase() === "MODULE_TEST";
  const currentModuleOrder = Number(current_module?.order || 0);
  const totalModules = Array.isArray(modules) ? modules.length : 0;
  const isLastModule = isModuleTest && totalModules > 0 && currentModuleOrder >= totalModules;

  const questionId = question_order[current_question_index];
  const currentQuestion = questionId ? questions[questionId] : null;

  useEffect(() => {
    if (attemptId) {
      dispatch(loadAttempt({ attempt_id: attemptId }));
      return;
    }

    if (testId) {
      navigate(`/tests/${testId}/instructions`, { replace: true });
    }
  }, [attemptId, dispatch, navigate, testId]);

  useEffect(() => {
    if (!attemptId && attempt_id) {
      navigate(`/test/${attempt_id}`, { replace: true });
    }
  }, [attemptId, attempt_id, navigate]);

  useEffect(() => {
    return () => {
      dispatch(resetAttemptState());
    };
  }, [dispatch]);

  useEffect(() => {
    if (!attempt_id || submit_status === "submitted") {
      return undefined;
    }

    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [attempt_id, submit_status]);

  const { flushPendingSaves } = useAttemptAutosave();

  const trySubmit = useCallback(async (reason) => {
    if (!attempt_id || !test_id || submitLockRef.current || submit_status === "submitting" || submit_status === "submitted") {
      return;
    }

    setProctoringPaused(true);
    submitLockRef.current = true;

    const payload = {
      attempt_id,
      test_id,
      reason,
      created_at: Date.now(),
    };

    dispatch(setPendingSubmit(payload));

    try {
      sessionStorage.setItem(pendingSubmitStorageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage failures.
    }

    try {
      await flushPendingSaves();
      const submissionResponse = await dispatch(submitAttempt({ attempt_id, test_id, reason })).unwrap();
      retryDelayRef.current = 1500;

      dispatch(setPendingSubmit(null));

      try {
        sessionStorage.removeItem(pendingSubmitStorageKey);
        sessionStorage.removeItem(`lms:attempt:draft:${attempt_id}`);
      } catch {
        // Ignore storage failures.
      }

      await exitFullscreenIfActive();
      queryClient.invalidateQueries({ queryKey: ["student", "reports"] });
      queryClient.invalidateQueries({ queryKey: ["student", "leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["student", "attempts", "active"] });
      queryClient.invalidateQueries({ queryKey: ["student", "results", attempt_id] });
      navigate(`/submission/${attempt_id}`, {
        replace: true,
        state: {
          submission: submissionResponse?.submission || submissionResponse || null,
          summary: submissionResponse?.summary || null,
          reason,
        },
      });
      return;
    } catch (error) {
      const retryAfterSeconds = Number(error?.retryAfterSeconds || 0);
      retryDelayRef.current = retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : Math.min(15_000, retryDelayRef.current + 1500);
      setProctoringPaused(false);
      toast.error("Submit failed. Auto-retry is active.", {
        dismissible: false,
        duration: 3000,
      });
    } finally {
      submitLockRef.current = false;
    }
  }, [attempt_id, dispatch, flushPendingSaves, navigate, queryClient, submit_status, test_id]);

  // MODULE_TEST: submit the current module and move to the next (or, on the last
  // module, complete the whole attempt and go to results).
  const advanceCurrentModule = useCallback(async (reason) => {
    if (!attempt_id || !test_id || advanceLockRef.current || advance_status === "advancing") {
      return;
    }
    if (submit_status === "submitting" || submit_status === "submitted") {
      return;
    }
    advanceLockRef.current = true;
    try {
      await flushPendingSaves();
      const result = await dispatch(
        advanceModule({ attempt_id, test_id, fromModuleKey: current_module?.key })
      ).unwrap();

      if (result?.completed) {
        setProctoringPaused(true);
        dispatch(setPendingSubmit(null));
        try {
          sessionStorage.removeItem(pendingSubmitStorageKey);
          sessionStorage.removeItem(`lms:attempt:draft:${attempt_id}`);
        } catch {
          // Ignore storage failures.
        }
        await exitFullscreenIfActive();
        queryClient.invalidateQueries({ queryKey: ["student", "reports"] });
        queryClient.invalidateQueries({ queryKey: ["student", "results", attempt_id] });
        navigate(`/submission/${attempt_id}`, { replace: true });
        return;
      }

      toast.success(reason === "time_expired" ? "Time up. Moving to the next section." : "Section submitted. Next section started.");
    } catch {
      toast.error("Could not submit this section. Please retry.");
    } finally {
      advanceLockRef.current = false;
    }
  }, [attempt_id, test_id, current_module, advance_status, submit_status, dispatch, flushPendingSaves, navigate, queryClient]);

  useEffect(() => {
    let timer = null;

    const retryPending = async () => {
      let parsed = null;

      try {
        parsed = JSON.parse(sessionStorage.getItem(pendingSubmitStorageKey) || "null");
      } catch {
        parsed = null;
      }

      if (!parsed?.attempt_id || !parsed?.test_id) {
        return;
      }

      if (String(parsed.attempt_id) !== String(attempt_id)) {
        return;
      }

      await trySubmit(parsed.reason || "retry_submission");
    };

    if (attempt_id && navigator.onLine) {
      timer = window.setTimeout(retryPending, retryDelayRef.current);
    }

    const onlineHandler = () => {
      retryPending();
    };

    window.addEventListener("online", onlineHandler);

    return () => {
      if (timer) {
        window.clearTimeout(timer);
      }
      window.removeEventListener("online", onlineHandler);
    };
  }, [attempt_id, trySubmit]);

  const { remainingSeconds } = useAttemptTimer({
    serverEndTime: isModuleTest ? (server_module_end_time || server_end_time) : server_end_time,
    clockOffsetMs: clock_offset_ms,
    onExpired: () => {
      if (isModuleTest) {
        advanceCurrentModule("time_expired");
      } else {
        trySubmit("time_expired");
      }
    },
  });

  useAttemptHeartbeat({
    attemptId: attempt_id,
    testId: test_id,
    onNotFound: () => {
      toast.error("Test session no longer exists.");
      navigate("/tests/ongoing", { replace: true });
    },
    onAlreadySubmitted: () => {
      exitFullscreenIfActive().finally(() => {
        navigate(`/submission/${attempt_id}`, { replace: true });
      });
    },
  });

  const { fullscreenBlocked, reEnterFullscreen } = useProctoringGuard({
    attemptId: attempt_id,
    testId: test_id,
    enabled: Boolean(proctoring_config?.enabled),
    paused: proctoringPaused || submit_status === "submitting" || submit_status === "submitted",
    threshold: Number(proctoring_config?.threshold || 3),
    fullscreenRequired: Boolean(proctoring_config?.fullscreen_required),
    tabSwitchMode: String(proctoring_config?.tab_switch || "monitored"),
    copyPasteMode: String(proctoring_config?.copy_paste || "monitored"),
    windowBlurEnabled: Boolean(proctoring_config?.window_blur),
    screenshotDetectionEnabled: Boolean(proctoring_config?.screenshot_detection),
    rightClickDisabled: Boolean(proctoring_config?.right_click_disabled),
    devtoolsDetectionEnabled: Boolean(proctoring_config?.devtools_detection),
    onThresholdExceeded: () => {
      trySubmit("violation_threshold_exceeded");
    },
  });

  const inputDisabled = submit_status === "submitting" || submit_status === "submitted" || advance_status === "advancing";

  const onAnswerChange = (patch) => {
    if (!questionId || inputDisabled) {
      return;
    }

    const current = answers[questionId] || {};

    const normalizedPatch = {
      ...current,
      ...patch,
    };

    if (currentQuestion?.type === "FILL_BLANK") {
      normalizedPatch.answer_text = String(normalizedPatch.answer_text || "").trim();
    }

    dispatch(
      setAnswer({
        question_id: questionId,
        answer: normalizedPatch,
      })
    );

    if (currentQuestion?.type === "MCQ_SINGLE" && shouldAutoNextSingle(proctoring_config)) {
      if (current_question_index < question_order.length - 1) {
        dispatch(setCurrentQuestionIndex(current_question_index + 1));
      }
    }
  };

  const goPrev = () => {
    dispatch(setCurrentQuestionIndex(Math.max(0, current_question_index - 1)));
  };

  const goNext = () => {
    dispatch(setCurrentQuestionIndex(Math.min(question_order.length - 1, current_question_index + 1)));
  };

  const hasLoadFailure = start_status === "failed" || load_status === "failed";
  const hasQuestionPayload = Boolean(currentQuestion);
  const awaitingInitialPayload =
    (start_status === "idle" && load_status === "idle" && !hasQuestionPayload) ||
    start_status === "loading" ||
    load_status === "loading";
  const hasMissingQuestionPayload =
    !hasLoadFailure &&
    !hasQuestionPayload &&
    (start_status === "ready" || load_status === "ready");

  const remainingColorClass =
    remainingSeconds <= 60
      ? "text-danger bg-danger/10 ring-danger/30"
      : remainingSeconds <= 300
        ? "text-amber-700 bg-warning/15 ring-warning/40 dark:text-warning"
        : "text-text-primary bg-muted ring-border";

  const title = useMemo(() => {
    if (start_status === "failed" || load_status === "failed") {
      return "Unable to load test";
    }

    return `Question ${current_question_index + 1} of ${question_order.length}`;
  }, [current_question_index, load_status, question_order.length, start_status]);

  if (awaitingInitialPayload) {
    return <LoadingState fullScreen label="Loading secure test environment..." />;
  }

  const renderFailure = (heading, message) => (
    <section className="grid min-h-screen place-items-center bg-background p-4">
      <div role="alert" className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-text-primary">{heading}</h2>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{message}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button type="button" className="h-10 rounded-lg px-4" onClick={() => navigate("/resume", { replace: true })}>
            <RefreshCw className="size-4" />
            Resume Active Attempt
          </Button>
          <Button type="button" variant="outline" className="h-10 rounded-lg px-4" onClick={() => navigate("/tests/ongoing", { replace: true })}>
            Back to Ongoing Tests
          </Button>
        </div>
      </div>
    </section>
  );

  if (hasLoadFailure) {
    return renderFailure(
      "Unable to Load Test Environment",
      last_error || "We could not initialize your attempt. Please resume your active test session."
    );
  }

  if (hasMissingQuestionPayload) {
    return renderFailure(
      "Session Found But Questions Missing",
      "We found your session, but question data did not load correctly. Please resume again."
    );
  }

  const isMarked = marked_for_review.includes(questionId);
  const violationThreshold = Number(proctoring_config?.threshold || 3);
  const submitLabel = isModuleTest
    ? advance_status === "advancing"
      ? "Submitting..."
      : isLastModule
        ? "Finish Test"
        : "Submit Section & Continue"
    : submit_status === "submitting"
      ? "Submitting..."
      : "Submit Test";
  const isSubmitting = advance_status === "advancing" || submit_status === "submitting";

  return (
    <section className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-primary">{title}</p>
            {isModuleTest && current_module ? (
              <p className="truncate text-xs font-medium text-primary">Current section: {current_module.name}</p>
            ) : (
              <p className="truncate font-mono text-xs text-text-secondary">Attempt: {attempt_id}</p>
            )}
          </div>

          <div className="hidden items-center gap-1.5 text-xs text-text-secondary md:flex" aria-live="polite">
            {save_status === "saving" ? (
              <><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Saving…</>
            ) : save_status === "error" ? (
              <><CloudOff className="size-3.5 text-amber-600 dark:text-warning" aria-hidden="true" /> Saved locally</>
            ) : save_status === "saved" ? (
              <><Check className="size-3.5 text-success" aria-hidden="true" /> All changes saved</>
            ) : null}
          </div>

          <div className="flex flex-col items-end">
            <div
              role="timer"
              aria-label="Time remaining"
              className={cn("inline-flex h-10 items-center gap-2 rounded-lg px-3 text-lg font-semibold tabular-nums ring-1 ring-inset", remainingColorClass)}
            >
              <Clock3 className="size-4" aria-hidden="true" />
              {formatDuration(remainingSeconds)}
            </div>
            {isModuleTest ? (
              <span className="mt-0.5 text-[11px] text-text-secondary">Timer for this section only</span>
            ) : null}
          </div>

          <Button
            type="button"
            className="hidden h-10 rounded-lg px-4 sm:inline-flex"
            disabled={inputDisabled}
            onClick={() => (isModuleTest ? setModuleAdvanceOpen(true) : setSubmitWarningOpen(true))}
          >
            {isSubmitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Send className="size-4" />}
            {submitLabel}
          </Button>
        </div>

        {question_order.length > 0 ? (
          <div className="h-1 bg-muted" aria-hidden="true">
            <div
              className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${((current_question_index + 1) / question_order.length) * 100}%` }}
            />
          </div>
        ) : null}
      </header>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6 lg:py-8">
          {isModuleTest && Array.isArray(modules) && modules.length > 0 ? (
            <ol className="flex flex-wrap items-center gap-2" aria-label="Test sections">
              {modules.map((mod) => {
                const done = ["MANUAL_SUBMIT", "AUTO_SUBMIT", "EXPIRED", "COMPLETED"].includes(String(mod.status || "").toUpperCase());
                const isCurrent = mod.isCurrent || mod.key === current_module?.key;
                return (
                  <li
                    key={mod.key}
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-inset",
                      isCurrent
                        ? "bg-primary text-primary-foreground ring-primary"
                        : done
                          ? "bg-success/10 text-success ring-success/25"
                          : "bg-card text-text-secondary ring-border"
                    )}
                  >
                    {done && !isCurrent ? <Check className="size-3.5" aria-hidden="true" /> : <span className="tabular-nums">{mod.order}.</span>}
                    {mod.name}
                  </li>
                );
              })}
            </ol>
          ) : null}

          {save_status === "error" ? (
            <div role="status" className="flex items-start gap-2.5 rounded-lg border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-text-primary">
              <CloudOff className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-warning" aria-hidden="true" />
              Saving locally. Changes will sync automatically when connection recovers.
            </div>
          ) : null}

          <article className="rounded-xl border border-border bg-card p-5 shadow-xs sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Question {current_question_index + 1}
              </span>
              <Button
                type="button"
                variant={isMarked ? "secondary" : "ghost"}
                className={cn("h-9 rounded-lg px-3", isMarked ? "border-warning/40 bg-warning/10 text-amber-700 hover:bg-warning/15 dark:text-warning" : "text-text-secondary")}
                disabled={inputDisabled}
                aria-pressed={isMarked}
                onClick={() => dispatch(toggleMarkedForReview(questionId))}
              >
                {isMarked ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
                {isMarked ? "Unmark Review" : "Mark for Review"}
              </Button>
            </div>

            <h2 className="mt-3 text-lg font-medium leading-relaxed text-text-primary sm:text-xl">{currentQuestion?.prompt}</h2>

            <div className="mt-6">
              <QuestionRenderer
                question={currentQuestion}
                answer={answers[questionId]}
                disabled={inputDisabled}
                paragraphWordLimit={Number(proctoring_config?.paragraph_word_limit || 250)}
                onChange={onAnswerChange}
              />
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-5">
              <Button type="button" variant="ghost" className="h-10 rounded-lg px-3 text-text-secondary" onClick={() => dispatch(clearAnswer(questionId))} disabled={inputDisabled}>
                <Eraser className="size-4" />
                Clear
              </Button>
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="outline" className="h-10 rounded-lg px-4" onClick={goPrev} disabled={current_question_index <= 0}>
                  <ChevronLeft className="size-4" />
                  Prev
                </Button>
                <Button type="button" className="h-10 rounded-lg px-4" onClick={goNext} disabled={current_question_index >= question_order.length - 1}>
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </article>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="inline-flex items-center gap-2 text-xs text-text-secondary">
              <ShieldCheck className="size-4" aria-hidden="true" />
              {proctoring_config?.enabled
                ? `Violations: ${violations.total}/${violationThreshold}`
                : "Proctoring is disabled for this test."}
            </p>
            <Button
              type="button"
              className="h-11 w-full rounded-lg px-4 sm:hidden"
              disabled={inputDisabled}
              onClick={() => (isModuleTest ? setModuleAdvanceOpen(true) : setSubmitWarningOpen(true))}
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Send className="size-4" />}
              {submitLabel}
            </Button>
          </div>
        </div>

      <TestNavigationPanel
        questionOrder={question_order}
        answers={answers}
        markedForReview={marked_for_review}
        currentIndex={current_question_index}
        onJump={(index) => dispatch(setCurrentQuestionIndex(index))}
        onPrev={goPrev}
        onNext={goNext}
        disableNext={current_question_index >= question_order.length - 1}
      />
      </div>

      <Dialog open={Boolean(proctoring_config?.enabled && proctoring_config?.fullscreen_required && fullscreenBlocked)}>
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-warning" />Fullscreen Required</DialogTitle>
            <DialogDescription>
              This test requires fullscreen mode. Re-enter fullscreen to continue without triggering violations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={reEnterFullscreen}>
              Re-enter Fullscreen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(proctoring_config?.enabled && violations.total >= Number(proctoring_config?.threshold || 3))}>
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-danger" />Violation Threshold Reached</DialogTitle>
            <DialogDescription>
              Your test is being auto-submitted due to repeated proctoring violations.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={submitWarningOpen}
        onOpenChange={(open) => {
          if (submit_status === "submitting") {
            return;
          }
          setSubmitWarningOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning" />
              Confirm Test Submission
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to submit this test? Once submitted, you cannot cancel or edit your answers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submit_status === "submitting"}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSubmitWarningOpen(false);
                trySubmit("manual_submit");
              }}
              disabled={submit_status === "submitting" || submit_status === "submitted"}
            >
              {submit_status === "submitting" ? "Submitting..." : "Submit Test"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={moduleAdvanceOpen}
        onOpenChange={(open) => {
          if (advance_status === "advancing") {
            return;
          }
          setModuleAdvanceOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning" />
              {isLastModule ? "Finish Test" : `Submit ${current_module?.name || "Section"}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isLastModule
                ? "This is the final section. Submitting will complete your test and you cannot return to any section."
                : "You are about to submit this section and move to the next one. You cannot return to this section, and its unused time will not carry over."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={advance_status === "advancing"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setModuleAdvanceOpen(false);
                advanceCurrentModule("manual_submit");
              }}
              disabled={advance_status === "advancing"}
            >
              {advance_status === "advancing" ? "Submitting..." : isLastModule ? "Finish Test" : "Submit & Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
