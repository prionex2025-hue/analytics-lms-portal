import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Award,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileX,
  Gauge,
  ListChecks,
  RotateCcw,
  Search,
  Trophy,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { studentApi } from "@/services/studentApi";
import { reportsQueryOptions } from "@/services/studentQueries";
import { ReportsSkeleton } from "@/components/common/page-skeletons";
import { EmptyState, ErrorState, PageHeader, Panel, SectionHeader, StatTile, StatusBadge } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
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

const getStatusTone = (status) => {
  const normalized = String(status || "").toUpperCase();
  if (["SUBMITTED", "COMPLETED", "COMPLETE", "AUTO SUBMITTED", "AUTO_SUBMITTED"].includes(normalized)) return "neutral";
  if (["FAILED", "FAIL", "ENDED", "EXPIRED"].includes(normalized)) return "danger";
  return "neutral";
};

const scoreBarClass = (value) => {
  if (value >= 80) return "bg-success";
  if (value >= 60) return "bg-primary";
  if (value >= PASS_PERCENT) return "bg-warning";
  return "bg-danger";
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

function ResultBadge({ result }) {
  const isPass = result === "PASS";
  return (
    <StatusBadge tone={isPass ? "success" : "danger"} icon={isPass ? CheckCircle2 : XCircle}>
      {isPass ? "Pass" : "Fail"}
    </StatusBadge>
  );
}

function ScoreCell({ value }) {
  return (
    <div className="flex items-center justify-end gap-2.5">
      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted xl:block" aria-hidden="true">
        <div className={cn("h-full rounded-full", scoreBarClass(value))} style={{ width: `${clampPercent(value)}%` }} />
      </div>
      <span className="w-14 text-right font-semibold tabular-nums text-text-primary">{formatPercent(value)}</span>
    </div>
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

  const hasActiveFilters =
    Boolean(searchTerm) || categoryFilter !== ALL_CATEGORIES_VALUE || resultFilter !== ALL_RESULTS_VALUE || Boolean(dateFrom) || Boolean(dateTo);

  const header = (
    <PageHeader
      title="Reports"
      description="Track every submitted test, follow your score trend, and open detailed results."
      actions={
        <Button
          className={ui.btn}
          onClick={() => exportMutation.mutate({ view: "overall" })}
          disabled={exportMutation.isPending || reportRows.length === 0 || reportsQuery.isLoading}
        >
          <Download className="size-4" />
          {exportMutation.isPending ? "Generating..." : "Export All PDF"}
        </Button>
      }
    />
  );

  if (reportsQuery.isLoading) {
    return (
      <section className={ui.pageSection}>
        {header}
        <ReportsSkeleton />
      </section>
    );
  }

  return (
    <section className={ui.pageSection}>
      {header}

      {reportsQuery.isError ? (
        <ErrorState
          title="Unable to load report"
          description={reportsQuery.error?.message || "Please refresh and try again."}
          onRetry={() => reportsQuery.refetch()}
        />
      ) : null}

      {!reportsQuery.isError ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={ListChecks} label="Tests Attempted" value={totalTests} hint="Submitted reports" />
            <StatTile icon={Gauge} label="Average Score" value={formatPercent(averageScore)} hint="Across completed tests" tone="primary" />
            <StatTile
              icon={Award}
              label="Pass Rate"
              value={formatPercent(passRate)}
              hint={`${passCount}/${totalTests || 0} tests passed`}
              tone={passRate >= 70 ? "success" : "warning"}
            />
            <StatTile icon={Clock3} label="Total Test Time" value={formatDuration(totalTimeSeconds)} hint="Recorded attempt time" tone="neutral" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Suspense fallback={<div className="h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />}>
              <ReportsLineChart data={lineData} />
            </Suspense>

            <Panel className="flex flex-col">
              <SectionHeader as="h3" title="Score distribution" description="How your results spread across score bands." />
              <div className="mt-5 space-y-4">
                {scoreBands.map((band) => (
                  <div key={band.label}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="text-text-secondary">{band.label}%</span>
                      <span className="font-medium tabular-nums text-text-primary">
                        {band.count} {band.count === 1 ? "test" : "tests"}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", band.tone)}
                        style={{ width: band.count ? `${Math.max(4, (band.count / maxBandCount) * 100)}%` : "0%" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-5">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/15 text-amber-600">
                    <Trophy className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-text-secondary">Best performance</p>
                    <p className="truncate text-sm font-medium text-text-primary">{bestAttempt?.testName || "No tests yet"}</p>
                  </div>
                  <p className="text-lg font-semibold tabular-nums text-text-primary">{bestAttempt ? formatPercent(bestAttempt.scorePercent) : "--"}</p>
                </div>
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <Suspense fallback={<div className="h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />}>
              {showBarFallback ? <ReportsBarChart data={topicData} /> : <ReportsRadarChart data={topicData} />}
            </Suspense>

            <Panel>
              <SectionHeader as="h3" title="Recent results" description="Your latest submissions at a glance." />
              {reportRows.length === 0 ? (
                <p className="mt-5 rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-secondary">No submitted reports yet.</p>
              ) : (
                <ul className="mt-4 divide-y divide-border">
                  {reportRows.slice(0, 5).map((row) => (
                    <li key={row.serialKey}>
                      <button
                        type="button"
                        onClick={() => openReport(row)}
                        disabled={!row.attemptId}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text-primary">{row.testName}</p>
                          <p className="mt-0.5 text-xs text-text-secondary">{formatDate(row.submittedAt)} · {row.category}</p>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-text-primary">{formatPercent(row.scorePercent)}</span>
                        <ResultBadge result={row.result} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className={cn(ui.card, "overflow-hidden")}>
            <div className="border-b border-border p-4 sm:p-5">
              <SectionHeader
                title="All test reports"
                description="Search, filter, and open any submitted assessment."
                count={filteredRows.length}
              />

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]">
                <div className="relative sm:col-span-2 lg:col-span-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search by name or code"
                    aria-label="Search reports"
                    className={cn(ui.field, "pl-9")}
                  />
                </div>
                <NativeSelect value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={cn("w-full", ui.select)} aria-label="Category">
                  <option value={ALL_CATEGORIES_VALUE}>All categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </NativeSelect>
                <NativeSelect value={resultFilter} onChange={(event) => setResultFilter(event.target.value)} className={cn("w-full", ui.select)} aria-label="Result">
                  <option value={ALL_RESULTS_VALUE}>All results</option>
                  <option value="PASS">Pass</option>
                  <option value="FAIL">Fail</option>
                </NativeSelect>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs font-medium text-text-secondary" aria-hidden="true">From</span>
                  <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Submitted from" className={cn(ui.field, "pl-12")} />
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs font-medium text-text-secondary" aria-hidden="true">To</span>
                  <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Submitted to" className={cn(ui.field, "pl-10")} />
                </div>
                <Button type="button" variant="ghost" className={cn(ui.btn, "justify-self-start text-text-secondary lg:justify-self-auto")} onClick={clearFilters} disabled={!hasActiveFilters}>
                  <RotateCcw className="size-4" />
                  Reset
                </Button>
              </div>
            </div>

            {filteredRows.length > 0 ? (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="w-12 pl-5 text-xs font-medium uppercase tracking-wide">#</TableHead>
                        <TableHead className="min-w-64 text-xs font-medium uppercase tracking-wide">Assessment</TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide">Code</TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide">Submitted</TableHead>
                        <TableHead className="text-right text-xs font-medium uppercase tracking-wide">Score</TableHead>
                        <TableHead className="text-right text-xs font-medium uppercase tracking-wide">Marks</TableHead>
                        <TableHead className="text-right text-xs font-medium uppercase tracking-wide">Time</TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide">Result</TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide">Status</TableHead>
                        <TableHead className="pr-5 text-right text-xs font-medium uppercase tracking-wide">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedRows.map((row, index) => (
                        <TableRow key={row.serialKey} className="h-14">
                          <TableCell className="pl-5 tabular-nums text-text-secondary">{pageStart + index}</TableCell>
                          <TableCell>
                            <p className="font-medium text-text-primary">{row.testName}</p>
                            <p className="text-xs text-text-secondary">{row.category}</p>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-text-secondary">{row.testCode}</TableCell>
                          <TableCell className="text-text-secondary">{formatDate(row.submittedAt)}</TableCell>
                          <TableCell><ScoreCell value={row.scorePercent} /></TableCell>
                          <TableCell className="text-right tabular-nums text-text-secondary">{formatMarksPair(row.obtainedMarks, row.totalMarks)}</TableCell>
                          <TableCell className="text-right tabular-nums text-text-secondary">{formatDuration(row.timeSpentSeconds)}</TableCell>
                          <TableCell><ResultBadge result={row.result} /></TableCell>
                          <TableCell>
                            <StatusBadge tone={getStatusTone(row.status)} className="capitalize">{row.status.toLowerCase()}</StatusBadge>
                          </TableCell>
                          <TableCell className="pr-5">
                            <div className="flex justify-end gap-1">
                              <Button type="button" variant="ghost" size="icon-lg" title="View detailed report" aria-label={`View report for ${row.testName}`} onClick={() => openReport(row)} disabled={!row.attemptId}>
                                <Eye className="size-4" />
                              </Button>
                              <Button type="button" variant="ghost" size="icon-lg" title="Download this test report" aria-label={`Download PDF for ${row.testName}`} onClick={() => exportSingleTest(row)} disabled={exportMutation.isPending || !row.testId}>
                                <Download className="size-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <ul className="divide-y divide-border lg:hidden">
                  {paginatedRows.map((row, index) => (
                    <li key={row.serialKey} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-text-secondary">#{pageStart + index} · <span className="font-mono">{row.testCode}</span></p>
                          <h3 className="mt-0.5 line-clamp-2 font-semibold text-text-primary">{row.testName}</h3>
                          <p className="mt-0.5 text-xs text-text-secondary">{row.category} · {formatDate(row.submittedAt)}</p>
                        </div>
                        <ResultBadge result={row.result} />
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-lg bg-muted/60 p-2"><dt className="text-text-secondary">Score</dt><dd className="mt-0.5 font-semibold tabular-nums text-text-primary">{formatPercent(row.scorePercent)}</dd></div>
                        <div className="rounded-lg bg-muted/60 p-2"><dt className="text-text-secondary">Marks</dt><dd className="mt-0.5 font-semibold tabular-nums text-text-primary">{formatMarksPair(row.obtainedMarks, row.totalMarks)}</dd></div>
                        <div className="rounded-lg bg-muted/60 p-2"><dt className="text-text-secondary">Time</dt><dd className="mt-0.5 font-semibold tabular-nums text-text-primary">{formatDuration(row.timeSpentSeconds)}</dd></div>
                      </dl>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="outline" className={ui.btn} onClick={() => openReport(row)} disabled={!row.attemptId}>
                          <Eye className="size-4" />
                          View
                        </Button>
                        <Button variant="outline" className={ui.btn} onClick={() => exportSingleTest(row)} disabled={exportMutation.isPending || !row.testId}>
                          <Download className="size-4" />
                          PDF
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:px-5 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
                    <span className="tabular-nums">Showing {pageStart}–{pageEnd} of {filteredRows.length}</span>
                    <NativeSelect value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Rows per page">
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
                          aria-disabled={safePage === 1}
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
                          aria-disabled={safePage === totalPages}
                          className={safePage === totalPages ? "pointer-events-none opacity-50" : ""}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              </>
            ) : (
              <div className="p-4 sm:p-5">
                <EmptyState
                  icon={FileX}
                  title={hasActiveFilters ? "No reports match your filters" : "No test reports yet"}
                  description={hasActiveFilters ? "Try adjusting or clearing the filters." : "Submit a test to see your analytics here."}
                  action={
                    hasActiveFilters ? (
                      <Button variant="outline" className={ui.btn} onClick={clearFilters}>
                        <RotateCcw className="size-4" />
                        Clear filters
                      </Button>
                    ) : null
                  }
                  className="border-0"
                />
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
