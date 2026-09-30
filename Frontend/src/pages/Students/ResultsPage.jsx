import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Gauge,
  Lightbulb,
  ListChecks,
  Lock,
  PlayCircle,
  Search,
  SearchX,
  ShieldAlert,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { attemptResultQueryOptions } from "@/services/studentQueries";
import { Callout, EmptyState, ErrorState, LoadingState, Panel, SectionHeader, StatTile, StatusBadge } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

function MetricBar({ label, value }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className="font-semibold tabular-nums text-text-primary">{formatPercent(value)}</span>
      </div>
      <Progress value={clampPercent(value)} aria-label={label} className="mt-2 h-1.5 bg-muted **:data-[slot=progress-indicator]:bg-primary" />
    </div>
  );
}

function LockedReview({ endDate }) {
  return (
    <Panel className="flex items-start gap-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-text-secondary">
        <Lock className="size-5" aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-base font-semibold text-text-primary">Result Summary</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Answers are hidden until the test is marked completed or the review window opens.
        </p>
        {endDate ? (
          <p className="mt-1 text-sm text-text-secondary">
            Available after: <span className="font-medium text-text-primary">{new Date(endDate).toLocaleString()}</span>
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
const clampPercent = (value) => clampNumber(toNumber(value, 0), 0, 100);
const formatPercent = (value) => `${Math.round(clampPercent(value))}%`;

const formatDuration = (secondsInput) => {
  const seconds = Math.max(0, toNumber(secondsInput));
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
};

const resolveReviewMode = (payload) =>
  String(payload?.review_mode || payload?.reviewMode || payload?.submission?.review_mode || "show_score_only").toLowerCase();

const resolveTestTitle = (payload) =>
  payload?.test?.title ||
  payload?.test?.name ||
  payload?.test?.test_title ||
  payload?.test?.test_name ||
  payload?.test_name ||
  payload?.testTitle ||
  "Test performance";

const resolveEndDate = (payload) => {
  const value =
    payload?.test?.end_date ||
    payload?.test?.endDate ||
    payload?.test?.ends_at ||
    payload?.test?.endsAt ||
    payload?.end_date ||
    payload?.endDate;

  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const isCompletedStatus = (value) => ["COMPLETED", "COMPLETE"].includes(String(value || "").trim().toUpperCase());

const isCompletedTest = (payload) =>
  Boolean(
    payload?.is_test_completed ||
      payload?.isTestCompleted ||
      payload?.test?.is_completed ||
      payload?.test?.isCompleted ||
      isCompletedStatus(
        payload?.test?.status ||
          payload?.test?.test_status ||
          payload?.test?.testStatus ||
          payload?.test_status ||
          payload?.testStatus ||
          payload?.status
      )
  );

const formatReviewAnswer = (value, fallback) => {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : fallback;
  }
  if (value == null) {
    return fallback;
  }
  const text = String(value).trim();
  return text || fallback;
};

const hasAnswer = (value) => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
};

const safeHttpUrl = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? text : null;
  } catch {
    return null;
  }
};

const resolveBreakdown = (payload) => {
  const rows = payload?.question_breakdown || payload?.questionBreakdown || payload?.breakdown || payload?.questions || [];

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((item, index) => {
    const studentRaw = item?.student_answer ?? item?.studentAnswer;
    const correctRaw = item?.correct_answer ?? item?.correctAnswer;
    const marks = toNumber(item?.marks ?? item?.obtained_marks ?? item?.obtainedMarks ?? 0);
    const totalMarks = toNumber(item?.total_marks ?? item?.max_marks ?? item?.maxMarks ?? 0);
    const scorePercent = totalMarks > 0 ? (marks / totalMarks) * 100 : 0;

    return {
      id: item?.id || item?.question_id || item?.questionId || `q-${index + 1}`,
      order: index + 1,
      prompt: item?.prompt || item?.question || `Question ${index + 1}`,
      topic: item?.topic || item?.subject || item?.section || "General",
      studentAnswer: formatReviewAnswer(studentRaw, "Not answered"),
      correctAnswer: formatReviewAnswer(correctRaw, "-"),
      marks,
      totalMarks,
      scorePercent,
      isCorrect: Boolean(item?.is_correct ?? item?.isCorrect),
      isAnswered: hasAnswer(studentRaw),
      explanationVideoUrl: safeHttpUrl(item?.explanation_video_url ?? item?.explanationVideoUrl),
    };
  });
};

export default function ResultsPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [showAnswers, setShowAnswers] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState("all");
  const [sortKey, setSortKey] = useState("order");

  const resultQuery = useQuery({
    ...attemptResultQueryOptions(attemptId),
    enabled: Boolean(attemptId),
  });

  useEffect(() => {
    const err = resultQuery.error;
    if (!err) {
      return;
    }

    if (err.status === 409 && err.code === "ATTEMPT_IN_PROGRESS") {
      const activeAttempt = err?.details?.attempt_id || err?.details?.attemptId || attemptId;
      navigate(`/test/${activeAttempt}`, { replace: true });
    }
  }, [attemptId, navigate, resultQuery.error]);

  const result = useMemo(() => resultQuery.data || {}, [resultQuery.data]);

  const score = toNumber(result?.score ?? result?.summary?.score, 0);
  const timeTakenRaw = result?.time_taken ?? result?.timeTaken ?? result?.timeSpentSeconds;
  const timeTaken = toNumber(timeTakenRaw, 0);
  const reviewMode = resolveReviewMode(result);
  const endDate = resolveEndDate(result);
  const breakdown = useMemo(() => resolveBreakdown(result), [result]);
  const testCompleted = isCompletedTest(result);
  const canReviewAnswers = Boolean(result?.can_review_answers || result?.canReviewAnswers);
  const hasTestEnded = !endDate || Date.now() >= endDate;

  const showFullDetails =
    canReviewAnswers || testCompleted || (hasTestEnded && (reviewMode === "show_all" || reviewMode === "show_after_deadline"));

  const violationSubmitted = Boolean(
    result?.violation_submit ||
      result?.violationSubmitted ||
      String(result?.submit_reason || result?.reason || "").toLowerCase().includes("violation")
  );

  const testTitle = resolveTestTitle(result);

  const summaryTotalMarks = toNumber(
    result?.summary?.total_marks ??
      result?.summary?.totalMarks ??
      result?.total_marks ??
      result?.totalMarks ??
      result?.test?.total_marks ??
      result?.test?.totalMarks,
    0
  );

  const summaryObtainedMarks = toNumber(
    result?.summary?.obtained_marks ??
      result?.summary?.obtainedMarks ??
      result?.obtained_marks ??
      result?.obtainedMarks ??
      result?.summary?.score ??
      score,
    0
  );

  const summaryPercent = toNumber(
    result?.percentage ??
      result?.summary?.percentage ??
      result?.score_percent ??
      result?.summary?.score_percent ??
      result?.scorePercentage ??
      result?.summary?.scorePercentage,
    0
  );

  const metrics = useMemo(() => {
    const totalQuestions = breakdown.length;
    const attempted = breakdown.filter((item) => item.isAnswered).length;
    const correct = breakdown.filter((item) => item.isCorrect).length;
    const incorrect = breakdown.filter((item) => item.isAnswered && !item.isCorrect).length;
    const unanswered = Math.max(0, totalQuestions - attempted);

    const totalMarksFromBreakdown = breakdown.reduce((sum, item) => sum + item.totalMarks, 0);
    const marksFromBreakdown = breakdown.reduce((sum, item) => sum + item.marks, 0);

    const totalMarks = totalMarksFromBreakdown || summaryTotalMarks;
    const marksEarned = totalMarksFromBreakdown ? marksFromBreakdown : summaryObtainedMarks || score;

    const scorePercent = totalMarks ? (marksEarned / totalMarks) * 100 : summaryPercent || 0;
    const accuracyPercent = totalQuestions ? (correct / totalQuestions) * 100 : 0;
    const attemptRate = totalQuestions ? (attempted / totalQuestions) * 100 : 0;
    const avgTimePerQuestion = totalQuestions ? timeTaken / totalQuestions : 0;

    return {
      totalQuestions,
      attempted,
      correct,
      incorrect,
      unanswered,
      totalMarks,
      marksEarned,
      scorePercent,
      accuracyPercent,
      attemptRate,
      avgTimePerQuestion,
    };
  }, [breakdown, score, summaryObtainedMarks, summaryPercent, summaryTotalMarks, timeTaken]);

  const topicStats = useMemo(() => {
    if (breakdown.length === 0) {
      return [];
    }

    const map = new Map();

    breakdown.forEach((item) => {
      const key = item.topic || "General";
      if (!map.has(key)) {
        map.set(key, { topic: key, totalMarks: 0, marks: 0, total: 0, correct: 0, attempted: 0 });
      }

      const stats = map.get(key);
      stats.totalMarks += item.totalMarks;
      stats.marks += item.marks;
      stats.total += 1;
      stats.correct += item.isCorrect ? 1 : 0;
      stats.attempted += item.isAnswered ? 1 : 0;
    });

    return [...map.values()].map((stats) => ({
      ...stats,
      scorePercent: stats.totalMarks ? (stats.marks / stats.totalMarks) * 100 : stats.total ? (stats.correct / stats.total) * 100 : 0,
      accuracyPercent: stats.total ? (stats.correct / stats.total) * 100 : 0,
      attemptRate: stats.total ? (stats.attempted / stats.total) * 100 : 0,
    }));
  }, [breakdown]);

  const sortedTopics = useMemo(() => [...topicStats].sort((a, b) => b.scorePercent - a.scorePercent), [topicStats]);
  const strongestTopic = sortedTopics[0] || null;
  const weakestTopic = sortedTopics.length > 1 ? sortedTopics[sortedTopics.length - 1] : null;

  const topicOptions = useMemo(
    () => [...new Set(topicStats.map((item) => item.topic))].sort((a, b) => a.localeCompare(b)),
    [topicStats]
  );

  const guidance = useMemo(() => {
    if (metrics.totalQuestions === 0) {
      return "Complete the test to unlock coaching insights.";
    }
    if (metrics.accuracyPercent < 60) {
      return "Prioritize accuracy before speed. Revisit incorrect topics and retry practice sets.";
    }
    if (metrics.attemptRate < 80) {
      return "Try to attempt every question to maximize your total score.";
    }
    if (metrics.avgTimePerQuestion > 0 && metrics.avgTimePerQuestion > 90) {
      return "Accuracy is strong. Work on speed with timed drills to improve pacing.";
    }
    if (weakestTopic) {
      return `Plan a focused revision session on ${weakestTopic.topic} before the next test.`;
    }
    return "Keep a steady pace and reinforce your strongest topics.";
  }, [metrics, weakestTopic]);

  const filteredBreakdown = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const filtered = breakdown.filter((item) => {
      if (topicFilter !== "all" && item.topic !== topicFilter) {
        return false;
      }
      if (statusFilter === "correct" && !item.isCorrect) {
        return false;
      }
      if (statusFilter === "incorrect" && (!item.isAnswered || item.isCorrect)) {
        return false;
      }
      if (statusFilter === "unanswered" && item.isAnswered) {
        return false;
      }
      if (normalizedSearch) {
        const haystack = `${item.prompt} ${item.topic} ${item.studentAnswer} ${item.correctAnswer}`.toLowerCase();
        if (!haystack.includes(normalizedSearch)) {
          return false;
        }
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortKey === "marks-desc") {
        return b.marks - a.marks || a.order - b.order;
      }
      if (sortKey === "marks-asc") {
        return a.marks - b.marks || a.order - b.order;
      }
      if (sortKey === "score-desc") {
        return b.scorePercent - a.scorePercent || a.order - b.order;
      }
      if (sortKey === "score-asc") {
        return a.scorePercent - b.scorePercent || a.order - b.order;
      }
      return a.order - b.order;
    });
  }, [breakdown, searchTerm, sortKey, statusFilter, topicFilter]);

  if (resultQuery.isLoading) {
    return <LoadingState label="Loading result…" />;
  }

  if (resultQuery.error?.status === 403) {
    return (
      <section className={ui.pageSection}>
        <ErrorState
          title="Access denied"
          description="You do not have access"
          action={
            <Button variant="outline" className="h-9 rounded-lg" onClick={() => navigate("/reports")}>
              Back to reports
            </Button>
          }
        />
      </section>
    );
  }

  if (resultQuery.isError) {
    return (
      <section className={ui.pageSection}>
        <ErrorState
          title="Failed to load results"
          description={resultQuery.error?.message || "Please try again in a moment."}
          onRetry={() => resultQuery.refetch()}
        />
      </section>
    );
  }

  const visibleTopics = sortedTopics.slice(0, 6);

  const moduleSections = Array.isArray(result?.sections) ? result.sections : [];
  const isModuleResult = moduleSections.length > 0;
  const formatSeconds = (seconds) => {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}m ${String(secs).padStart(2, "0")}s`;
  };

  const scoreTone = metrics.scorePercent >= 60 ? "text-success" : metrics.scorePercent >= 40 ? "text-amber-600" : "text-danger";

  return (
    <div className={ui.pageSection}>
      <div>
        <Button variant="ghost" className="-ml-3 h-9 rounded-lg px-3 text-text-secondary" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
      </div>

      <div className={cn(ui.card, "grid overflow-hidden md:grid-cols-[1fr_320px]")}>
        <div className="p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Test result</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-text-primary sm:text-[28px]">{testTitle}</h1>
          <p className="mt-1.5 text-sm text-text-secondary">Review your accuracy, pace, and topic strengths in one focused view.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge tone={testCompleted ? "success" : "warning"} icon={testCompleted ? CheckCircle2 : CircleDashed}>
              {testCompleted ? "Completed" : "In progress"}
            </StatusBadge>
            <StatusBadge tone={showFullDetails ? "info" : "neutral"} icon={showFullDetails ? ListChecks : Lock}>
              {showFullDetails ? "Review unlocked" : "Review locked"}
            </StatusBadge>
            {endDate && !showFullDetails ? (
              <StatusBadge tone="neutral" icon={Clock3}>Unlocks {new Date(endDate).toLocaleString()}</StatusBadge>
            ) : null}
          </div>
          {attemptId ? <p className="mt-4 font-mono text-xs text-text-secondary">Attempt {attemptId}</p> : null}
        </div>

        <div className="border-t border-border bg-muted/40 p-5 sm:p-6 md:border-t-0 md:border-l">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-text-secondary">Total score</p>
              <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-text-primary">{score}</p>
              <p className="mt-0.5 text-xs text-text-secondary">
                {metrics.totalMarks ? `${metrics.marksEarned} of ${metrics.totalMarks} marks` : "Points"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-text-secondary">Percentage</p>
              <p className={cn("mt-1 text-2xl font-semibold tabular-nums", scoreTone)}>{formatPercent(metrics.scorePercent)}</p>
            </div>
          </div>
          <Progress
            value={clampPercent(metrics.scorePercent)}
            aria-label="Score rate"
            className="mt-5 h-2 bg-border/70 **:data-[slot=progress-indicator]:bg-primary"
          />
        </div>
      </div>

      {violationSubmitted ? (
        <Callout tone="warning" icon={ShieldAlert} title="Submitted due to proctoring violation">
          Your attempt was auto-submitted after crossing the allowed violation threshold.
        </Callout>
      ) : null}

      {isModuleResult ? (
        <div className={cn(ui.card, "overflow-hidden")}>
          <div className="p-4 sm:p-5">
            <SectionHeader title="Section performance" description="How you scored in each timed section." />
          </div>
          <div className="overflow-x-auto border-t border-border">
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-5 text-xs font-medium uppercase tracking-wide">Module</TableHead>
                  <TableHead className="text-right text-xs font-medium uppercase tracking-wide">Score</TableHead>
                  <TableHead className="text-right text-xs font-medium uppercase tracking-wide">Max</TableHead>
                  <TableHead className="text-right text-xs font-medium uppercase tracking-wide">Percentage</TableHead>
                  <TableHead className="text-right text-xs font-medium uppercase tracking-wide">Duration</TableHead>
                  <TableHead className="pr-5 text-right text-xs font-medium uppercase tracking-wide">Time taken</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {moduleSections.map((section) => (
                  <TableRow key={section.key}>
                    <TableCell className="pl-5 font-medium text-text-primary">{section.order}. {section.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{toNumber(section.score, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums text-text-secondary">{toNumber(section.max_score, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(toNumber(section.percentage, 0))}</TableCell>
                    <TableCell className="text-right tabular-nums text-text-secondary">{section.configured_duration_mins != null ? `${section.configured_duration_mins} min` : "—"}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums text-text-secondary">{formatSeconds(section.actual_time_seconds)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-semibold text-text-primary hover:bg-muted/30">
                  <TableCell className="pl-5">Overall</TableCell>
                  <TableCell className="text-right tabular-nums">{toNumber(result?.score, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{toNumber(result?.overall_max_score, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(toNumber(result?.overall_percentage, 0))}</TableCell>
                  <TableCell className="text-right tabular-nums">{result?.total_configured_duration_mins ? `${result.total_configured_duration_mins} min` : "—"}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">{formatSeconds(result?.total_actual_time_seconds)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="overview" className="gap-5">
        <TabsList className="h-10! w-full sm:w-fit">
          <TabsTrigger value="overview" className="px-4">Overview</TabsTrigger>
          <TabsTrigger value="review" className="px-4" disabled={!showFullDetails}>
            {!showFullDetails ? <Lock className="size-3.5" /> : null}
            Question Review
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile icon={Target} label="Accuracy" value={formatPercent(metrics.accuracyPercent)} hint={`${metrics.correct} correct out of ${metrics.totalQuestions || 0}`} tone="success" />
              <StatTile icon={ListChecks} label="Attempted" value={`${metrics.attempted}/${metrics.totalQuestions || 0}`} hint={`${formatPercent(metrics.attemptRate)} attempt rate`} />
              <StatTile icon={Gauge} label="Avg time / question" value={metrics.totalQuestions ? formatDuration(metrics.avgTimePerQuestion) : "-"} hint="Pace per question" tone="neutral" />
              <StatTile icon={Clock3} label="Time taken" value={timeTakenRaw == null ? "-" : formatDuration(timeTaken)} hint="Total duration" tone="neutral" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel>
                <SectionHeader title="Performance signals" description="Score rate, accuracy, and completion." />
                <div className="mt-5 space-y-5">
                  <MetricBar label="Score rate" value={metrics.scorePercent} />
                  <MetricBar label="Accuracy" value={metrics.accuracyPercent} />
                  <MetricBar label="Attempt rate" value={metrics.attemptRate} />
                </div>
              </Panel>

              <Panel>
                <SectionHeader title="Focus areas" description="Target your revision based on strengths and gaps." />
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-success/25 bg-success/5 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                      <TrendingUp className="size-3.5" aria-hidden="true" />
                      Strongest topic
                    </p>
                    <p className="mt-1.5 text-sm font-semibold text-text-primary">{strongestTopic ? strongestTopic.topic : "Not enough data"}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {strongestTopic ? `${formatPercent(strongestTopic.scorePercent)} score` : "Complete more items to unlock."}
                    </p>
                  </div>
                  <div className="rounded-lg border border-danger/20 bg-danger/5 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
                      <TrendingDown className="size-3.5" aria-hidden="true" />
                      Needs attention
                    </p>
                    <p className="mt-1.5 text-sm font-semibold text-text-primary">{weakestTopic ? weakestTopic.topic : "Not enough data"}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {weakestTopic ? `${formatPercent(weakestTopic.scorePercent)} score` : "Keep practicing to reveal gaps."}
                    </p>
                  </div>
                </div>
                <Callout tone="info" icon={Lightbulb} title="Coaching note" className="mt-3">
                  {guidance}
                </Callout>
              </Panel>
            </div>

            <Panel>
              <SectionHeader
                title="Topic performance"
                description="Compare how you performed across topics."
                action={
                  sortedTopics.length > visibleTopics.length ? (
                    <StatusBadge tone="neutral">Top {visibleTopics.length} of {sortedTopics.length}</StatusBadge>
                  ) : null
                }
              />

              {visibleTopics.length === 0 ? (
                <EmptyState
                  className="mt-4 py-8"
                  icon={Target}
                  title="No topic data"
                  description={
                    showFullDetails
                      ? "Topic insights will appear once question details are available."
                      : "Topic insights unlock after the review window ends."
                  }
                />
              ) : (
                <ul className="mt-5 grid gap-x-8 gap-y-5 lg:grid-cols-2">
                  {visibleTopics.map((topic) => (
                    <li key={topic.topic}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-medium text-text-primary">{topic.topic}</span>
                        <span className="font-semibold tabular-nums text-text-primary">{formatPercent(topic.scorePercent)}</span>
                      </div>
                      <Progress value={clampPercent(topic.scorePercent)} className="mt-2 h-1.5 bg-muted **:data-[slot=progress-indicator]:bg-primary" />
                      <div className="mt-1.5 flex items-center justify-between text-xs text-text-secondary">
                        <span>{topic.correct}/{topic.total} correct</span>
                        <span>{formatPercent(topic.attemptRate)} attempted</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {!showFullDetails ? <LockedReview endDate={endDate} /> : null}
          </div>
        </TabsContent>

        <TabsContent value="review" forceMount className="data-[state=inactive]:hidden">
          {showFullDetails ? (
            <div className="space-y-4">
              <Panel>
                <SectionHeader
                  title="Question review"
                  description="Filter, search, and compare your responses with the correct answers."
                  action={
                    <Button type="button" className={ui.btn} variant={showAnswers ? "outline" : "default"} onClick={() => setShowAnswers((prev) => !prev)}>
                      {showAnswers ? "Hide Answers" : "View Answers"}
                    </Button>
                  }
                />

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
                  <div className="relative sm:col-span-2 xl:col-span-1">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
                    <Input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search question, topic, or answer"
                      aria-label="Search questions"
                      className={cn(ui.field, "pl-9")}
                    />
                  </div>

                  <NativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Status" className={cn("w-full", ui.select)}>
                    <NativeSelectOption value="all">All statuses</NativeSelectOption>
                    <NativeSelectOption value="correct">Correct</NativeSelectOption>
                    <NativeSelectOption value="incorrect">Incorrect</NativeSelectOption>
                    <NativeSelectOption value="unanswered">Unanswered</NativeSelectOption>
                  </NativeSelect>

                  <NativeSelect value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)} aria-label="Topic" className={cn("w-full", ui.select)}>
                    <NativeSelectOption value="all">All topics</NativeSelectOption>
                    {topicOptions.map((topic) => (
                      <NativeSelectOption key={topic} value={topic}>
                        {topic}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>

                  <NativeSelect value={sortKey} onChange={(event) => setSortKey(event.target.value)} aria-label="Sort" className={cn("w-full", ui.select)}>
                    <NativeSelectOption value="order">Question order</NativeSelectOption>
                    <NativeSelectOption value="marks-desc">Marks high to low</NativeSelectOption>
                    <NativeSelectOption value="marks-asc">Marks low to high</NativeSelectOption>
                    <NativeSelectOption value="score-desc">Score % high to low</NativeSelectOption>
                    <NativeSelectOption value="score-asc">Score % low to high</NativeSelectOption>
                  </NativeSelect>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                  <span className="mr-1">
                    Showing {filteredBreakdown.length} of {breakdown.length || 0} questions
                  </span>
                  <StatusBadge tone="success" icon={CheckCircle2}>Correct {metrics.correct}</StatusBadge>
                  <StatusBadge tone="danger" icon={XCircle}>Incorrect {metrics.incorrect}</StatusBadge>
                  <StatusBadge tone="neutral" icon={CircleDashed}>Unanswered {metrics.unanswered}</StatusBadge>
                </div>
              </Panel>

              {breakdown.length === 0 ? (
                <EmptyState icon={ListChecks} title="No question breakdown" description="Question-level details are not available for this attempt." />
              ) : filteredBreakdown.length === 0 ? (
                <EmptyState icon={SearchX} title="No matches found" description="Try clearing filters or searching with a different term." />
              ) : (
                <ol className="space-y-3">
                  {filteredBreakdown.map((item) => {
                    const status = item.isAnswered
                      ? item.isCorrect
                        ? { label: "Correct", tone: "success", Icon: CheckCircle2, accent: "bg-success" }
                        : { label: "Incorrect", tone: "danger", Icon: XCircle, accent: "bg-danger" }
                      : { label: "Unanswered", tone: "neutral", Icon: Timer, accent: "bg-border" };

                    return (
                      <li key={item.id} className={cn(ui.card, "relative overflow-hidden p-4 pl-5 sm:p-5 sm:pl-6")}>
                        <span className={cn("absolute inset-y-0 left-0 w-1", status.accent)} aria-hidden="true" />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-text-primary">Q{item.order}</span>
                          <span className="text-xs text-text-secondary">{item.topic}</span>
                          <span className="ml-auto flex items-center gap-2">
                            <span className="text-sm font-semibold tabular-nums text-text-primary">
                              {item.marks}
                              {item.totalMarks > 0 ? ` / ${item.totalMarks}` : ""}
                              <span className="sr-only"> marks</span>
                            </span>
                            <StatusBadge tone={status.tone} icon={status.Icon}>{status.label}</StatusBadge>
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-medium leading-6 text-text-primary sm:text-base">{item.prompt}</p>
                        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg bg-muted/50 p-3">
                            <dt className="text-xs text-text-secondary">Your answer</dt>
                            <dd className={cn("mt-1 text-sm font-medium", item.isAnswered ? "text-text-primary" : "italic text-text-secondary")}>{item.studentAnswer}</dd>
                          </div>
                          <div className="rounded-lg bg-muted/50 p-3">
                            <dt className="text-xs text-text-secondary">Correct answer</dt>
                            <dd className="mt-1 text-sm font-medium text-text-primary">
                              {showAnswers ? item.correctAnswer : <span className="italic font-normal text-text-secondary">Hidden</span>}
                            </dd>
                          </div>
                        </dl>
                        {item.explanationVideoUrl ? (
                          <a
                            href={item.explanationVideoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary outline-none hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50 -ml-2"
                          >
                            <PlayCircle className="size-4" />
                            Watch explanation
                          </a>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          ) : (
            <LockedReview endDate={endDate} />
          )}
        </TabsContent>
      </Tabs>

      <div className="flex justify-center pt-2">
        <Button type="button" variant="outline" className={ui.btn} onClick={() => navigate("/tests/ongoing")}>
          Return to Home
        </Button>
      </div>
    </div>
  );
}
