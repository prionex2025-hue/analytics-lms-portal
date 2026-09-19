import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ListFilter,
  PlayCircle,
  Search,
  ShieldAlert,
  Sparkles,
  Timer,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { attemptResultQueryOptions } from "@/services/studentQueries";

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
    return <div className="grid min-h-[60vh] place-items-center text-text-secondary">Loading result...</div>;
  }

  if (resultQuery.error?.status === 403) {
    return (
      <section className="space-y-5">
        <Alert variant="destructive" className="border-danger/30 bg-danger/10 text-danger">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>You do not have access</AlertDescription>
        </Alert>
      </section>
    );
  }

  if (resultQuery.isError) {
    return (
      <section className="space-y-5">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load results</AlertTitle>
          <AlertDescription>{resultQuery.error?.message || "Please try again in a moment."}</AlertDescription>
        </Alert>
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

  return (
    <div className="space-y-6">
      <Card
        className="relative overflow-hidden border border-primary/10 bg-[linear-gradient(135deg,var(--results-hero-from),var(--results-hero-via),var(--results-hero-to))] p-6 text-primary-foreground shadow-[0_24px_60px_rgba(15,23,42,0.35)]"
        style={{
          "--results-hero-from": "#0f172a",
          "--results-hero-via": "#1e293b",
          "--results-hero-to": "#1e40af",
          "--results-hero-glow": "rgba(59,130,246,0.35)",
          "--results-hero-glow-2": "rgba(56,189,248,0.35)",
        }}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,var(--results-hero-glow),transparent_60%)]" />
        <div className="pointer-events-none absolute -right-16 top-6 h-48 w-48 rounded-full bg-[radial-gradient(circle,var(--results-hero-glow-2),transparent_60%)] opacity-80 blur-2xl" />
        <div className="relative z-10 grid gap-6 md:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.3em] uppercase text-primary-foreground/70">
              <Sparkles className="size-4" />
              Performance Studio
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{testTitle}</h1>
              <p className="mt-2 text-sm text-primary-foreground/80">
                Review your accuracy, pace, and topic strengths in one focused view.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-primary-foreground/30 text-primary-foreground">
                {testCompleted ? "Completed" : "In progress"}
              </Badge>
              <Badge variant="outline" className="border-primary-foreground/30 text-primary-foreground">
                {showFullDetails ? "Review unlocked" : "Review locked"}
              </Badge>
              {attemptId ? (
                <Badge variant="outline" className="border-primary-foreground/30 text-primary-foreground">
                  Attempt {attemptId}
                </Badge>
              ) : null}
              {endDate && !showFullDetails ? (
                <Badge variant="outline" className="border-primary-foreground/30 text-primary-foreground">
                  Unlocks {new Date(endDate).toLocaleString()}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-primary-foreground/15 bg-white/10 p-4 backdrop-blur">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
              <span>Score</span>
              <span>{metrics.totalMarks ? `${metrics.marksEarned} / ${metrics.totalMarks}` : "Points"}</span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="text-4xl font-semibold">{score}</p>
                <p className="text-xs text-primary-foreground/60">Total score</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/60">Percentage</p>
                <p className="text-2xl font-semibold">{formatPercent(metrics.scorePercent)}</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-primary-foreground/70">
                <span>Score rate</span>
                <span>{formatPercent(metrics.scorePercent)}</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/20">
                <div className="h-full bg-white" style={{ width: `${clampPercent(metrics.scorePercent)}%` }} />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {violationSubmitted ? (
        <Alert className="border-warning/30 bg-warning/10 text-warning">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Submitted due to proctoring violation</AlertTitle>
          <AlertDescription>Your attempt was auto-submitted after crossing the allowed violation threshold.</AlertDescription>
        </Alert>
      ) : null}

      {isModuleResult ? (
        <Card className="border border-border p-5">
          <h2 className="text-lg font-semibold text-text-primary">Section Performance</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-secondary">
                  <th className="py-2 pr-3">Module</th>
                  <th className="py-2 px-3">Score</th>
                  <th className="py-2 px-3">Max</th>
                  <th className="py-2 px-3">Percentage</th>
                  <th className="py-2 px-3">Duration</th>
                  <th className="py-2 pl-3">Time Taken</th>
                </tr>
              </thead>
              <tbody>
                {moduleSections.map((section) => (
                  <tr key={section.key} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-medium text-text-primary">{section.order}. {section.name}</td>
                    <td className="py-2 px-3">{toNumber(section.score, 0)}</td>
                    <td className="py-2 px-3">{toNumber(section.max_score, 0)}</td>
                    <td className="py-2 px-3">{formatPercent(toNumber(section.percentage, 0))}</td>
                    <td className="py-2 px-3">{section.configured_duration_mins != null ? `${section.configured_duration_mins} min` : "—"}</td>
                    <td className="py-2 pl-3">{formatSeconds(section.actual_time_seconds)}</td>
                  </tr>
                ))}
                <tr className="font-semibold text-text-primary">
                  <td className="py-2 pr-3">Overall</td>
                  <td className="py-2 px-3">{toNumber(result?.score, 0)}</td>
                  <td className="py-2 px-3">{toNumber(result?.overall_max_score, 0)}</td>
                  <td className="py-2 px-3">{formatPercent(toNumber(result?.overall_percentage, 0))}</td>
                  <td className="py-2 px-3">{result?.total_configured_duration_mins ? `${result.total_configured_duration_mins} min` : "—"}</td>
                  <td className="py-2 pl-3">{formatSeconds(result?.total_actual_time_seconds)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="review" disabled={!showFullDetails}>
            Question Review
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Accuracy</p>
                <p className="mt-2 text-2xl font-semibold text-text-primary">{formatPercent(metrics.accuracyPercent)}</p>
                <p className="mt-1 text-xs text-text-secondary">
                  {metrics.correct} correct out of {metrics.totalQuestions || 0}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Attempted</p>
                <p className="mt-2 text-2xl font-semibold text-text-primary">
                  {metrics.attempted}/{metrics.totalQuestions || 0}
                </p>
                <p className="mt-1 text-xs text-text-secondary">{formatPercent(metrics.attemptRate)} attempt rate</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Avg time / question</p>
                <p className="mt-2 text-2xl font-semibold text-text-primary">
                  {metrics.totalQuestions ? formatDuration(metrics.avgTimePerQuestion) : "-"}
                </p>
                <p className="mt-1 text-xs text-text-secondary">Pace per question</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Time taken</p>
                <p className="mt-2 text-2xl font-semibold text-text-primary">
                  {timeTakenRaw == null ? "-" : formatDuration(timeTaken)}
                </p>
                <p className="mt-1 text-xs text-text-secondary">Total duration</p>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <Card className="p-5">
                <h2 className="text-lg font-semibold text-text-primary">Performance signals</h2>
                <p className="mt-1 text-sm text-text-secondary">Keep track of score rate, accuracy, and completion.</p>

                <div className="mt-4 space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-xs text-text-secondary">
                      <span>Score rate</span>
                      <span className="font-semibold text-text-primary">{formatPercent(metrics.scorePercent)}</span>
                    </div>
                    <Progress value={clampPercent(metrics.scorePercent)} className="mt-2 h-2" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs text-text-secondary">
                      <span>Accuracy</span>
                      <span className="font-semibold text-text-primary">{formatPercent(metrics.accuracyPercent)}</span>
                    </div>
                    <Progress value={clampPercent(metrics.accuracyPercent)} className="mt-2 h-2" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs text-text-secondary">
                      <span>Attempt rate</span>
                      <span className="font-semibold text-text-primary">{formatPercent(metrics.attemptRate)}</span>
                    </div>
                    <Progress value={clampPercent(metrics.attemptRate)} className="mt-2 h-2" />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs text-text-secondary">
                    <span className="flex items-center gap-2">
                      <Timer className="size-4 text-primary" />
                      Avg time per question
                    </span>
                    <span className="font-semibold text-text-primary">
                      {metrics.totalQuestions ? formatDuration(metrics.avgTimePerQuestion) : "-"}
                    </span>
                  </div>
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-lg font-semibold text-text-primary">Focus areas</h2>
                <p className="mt-1 text-sm text-text-secondary">Target your revision based on strengths and gaps.</p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-background p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Strongest topic</p>
                    <p className="mt-2 text-sm font-semibold text-text-primary">
                      {strongestTopic ? strongestTopic.topic : "Not enough data"}
                    </p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {strongestTopic ? `${formatPercent(strongestTopic.scorePercent)} score` : "Complete more items to unlock."}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Needs attention</p>
                    <p className="mt-2 text-sm font-semibold text-text-primary">
                      {weakestTopic ? weakestTopic.topic : "Not enough data"}
                    </p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {weakestTopic ? `${formatPercent(weakestTopic.scorePercent)} score` : "Keep practicing to reveal gaps."}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-border bg-muted/60 p-3 text-sm text-text-secondary">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Coaching note</p>
                  <p className="mt-2 text-sm text-text-primary">{guidance}</p>
                </div>
              </Card>
            </div>

            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">Topic performance</h2>
                  <p className="mt-1 text-sm text-text-secondary">Compare how you performed across topics.</p>
                </div>
                {sortedTopics.length > visibleTopics.length ? (
                  <Badge variant="secondary">Showing top {visibleTopics.length} of {sortedTopics.length}</Badge>
                ) : null}
              </div>

              {visibleTopics.length === 0 ? (
                <div className="mt-4">
                  <Empty className="border border-border">
                    <EmptyHeader>
                      <EmptyTitle>No Topic Data</EmptyTitle>
                      <EmptyDescription>
                        {showFullDetails
                          ? "Topic insights will appear once question details are available."
                          : "Topic insights unlock after the review window ends."}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {visibleTopics.map((topic) => (
                    <div key={topic.topic} className="rounded-xl border border-border bg-background p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-text-primary">{topic.topic}</p>
                        <p className="text-xs font-semibold text-text-secondary">{formatPercent(topic.scorePercent)}</p>
                      </div>
                      <Progress value={clampPercent(topic.scorePercent)} className="mt-2 h-2" />
                      <div className="mt-2 flex items-center justify-between text-xs text-text-secondary">
                        <span>
                          {topic.correct}/{topic.total} correct
                        </span>
                        <span>{formatPercent(topic.attemptRate)} attempted</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {!showFullDetails ? (
              <Card className="p-6">
                <h2 className="text-lg font-semibold text-text-primary">Result Summary</h2>
                <p className="mt-2 text-sm text-text-secondary">
                  Answers are hidden until the test is marked completed or the review window opens.
                </p>
                {endDate ? (
                  <p className="mt-1 text-xs text-text-secondary">Available after: {new Date(endDate).toLocaleString()}</p>
                ) : null}
              </Card>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="review" forceMount>
          {showFullDetails ? (
            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">Question Review</h2>
                    <p className="mt-1 text-sm text-text-secondary">
                      Filter, search, and compare your responses with the correct answers.
                    </p>
                  </div>
                  <Button type="button" onClick={() => setShowAnswers((prev) => !prev)}>
                    {showAnswers ? "Hide Answers" : "View Answers"}
                  </Button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_0.6fr_0.6fr_0.6fr]">
                  <InputGroup className="h-10">
                    <InputGroupAddon>
                      <Search className="size-4" />
                    </InputGroupAddon>
                    <InputGroupInput
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search question, topic, or answer"
                      aria-label="Search questions" />
                  </InputGroup>

                  <NativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <NativeSelectOption value="all">All statuses</NativeSelectOption>
                    <NativeSelectOption value="correct">Correct</NativeSelectOption>
                    <NativeSelectOption value="incorrect">Incorrect</NativeSelectOption>
                    <NativeSelectOption value="unanswered">Unanswered</NativeSelectOption>
                  </NativeSelect>

                  <NativeSelect value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
                    <NativeSelectOption value="all">All topics</NativeSelectOption>
                    {topicOptions.map((topic) => (
                      <NativeSelectOption key={topic} value={topic}>
                        {topic}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>

                  <NativeSelect value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
                    <NativeSelectOption value="order">Question order</NativeSelectOption>
                    <NativeSelectOption value="marks-desc">Marks high to low</NativeSelectOption>
                    <NativeSelectOption value="marks-asc">Marks low to high</NativeSelectOption>
                    <NativeSelectOption value="score-desc">Score % high to low</NativeSelectOption>
                    <NativeSelectOption value="score-asc">Score % low to high</NativeSelectOption>
                  </NativeSelect>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <ListFilter className="size-4" />
                  <span>
                    Showing {filteredBreakdown.length} of {breakdown.length || 0} questions
                  </span>
                  <Badge variant="secondary">Correct {metrics.correct}</Badge>
                  <Badge variant="destructive">Incorrect {metrics.incorrect}</Badge>
                  <Badge variant="pending">Unanswered {metrics.unanswered}</Badge>
                </div>
              </Card>

              <Card className="overflow-hidden">
                {breakdown.length === 0 ? (
                  <div className="p-6">
                    <Empty className="border border-border">
                      <EmptyHeader>
                        <EmptyTitle>No Question Breakdown</EmptyTitle>
                        <EmptyDescription>Question-level details are not available for this attempt.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </div>
                ) : filteredBreakdown.length === 0 ? (
                  <div className="p-6">
                    <Empty className="border border-border">
                      <EmptyHeader>
                        <EmptyTitle>No matches found</EmptyTitle>
                        <EmptyDescription>Try clearing filters or searching with a different term.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Q#</TableHead>
                        <TableHead className="min-w-65">Question</TableHead>
                        <TableHead className="min-w-45">Your answer</TableHead>
                        <TableHead className="min-w-45">Correct answer</TableHead>
                        <TableHead className="w-28">Marks</TableHead>
                        <TableHead className="w-28">Status</TableHead>
                        <TableHead className="w-32">Explanation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBreakdown.map((item) => {
                        const status = item.isAnswered
                          ? item.isCorrect
                            ? { label: "Correct", variant: "active", Icon: CheckCircle2 }
                            : { label: "Incorrect", variant: "destructive", Icon: XCircle }
                          : { label: "Unanswered", variant: "pending", Icon: Timer };

                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-semibold">Q{item.order}</TableCell>
                            <TableCell className="whitespace-normal">
                              <p className="text-sm font-semibold text-text-primary">{item.prompt}</p>
                              <p className="mt-1 text-xs text-text-secondary">{item.topic}</p>
                            </TableCell>
                            <TableCell className="whitespace-normal text-sm text-text-primary">{item.studentAnswer}</TableCell>
                            <TableCell className="whitespace-normal text-sm text-text-primary">
                              {showAnswers ? (
                                item.correctAnswer
                              ) : (
                                <span className="italic text-text-secondary">Hidden</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm font-semibold text-text-primary">
                              {item.marks}
                              {item.totalMarks > 0 ? ` / ${item.totalMarks}` : ""}
                            </TableCell>
                            <TableCell>
                              <Badge variant={status.variant} className="gap-1">
                                <status.Icon className="size-3" />
                                {status.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {item.explanationVideoUrl ? (
                                <a
                                  href={item.explanationVideoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                                >
                                  <PlayCircle className="size-4" />
                                  Watch
                                </a>
                              ) : (
                                <span className="text-xs italic text-text-secondary">No explanation</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </Card>
            </div>
          ) : (
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-text-primary">Result Summary</h2>
              <p className="mt-2 text-sm text-text-secondary">
                Answers are hidden until the test is marked completed or the review window opens.
              </p>
              {endDate ? (
                <p className="mt-1 text-xs text-text-secondary">Available after: {new Date(endDate).toLocaleString()}</p>
              ) : null}
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex justify-center">
        <Button type="button" variant="outline" onClick={() => navigate("/tests/ongoing")}>
          Return to Home
        </Button>
      </div>
    </div>
  );
}
