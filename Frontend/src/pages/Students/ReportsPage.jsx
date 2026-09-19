import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Award,
  CalendarDays,
  Clock3,
  Download,
  Eye,
  FileX,
  Gauge,
  ListChecks,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { studentApi } from "@/services/studentApi";
import { reportsQueryOptions } from "@/services/studentQueries";
import { ui } from "@/styles/ui-tokens";

const ReportsLineChart = lazy(() =>
  import("@/components/Students/reports-charts/ReportsLineChart").then((module) => ({ default: module.ReportsLineChart }))
);
const ReportsRadarChart = lazy(() =>
  import("@/components/Students/reports-charts/ReportsRadarChart").then((module) => ({ default: module.ReportsRadarChart }))
);
const ReportsBarChart = lazy(() =>
  import("@/components/Students/reports-charts/ReportsBarChart").then((module) => ({ default: module.ReportsBarChart }))
);

const ALL_CATEGORIES_VALUE = "__all_categories__";
const ALL_RESULTS_VALUE = "__all_results__";
const PAGE_SIZE_OPTIONS = [5, 10, 20];
const PASS_PERCENT = 40;

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clampPercent = (value) => Math.max(0, Math.min(100, toNum(value, 0)));

const formatPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `${clampPercent(num).toFixed(1)}%`;
};

const formatMarksPair = (obtained, total) => {
  const obtainedNum = Number(obtained);
  const totalNum = Number(total);
  if (!Number.isFinite(obtainedNum) || !Number.isFinite(totalNum) || totalNum <= 0) {
    return "--";
  }
  return `${obtainedNum}/${totalNum}`;
};

const formatDate = (dateInput) => {
  if (!dateInput) return "--";
  const date = new Date(dateInput);
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

const formatDuration = (secondsInput) => {
  const totalSeconds = Math.max(0, Math.round(toNum(secondsInput, 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const normalizeStatus = (value, fallback = "Submitted") => {
  const text = String(value || fallback).replace(/_/g, " ").trim();
  return text || fallback;
};

const getStatusVariant = (status) => {
  const normalized = String(status || "").toUpperCase();
  if (["SUBMITTED", "COMPLETED", "COMPLETE", "AUTO SUBMITTED", "AUTO_SUBMITTED"].includes(normalized)) return "active";
  if (["FAILED", "FAIL", "ENDED", "EXPIRED"].includes(normalized)) return "destructive";
  return "secondary";
};

const getScoreFromRow = (row) => clampPercent(row?.scorePercent ?? row?.score_percent ?? row?.accuracy ?? row?.score ?? 0);
const getAttemptId = (row) => row?.submissionId || row?.submission_id || row?.attemptId || row?.attempt_id || "";
const getTestId = (row) => row?.testId || row?.test_id || row?.id || "";

const getTestCode = (row) => {
  const explicit = row?.testCode || row?.test_code || row?.assessmentCode || row?.assessment_code;
  if (explicit) return String(explicit);
  const testId = String(getTestId(row) || "");
  return testId ? `T-${testId.slice(-8).toUpperCase()}` : "--";
};

const normalizeReportRows = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const scorePercent = getScoreFromRow(row);
      const submittedAt = row?.submittedAt || row?.submitted_at || row?.date || row?.createdAt || row?.created_at || null;
      const status = normalizeStatus(row?.status || row?.submissionStatus || row?.submission_status, "Submitted");

      return {
        id: getAttemptId(row) || getTestId(row) || `report-${index}`,
        serialKey: `${getAttemptId(row) || getTestId(row) || index}-${submittedAt || index}`,
        attemptId: getAttemptId(row),
        testId: getTestId(row),
        testName: row?.testName || row?.test_name || row?.title || row?.name || "Untitled test",
        testCode: getTestCode(row),
        category: row?.category || row?.assessmentCategory || row?.assessment_category || row?.subject || "General",
        submittedAt,
        scorePercent,
        obtainedMarks: row?.obtainedMarks ?? row?.obtained_marks ?? null,
        totalMarks: row?.totalMarks ?? row?.total_marks ?? null,
        timeSpentSeconds: row?.timeSpentSeconds ?? row?.time_spent_seconds ?? row?.timeTaken ?? row?.time_taken ?? 0,
        status,
        result: scorePercent >= PASS_PERCENT ? "PASS" : "FAIL",
      };
    })
    .sort((a, b) => {
      const aTime = new Date(a.submittedAt || 0).getTime();
      const bTime = new Date(b.submittedAt || 0).getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });

const getPageNumbers = (page, totalPages) => {
  const start = Math.max(1, page - 1);
  const end = Math.min(totalPages, page + 1);
  const pages = [];

  for (let item = start; item <= end; item += 1) {
    pages.push(item);
  }

  if (!pages.includes(1)) pages.unshift(1);
  if (!pages.includes(totalPages)) pages.push(totalPages);
  return [...new Set(pages)];
};

function MetricCard({ icon: Icon, label, value, sub, tone = "primary" }) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-danger/15 text-danger",
  }[tone];

  return (
    <Card className="rounded-2xl border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-text-secondary uppercase">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-text-primary">{value}</p>
          {sub ? <p className="mt-1 text-xs text-text-secondary">{sub}</p> : null}
        </div>
        <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${toneClass}`}>
          <Icon className="size-4" />
        </div>
      </div>
    </Card>
  );
}

function ResultBadge({ result }) {
  const isPass = result === "PASS";
  return (
    <Badge variant={isPass ? "active" : "destructive"} className="font-semibold">
      {result}
    </Badge>
  );
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES_VALUE);
  const [resultFilter, setResultFilter] = useState(ALL_RESULTS_VALUE);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const reportsQuery = useQuery({
    ...reportsQueryOptions({ view: "overall" }),
    enabled: true,
  });

  const exportMutation = useMutation({
    mutationFn: async (filters = { view: "overall" }) => studentApi.exportReportsPdf(filters),
    onSuccess: (payload) => {
      const signedUrl = payload?.signed_url || payload?.signedUrl || payload?.url;
      if (!signedUrl) {
        toast.error("Export completed but file URL was not returned.");
        return;
      }

      const opened = window.open(signedUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        const link = document.createElement("a");
        link.href = signedUrl;
        link.download = payload?.filename || "student-report.pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      if (typeof payload?.revoke === "function") {
        window.setTimeout(() => payload.revoke(), 60_000);
      }

      toast.success("Report export is ready.");
    },
    onError: (error) => {
      toast.error(error?.message || "Unable to export report. Please retry.");
    },
  });

  const raw = useMemo(() => reportsQuery.data || {}, [reportsQuery.data]);
  const overall = raw?.overall || {};
  const summary = overall?.summary || {};
  const reportRows = useMemo(() => normalizeReportRows(raw?.testWise || raw?.test_wise || []), [raw]);

  const categories = useMemo(
    () => [...new Set(reportRows.map((row) => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [reportRows]
  );

  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(dateFrom).setHours(0, 0, 0, 0) : null;
    const toMs = dateTo ? new Date(dateTo).setHours(23, 59, 59, 999) : null;

    return reportRows.filter((row) => {
      const haystack = `${row.testName} ${row.testCode} ${row.category} ${row.status}`.toLowerCase();
      const submittedMs = row.submittedAt ? new Date(row.submittedAt).getTime() : null;

      if (query && !haystack.includes(query)) return false;
      if (categoryFilter !== ALL_CATEGORIES_VALUE && row.category !== categoryFilter) return false;
      if (resultFilter !== ALL_RESULTS_VALUE && row.result !== resultFilter) return false;
      if (fromMs && (!submittedMs || submittedMs < fromMs)) return false;
      if (toMs && (!submittedMs || submittedMs > toMs)) return false;
      return true;
    });
  }, [categoryFilter, dateFrom, dateTo, reportRows, resultFilter, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = filteredRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(filteredRows.length, safePage * pageSize);
  const paginatedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [categoryFilter, dateFrom, dateTo, pageSize, resultFilter, searchTerm]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const totalTests = reportRows.length;
  const averageScore =
    totalTests > 0 ? reportRows.reduce((sum, row) => sum + row.scorePercent, 0) / totalTests : toNum(summary?.avg_score ?? overall?.accuracy, 0);
  const bestAttempt = reportRows.reduce((best, row) => (!best || row.scorePercent > best.scorePercent ? row : best), null);
  const passCount = reportRows.filter((row) => row.result === "PASS").length;
  const passRate = totalTests > 0 ? (passCount / totalTests) * 100 : 0;
  const totalTimeSeconds = reportRows.reduce((sum, row) => sum + toNum(row.timeSpentSeconds, 0), 0);

  const lineData = overall?.line_chart || overall?.score_trend || raw?.charts?.lineChart || reportRows;
  const topicData = overall?.topic_performance || overall?.topic_wise || raw?.charts?.radarChart || [];
  const showBarFallback = Array.isArray(topicData) && topicData.length > 0 && topicData.length < 3;

  const scoreBands = [
    { label: "0-39", count: reportRows.filter((row) => row.scorePercent < 40).length, tone: "bg-danger" },
    { label: "40-59", count: reportRows.filter((row) => row.scorePercent >= 40 && row.scorePercent < 60).length, tone: "bg-warning" },
    { label: "60-79", count: reportRows.filter((row) => row.scorePercent >= 60 && row.scorePercent < 80).length, tone: "bg-primary" },
    { label: "80-100", count: reportRows.filter((row) => row.scorePercent >= 80).length, tone: "bg-success" },
  ];
  const maxBandCount = Math.max(1, ...scoreBands.map((band) => band.count));

  const clearFilters = () => {
    setSearchTerm("");
    setCategoryFilter(ALL_CATEGORIES_VALUE);
    setResultFilter(ALL_RESULTS_VALUE);
    setDateFrom("");
    setDateTo("");
  };

  const openReport = (row) => {
    if (!row.attemptId) {
      toast.error("Detailed result is unavailable for this test.");
      return;
    }
    navigate(`/results/${row.attemptId}`);
  };

  const exportSingleTest = (row) => {
    if (!row.testId) {
      toast.error("Test report export is unavailable for this record.");
      return;
    }
    exportMutation.mutate({ view: "by_test", test_id: row.testId });
  };

  return (
    <section className={ui.pageSection}>
      <Card className="overflow-hidden rounded-3xl border border-primary/20 bg-linear-to-br from-primary-dark via-primary to-primary-dark text-primary-foreground shadow-[0_22px_50px_-24px_rgba(11,84,158,0.75)]">
        <div className="grid gap-6 p-5 md:p-7 lg:grid-cols-[1.4fr_0.9fr] lg:items-end">
          <div>
            <div className="flex items-center gap-2 text-primary-foreground/90">
              <Sparkles className="size-4" />
              <p className="text-xs font-semibold tracking-[0.16em] uppercase">Reports Dashboard</p>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Your performance command center</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-primary-foreground/85">
              Track every submitted test, understand your score trend, and jump straight into detailed reports without selecting a test first.
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.12em] text-primary-foreground/75 uppercase">Best performance</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{bestAttempt?.testName || "No tests yet"}</p>
                <p className="mt-1 text-sm text-primary-foreground/75">{bestAttempt ? formatDate(bestAttempt.submittedAt) : "Complete a test to unlock insights"}</p>
              </div>
              <p className="text-3xl font-bold">{bestAttempt ? formatPercent(bestAttempt.scorePercent) : "--"}</p>
            </div>
          </div>
        </div>
      </Card>

      {reportsQuery.isLoading ? (
        <div className="grid min-h-[40vh] place-items-center rounded-2xl border border-border bg-card text-text-secondary">Loading reports...</div>
      ) : null}

      {reportsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load report</AlertTitle>
          <AlertDescription>{reportsQuery.error?.message || "Please refresh and try again."}</AlertDescription>
        </Alert>
      ) : null}

      {!reportsQuery.isLoading && !reportsQuery.isError ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={ListChecks} label="Tests Attempted" value={totalTests} sub="Submitted reports" />
            <MetricCard icon={Gauge} label="Average Score" value={formatPercent(averageScore)} sub="Across completed tests" tone="success" />
            <MetricCard icon={Award} label="Pass Rate" value={formatPercent(passRate)} sub={`${passCount}/${totalTests || 0} tests passed`} tone={passRate >= 70 ? "success" : "warning"} />
            <MetricCard icon={Clock3} label="Total Test Time" value={formatDuration(totalTimeSeconds)} sub="Recorded attempt time" tone="primary" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
            <Suspense fallback={<div className="rounded-xl border border-border bg-card p-5 text-text-secondary">Loading chart...</div>}>
              <ReportsLineChart data={lineData} />
            </Suspense>

            <Card className="rounded-2xl border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-text-primary">Score Distribution</h3>
                  <p className="text-sm text-text-secondary">How your reports are spread across score bands.</p>
                </div>
                <Target className="size-5 text-primary" />
              </div>
              <div className="mt-5 space-y-4">
                {scoreBands.map((band) => (
                  <div key={band.label}>
                    <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                      <span>{band.label}%</span>
                      <span>{band.count} tests</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${band.tone}`} style={{ width: `${Math.max(4, (band.count / maxBandCount) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Suspense fallback={<div className="rounded-xl border border-border bg-card p-5 text-text-secondary">Loading chart...</div>}>
              {showBarFallback ? <ReportsBarChart data={topicData} /> : <ReportsRadarChart data={topicData} />}
            </Suspense>

            <Card className="rounded-2xl border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-text-primary">Recent Momentum</h3>
                  <p className="text-sm text-text-secondary">Your latest submitted reports at a glance.</p>
                </div>
                <TrendingUp className="size-5 text-primary" />
              </div>
              <div className="mt-5 space-y-3">
                {reportRows.slice(0, 4).map((row) => (
                  <div key={row.serialKey} className="rounded-xl border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text-primary">{row.testName}</p>
                        <p className="mt-1 text-xs text-text-secondary">{formatDate(row.submittedAt)}</p>
                      </div>
                      <ResultBadge result={row.result} />
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <Progress value={row.scorePercent} className="h-2 bg-muted **:data-[slot=progress-indicator]:bg-primary-dark" />
                      <span className="w-12 text-right text-xs font-semibold text-text-primary">{formatPercent(row.scorePercent)}</span>
                    </div>
                  </div>
                ))}
                {reportRows.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-5 text-sm text-text-secondary">No submitted reports yet.</p>
                ) : null}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm">
            <div className="border-b border-border bg-background/60 p-4 md:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-text-primary">All Test Reports</h2>
                  <p className="mt-1 text-sm text-text-secondary">Every submitted assessment is listed below with pagination and quick actions.</p>
                </div>
                <Button onClick={() => exportMutation.mutate({ view: "overall" })} disabled={exportMutation.isPending || reportRows.length === 0}>
                  <Download className="mr-2 size-4" />
                  {exportMutation.isPending ? "Generating..." : "Export All PDF"}
                </Button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.25fr_0.8fr_0.7fr_0.65fr_0.65fr_auto]">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary" />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search assessment name or code"
                    className="pl-9"
                  />
                </div>
                <NativeSelect value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="w-full">
                  <option value={ALL_CATEGORIES_VALUE}>All categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </NativeSelect>
                <NativeSelect value={resultFilter} onChange={(event) => setResultFilter(event.target.value)} className="w-full">
                  <option value={ALL_RESULTS_VALUE}>All results</option>
                  <option value="PASS">Pass</option>
                  <option value="FAIL">Fail</option>
                </NativeSelect>
                <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Date from" />
                <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Date to" />
                <Button type="button" variant="outline" onClick={clearFilters}>
                  <RotateCcw className="mr-2 size-4" />
                  Reset
                </Button>
              </div>
            </div>

            {filteredRows.length > 0 ? (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary/10 hover:bg-primary/10">
                        <TableHead className="w-16 text-center font-semibold text-text-primary">S.No</TableHead>
                        <TableHead className="min-w-72 font-semibold text-text-primary">Assessment Name</TableHead>
                        <TableHead className="min-w-40 font-semibold text-text-primary">Assessment Code</TableHead>
                        <TableHead className="min-w-36 font-semibold text-text-primary">Category</TableHead>
                        <TableHead className="min-w-36 font-semibold text-text-primary">Submitted Date</TableHead>
                        <TableHead className="text-right font-semibold text-text-primary">Score</TableHead>
                        <TableHead className="text-right font-semibold text-text-primary">Marks</TableHead>
                        <TableHead className="text-right font-semibold text-text-primary">Time Taken</TableHead>
                        <TableHead className="text-center font-semibold text-text-primary">Result</TableHead>
                        <TableHead className="text-center font-semibold text-text-primary">Status</TableHead>
                        <TableHead className="text-center font-semibold text-text-primary">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedRows.map((row, index) => (
                        <TableRow key={row.serialKey} className="odd:bg-background/60">
                          <TableCell className="text-center text-text-secondary">{pageStart + index}</TableCell>
                          <TableCell>
                            <div className="min-w-0">
                              <p className="font-medium text-text-primary">{row.testName}</p>
                              <p className="text-xs text-text-secondary">{row.category}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-text-secondary">{row.testCode}</TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-sm text-text-secondary">
                              <CalendarDays className="size-3.5" />
                              {formatDate(row.submittedAt)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-text-primary">{formatPercent(row.scorePercent)}</TableCell>
                          <TableCell className="text-right text-text-secondary">{formatMarksPair(row.obtainedMarks, row.totalMarks)}</TableCell>
                          <TableCell className="text-right text-text-secondary">{formatDuration(row.timeSpentSeconds)}</TableCell>
                          <TableCell className="text-center"><ResultBadge result={row.result} /></TableCell>
                          <TableCell className="text-center">
                            <Badge variant={getStatusVariant(row.status)}>{row.status}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-center gap-2">
                              <Button type="button" variant="outline" size="icon" title="View detailed report" onClick={() => openReport(row)} disabled={!row.attemptId}>
                                <Eye className="size-4" />
                              </Button>
                              <Button type="button" variant="outline" size="icon" title="Download this test report" onClick={() => exportSingleTest(row)} disabled={exportMutation.isPending || !row.testId}>
                                <Download className="size-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-3 p-4 lg:hidden">
                  {paginatedRows.map((row, index) => (
                    <Card key={row.serialKey} className="rounded-xl border-border bg-background p-4 shadow-none">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-text-secondary">#{pageStart + index} · {row.testCode}</p>
                          <h3 className="mt-1 line-clamp-2 font-semibold text-text-primary">{row.testName}</h3>
                          <p className="mt-1 text-xs text-text-secondary">{row.category} · {formatDate(row.submittedAt)}</p>
                        </div>
                        <ResultBadge result={row.result} />
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-lg bg-card p-2"><p className="text-text-secondary">Score</p><p className="font-semibold text-text-primary">{formatPercent(row.scorePercent)}</p></div>
                        <div className="rounded-lg bg-card p-2"><p className="text-text-secondary">Marks</p><p className="font-semibold text-text-primary">{formatMarksPair(row.obtainedMarks, row.totalMarks)}</p></div>
                        <div className="rounded-lg bg-card p-2"><p className="text-text-secondary">Time</p><p className="font-semibold text-text-primary">{formatDuration(row.timeSpentSeconds)}</p></div>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <Button className="flex-1" variant="outline" onClick={() => openReport(row)} disabled={!row.attemptId}>
                          <Eye className="mr-2 size-4" />
                          View
                        </Button>
                        <Button className="flex-1" variant="outline" onClick={() => exportSingleTest(row)} disabled={exportMutation.isPending || !row.testId}>
                          <Download className="mr-2 size-4" />
                          PDF
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>

                <div className="flex flex-col gap-4 border-t border-border p-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
                    <span>Showing {pageStart}-{pageEnd} of {filteredRows.length} reports</span>
                    <NativeSelect value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value))}>
                      {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} / page</option>)}
                    </NativeSelect>
                  </div>

                  <Pagination className="mx-0 w-auto justify-start md:justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(event) => {
                            event.preventDefault();
                            setPage((current) => Math.max(1, current - 1));
                          }}
                          className={safePage === 1 ? "pointer-events-none opacity-50" : ""}
                        />
                      </PaginationItem>
                      {getPageNumbers(safePage, totalPages).map((pageNumber) => (
                        <PaginationItem key={pageNumber}>
                          <PaginationLink
                            href="#"
                            isActive={pageNumber === safePage}
                            onClick={(event) => {
                              event.preventDefault();
                              setPage(pageNumber);
                            }}
                          >
                            {pageNumber}
                          </PaginationLink>
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(event) => {
                            event.preventDefault();
                            setPage((current) => Math.min(totalPages, current + 1));
                          }}
                          className={safePage === totalPages ? "pointer-events-none opacity-50" : ""}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              </>
            ) : (
              <div className="p-6">
                <Empty className="border border-border">
                  <EmptyMedia variant="icon">
                    <FileX className="size-4" />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>No test reports found</EmptyTitle>
                    <EmptyDescription>Try clearing filters, or submit a test to see your analytics here.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </section>
  );
}
