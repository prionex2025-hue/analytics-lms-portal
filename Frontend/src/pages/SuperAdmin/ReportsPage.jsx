import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { superAdminApi } from "@/services/api";
import {
  AbsentStudentsCard,
  AnalyticsSkeleton,
  AreaTrendChart,
  Avatar,
  ChartCard,
  DeepDiveHeader,
  EmptyState,
  ExportButton,
  GroupedBarChart,
  InsightCard,
  LineTrendChart,
  Pagination,
  ResultBadge,
  ScoreBadge,
  DistributionSummary,
  ScoreDonutChart,
  StatCard,
  StatusBadge,
  TabNav,
  Th,
  TopicPieChart,
  ViolationBadge,
} from "@/components/Reports/components";
import { AtRiskView, IntegrityView, ItemAnalysisView, TrendsView } from "@/components/Reports/advanced-views";
import { clampPercent, formatDateLabel, formatPercent, toExportErrorMessage, toQueryString } from "@/components/Reports/utils";

const REPORT_MODES = [
  { key: "overview", label: "College" },
  { key: "departments", label: "Departments" },
  { key: "batch", label: "Batch" },
  { key: "student", label: "Student" },
  { key: "trends", label: "Trends" },
  { key: "at-risk", label: "At Risk" },
];

const DEEP_DIVE_VIEWS = [
  { key: "performance", label: "Performance" },
  { key: "items", label: "Question Analysis" },
  { key: "integrity", label: "Integrity" },
];

const TEST_STATUS_VARIANT = {
  LIVE: "info",
  COMPLETED: "success",
  SCHEDULED: "warning",
  DRAFT: "default",
  ARCHIVED: "default",
};

const MODE_DEFAULT_SORT = {
  overview: { key: "avgScore", dir: "desc" },
  departments: { key: "avgScore", dir: "desc" },
  batch: { key: "avgScore", dir: "desc" },
  student: { key: "rank", dir: "asc" },
  trends: { key: "avgScore", dir: "desc" },
  "at-risk": { key: "avgScore", dir: "desc" },
};

const TEST_SORT_OPTIONS = [
  { value: "startsAt", label: "Most recent" },
  { value: "avgScore", label: "Avg score" },
  { value: "participation", label: "Participation" },
  { value: "passRate", label: "Pass rate" },
  { value: "violations", label: "Violations" },
];
const YEAR_OPTIONS = ["1", "2", "3", "4"];
const STUDENT_SCOPE_OPTIONS = [
  { value: "current", label: "Current" },
  { value: "passout", label: "Passed Out" },
  { value: "all", label: "All" },
];

const NUMERIC_SORT_KEYS = new Set([
  "rank",
  "students",
  "submissions",
  "avgScore",
  "passRate",
  "participation",
  "testsTaken",
  "violations",
  "year",
  "scorePercent",
  "obtainedMarks",
  "timeTaken",
  "violationsCount",
]);

const toNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

const getSortValue = (row, key) => {
  if (!row) return null;
  if (key === "date") {
    const time = new Date(row.date || 0).getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (NUMERIC_SORT_KEYS.has(key)) return toNumber(row[key]);
  return row[key] ?? null;
};

const sortRows = (rows, sortState) => {
  if (!Array.isArray(rows) || !rows.length) return [];
  const { key, dir } = sortState || {};
  if (!key) return [...rows];
  const factor = dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = getSortValue(a, key);
    const bv = getSortValue(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
};

const MODULE_SHORT_LABEL = { QUANT: "Quant", REASONING: "Reasoning", VERBAL: "Verbal" };
const moduleShortLabel = (key) => MODULE_SHORT_LABEL[key] || key;

// MODULE_TEST only: module columns come from the analytics payload's server
// module definitions (test-type driven and pagination-independent), falling back
// to the first result row's moduleScores for legacy responses.
const moduleColumnDefs = (rows, modulePerformance = {}) =>
  Array.isArray(modulePerformance.modules) && modulePerformance.modules.length
    ? modulePerformance.modules
    : Array.isArray(rows) && rows[0]?.moduleScores?.length
      ? rows[0].moduleScores
      : [];

const modulePercentageFor = (row, mod) => {
  const score = (Array.isArray(row?.moduleScores) ? row.moduleScores : []).find((item) => item.key === mod.key);
  return score ? score.percentage : null;
};

function RecentExports({ reports, onDownload }) {
  const rows = Array.isArray(reports) ? reports.slice(0, 4) : [];

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-text-primary">Recent Exports</h3>
        <p className="text-xs text-text-secondary">Generated PDFs for super admin reports.</p>
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((job) => {
            const status = String(job.status || "QUEUED").toLowerCase();
            return (
              <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">{String(job.type || "REPORT").replace(/_/g, " ")}</p>
                  <p className="text-xs text-text-secondary">{formatDateLabel(job.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge label={status} variant={status === "completed" ? "success" : status === "failed" ? "danger" : "warning"} />
                  {status === "completed" ? (
                    <button
                      type="button"
                      onClick={() => onDownload(job.id)}
                      className="rounded-lg border border-border px-3 py-1 text-xs font-semibold hover:bg-muted"
                    >
                      Download
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No exports yet" description="Generated report PDFs will appear here." />
      )}
    </article>
  );
}

function StudentSummary({ student, metrics }) {
  if (!student) return null;
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-chart-1/10 text-xl font-bold text-chart-1">
          {String(student.name || "?")
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-text-primary">{student.name}</p>
          <p className="text-xs text-text-secondary">
            {student.studentId || "-"} - {student.college || "-"} - {student.department || "-"} - {student.batch || "-"}
          </p>
          <p className="text-xs text-text-secondary">Year: {student.year ? `${student.year} YEAR` : "-"}</p>
        </div>
        <div className="grid min-w-60 grid-cols-2 gap-4 text-center sm:grid-cols-4">
          <div>
            <p className="text-2xl font-bold tabular-nums text-text-primary">{formatPercent(metrics?.avgScore)}</p>
            <p className="text-[11px] text-text-secondary">avg score</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-text-primary">#{student.rank || "-"}</p>
            <p className="text-[11px] text-text-secondary">rank</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-text-primary">{toNumber(metrics?.totalSubmissions)}</p>
            <p className="text-[11px] text-text-secondary">attempts</p>
          </div>
          <div>
            <p className={`text-2xl font-bold tabular-nums ${toNumber(metrics?.violations) > 0 ? "text-red-500" : "text-green-500"}`}>
              {toNumber(metrics?.violations)}
            </p>
            <p className="text-[11px] text-text-secondary">violations</p>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = REPORT_MODES.some((item) => item.key === searchParams.get("mode")) ? searchParams.get("mode") : "overview";
  const collegeId = searchParams.get("college") || "";
  const departmentId = searchParams.get("department") || "";
  const testId = searchParams.get("test") || "all";
  const studentId = searchParams.get("student_id") || "";
  const rawStudentScope = searchParams.get("student_scope") || "current";
  const studentScope = STUDENT_SCOPE_OPTIONS.some((item) => item.value === rawStudentScope) ? rawStudentScope : "current";
  const passoutYear = searchParams.get("passout_year") || "";
  const passoutCohortId = searchParams.get("passout_cohort") || "";
  const batchId = searchParams.get("batch_id") || "";
  const hasCollegeSelected = Boolean(collegeId);
  const isTestDeepDive = Boolean(testId) && testId !== "all";

  const [studentSearch, setStudentSearch] = useState("");
  const [studentYear, setStudentYear] = useState("");
  const [studentVisibleLimit, setStudentVisibleLimit] = useState(100);
  const [testsSearch, setTestsSearch] = useState("");
  const [testsSort, setTestsSort] = useState("startsAt");
  const [testsStatus, setTestsStatus] = useState("all");
  const [testsPage, setTestsPage] = useState(1);
  const [deepDiveView, setDeepDiveView] = useState("performance");
  const [trendGroupBy, setTrendGroupBy] = useState("department");
  const [trendIndexed, setTrendIndexed] = useState(false);
  // Deep-dive ("view details") student results table: server-side search + sort +
  // pagination, matching the College Admin per-test results table.
  const [detailSearch, setDetailSearch] = useState("");
  const [deepDiveSort, setDeepDiveSort] = useState("date");
  const [detailPage, setDetailPage] = useState(1);
  const [sortState, setSortState] = useState(MODE_DEFAULT_SORT[mode]);
  const [error, setError] = useState(null);
  const [exportState, setExportState] = useState({
    status: "idle",
    progress: 0,
    downloadUrl: "",
    expiresAt: null,
    jobId: "",
    errorMessage: "",
  });
  const pollRef = useRef(null);

  const updateParams = (next) => {
    const nextParams = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value == null || value === "" || value === "all") {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    });
    setSearchParams(nextParams);
  };

  const collegesQuery = useQuery({
    queryKey: ["super-report-colleges-v4"],
    queryFn: () => superAdminApi.getColleges("?page=1&limit=100"),
    staleTime: 120000,
  });

  const departmentsQuery = useQuery({
    queryKey: ["super-report-departments-v4", collegeId],
    queryFn: () => superAdminApi.getDepartments(toQueryString({ page: 1, limit: 100, collegeId })),
    enabled: hasCollegeSelected,
    staleTime: 120000,
  });

  const testsQuery = useQuery({
    queryKey: ["super-report-tests-v4", collegeId],
    queryFn: () => superAdminApi.getTests(toQueryString({ page: 1, limit: 100, collegeId })),
    enabled: hasCollegeSelected,
    staleTime: 120000,
  });

  const passoutCohortsQuery = useQuery({
    queryKey: ["super-report-passout-cohorts-v1", collegeId],
    queryFn: () => superAdminApi.getPassoutCohorts(toQueryString({ collegeId })),
    enabled: hasCollegeSelected,
    staleTime: 120000,
  });

  // The batches list endpoint filters by college only, so fetch college-wide and
  // narrow to the selected department client-side below.
  const batchesQuery = useQuery({
    queryKey: ["super-report-batches-v1", collegeId],
    queryFn: () => superAdminApi.getBatches(toQueryString({ page: 1, limit: 200, collegeId })),
    enabled: hasCollegeSelected,
    staleTime: 120000,
  });

  const scopeQuery = useQuery({
    queryKey: ["super-report-analytics-scope-v5", collegeId, departmentId, batchId, testId, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportAnalytics(
        toQueryString({
          collegeId,
          departmentId,
          // Batch scoping mirrors College Admin: the analytics narrow to the
          // selected batch's students (and that batch's tests), so the whole
          // report view — metrics, charts, per-test deep-dive — reflects it.
          batchId: batchId || undefined,
          testId,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    // Enabled on the Batch tab too, so a selected batch renders a real batch-scoped
    // report (not just the tests list), and on any open test deep-dive.
    enabled: hasCollegeSelected && (isTestDeepDive || ["overview", "departments", "student", "batch"].includes(mode)),
    staleTime: 45000,
  });

  // Shared, scope-aware tests listing. The same query backs the tests table on
  // every tab - the active college/department/batch filters carry the scope.
  const testsListQuery = useQuery({
    queryKey: ["super-report-tests-list-v2", collegeId, departmentId, batchId, testsPage, testsSort, testsStatus, testsSearch.trim(), studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportTests(
        toQueryString({
          collegeId,
          departmentId: departmentId || undefined,
          batchId: batchId || undefined,
          page: testsPage,
          limit: 9,
          sortBy: testsSort,
          sortDir: "desc",
          status: testsStatus !== "all" ? testsStatus : undefined,
          search: testsSearch.trim() || undefined,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: hasCollegeSelected && !isTestDeepDive,
    placeholderData: (prev) => prev,
    staleTime: 30000,
  });

  // Advanced analytics — parity with the admin portal, scoped by the selected
  // college. Item-analysis / integrity are test deep-dive views; trends /
  // at-risk are their own tabs.
  const itemAnalysisQuery = useQuery({
    queryKey: ["super-report-item-analysis-v1", collegeId, testId, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportItemAnalysis(
        toQueryString({ collegeId, testId, studentScope, passoutYear: passoutYear || undefined, passoutCohortId: passoutCohortId || undefined })
      ),
    enabled: hasCollegeSelected && isTestDeepDive && deepDiveView === "items",
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  const integrityQuery = useQuery({
    queryKey: ["super-report-integrity-v1", collegeId, testId, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportIntegrity(
        toQueryString({ collegeId, testId, studentScope, passoutYear: passoutYear || undefined, passoutCohortId: passoutCohortId || undefined })
      ),
    enabled: hasCollegeSelected && isTestDeepDive && deepDiveView === "integrity",
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  // Per-submission student results for the selected test, scoped to the active
  // college/department/batch — the same endpoint shape College Admin uses, so the
  // batch-wise test report is identical across both portals.
  const testTableQuery = useQuery({
    queryKey: ["super-report-test-table-v1", collegeId, departmentId, batchId, testId, detailPage, detailSearch.trim(), deepDiveSort, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportTable(
        toQueryString({
          collegeId,
          departmentId: departmentId || undefined,
          batchId: batchId || undefined,
          testId,
          year: studentYear || undefined,
          page: detailPage,
          limit: 10,
          sortBy: deepDiveSort,
          sortDir: deepDiveSort === "studentName" ? "asc" : "desc",
          search: detailSearch.trim() || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: hasCollegeSelected && isTestDeepDive && deepDiveView === "performance",
    placeholderData: (prev) => prev,
    staleTime: 30000,
  });

  const trendsQuery = useQuery({
    queryKey: ["super-report-trends-v1", collegeId, departmentId, batchId, trendGroupBy, trendIndexed, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportTrends(
        toQueryString({
          collegeId,
          departmentId: departmentId || undefined,
          batchId: batchId || undefined,
          groupBy: trendGroupBy,
          indexed: trendIndexed ? "true" : undefined,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: hasCollegeSelected && mode === "trends" && !isTestDeepDive,
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  const atRiskQuery = useQuery({
    queryKey: ["super-report-at-risk-v1", collegeId, departmentId, batchId, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportAtRisk(
        toQueryString({
          collegeId,
          departmentId: departmentId || undefined,
          batchId: batchId || undefined,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: hasCollegeSelected && mode === "at-risk" && !isTestDeepDive,
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  const studentDetailQuery = useQuery({
    queryKey: ["super-report-student-detail-v4", collegeId, departmentId, testId, studentId, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportAnalytics(
        toQueryString({
          collegeId,
          departmentId,
          testId,
          studentId,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: hasCollegeSelected && Boolean(studentId),
    staleTime: 45000,
  });

  const studentSearchQuery = useQuery({
    queryKey: ["super-report-student-search-v4", collegeId, departmentId, studentSearch.trim(), studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getStudents(
        toQueryString({
          page: 1,
          limit: 10,
          collegeId,
          departmentId,
          search: studentSearch.trim(),
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: hasCollegeSelected && mode === "student" && studentSearch.trim().length >= 2,
    staleTime: 30000,
  });

  const reportsQuery = useQuery({
    queryKey: ["super-report-jobs-v4", collegeId],
    queryFn: () => superAdminApi.getReports(toQueryString({ collegeId })),
    enabled: hasCollegeSelected,
    staleTime: 30000,
  });

  const colleges = useMemo(() => (Array.isArray(collegesQuery.data?.data) ? collegesQuery.data.data : []), [collegesQuery.data]);
  const departments = useMemo(() => (Array.isArray(departmentsQuery.data?.data) ? departmentsQuery.data.data : []), [departmentsQuery.data]);
  const tests = useMemo(() => (Array.isArray(testsQuery.data?.data) ? testsQuery.data.data : []), [testsQuery.data]);
  const passoutCohorts = Array.isArray(passoutCohortsQuery.data?.data) ? passoutCohortsQuery.data.data : [];
  const allBatches = Array.isArray(batchesQuery.data?.data) ? batchesQuery.data.data : [];
  const batches = allBatches.filter((batch) => {
    if (!departmentId) return true;
    if (String(batch.departmentId || "") === String(departmentId)) return true;
    // Global batches span several departments.
    return Array.isArray(batch.departmentIds) && batch.departmentIds.map(String).includes(String(departmentId));
  });
  const selectedBatch = allBatches.find((item) => String(item.id) === String(batchId)) || null;
  const passoutYearOptions = [...new Set(passoutCohorts.map((cohort) => String(cohort.passoutYear || "")).filter(Boolean))];
  const visiblePassoutCohorts = passoutCohorts.filter((cohort) => !passoutYear || String(cohort.passoutYear) === String(passoutYear));
  const scope = scopeQuery.data || {};
  const testsList = Array.isArray(testsListQuery.data?.data) ? testsListQuery.data.data : [];
  const testsPagination = testsListQuery.data?.pagination || { page: 1, totalPages: 1, total: 0 };
  const selectedTestMeta = testsList.find((item) => String(item.testId) === String(testId)) || null;
  const studentDetail = studentDetailQuery.data || {};
  const reports = Array.isArray(reportsQuery.data) ? reportsQuery.data : [];

  const metrics = scope.metrics || {};
  const departmentRows = (Array.isArray(scope.departmentRows) ? scope.departmentRows : []).map((row) => ({
    departmentId: row.departmentId,
    college: row.college || "-",
    department: row.department || "-",
    students: toNumber(row.students),
    submissions: toNumber(row.submissions),
    avgScore: clampPercent(row.avgScore),
    passRate: clampPercent(row.passRate),
    participation: clampPercent(row.participation),
    violations: toNumber(row.violations),
  }));

  const studentRows = (Array.isArray(scope.tableRows) ? scope.tableRows : []).map((row) => ({
    rank: row.rank,
    studentId: row.studentId,
    name: row.name || "-",
    rollNo: row.rollNo || "-",
    collegeId: row.collegeId,
    college: row.college || "-",
    departmentId: row.departmentId,
    department: row.department || "-",
    batch: row.batch || "-",
    year: row.year || null,
    avgScore: clampPercent(row.avgScore),
    testsTaken: toNumber(row.testsTaken),
    participation: toNumber(row.participation),
    violations: toNumber(row.violations),
  }));

  const selectedTestName = testId === "all"
    ? ""
    : tests.find((test) => String(test.id) === String(testId))?.title || "";

  // A test deep-dive can now be opened from any tab, so this no longer keys off mode.
  const showNotAttendedCard = testId !== "all";
  const notAttendedStudents = showNotAttendedCard
    ? studentRows
        .filter((row) => row.testsTaken === 0)
        .map((row) => ({
          studentId: row.studentId,
          name: row.name,
          rollNo: row.rollNo,
          department: row.department,
          batch: row.batch,
        }))
    : [];

  const trendData = (scope.scoreTrend || []).map((item, index) => ({
    month: item.month || `Period ${index + 1}`,
    score: clampPercent(item.score),
  }));

  const subjectData = (scope.subjectPerformance || []).map((item) => ({
    subject: item.subject || "General",
    score: clampPercent(item.score),
  }));

  const selectedDepartment = departments.find((item) => String(item.id) === String(departmentId)) || null;
  const selectedCollege = colleges.find((item) => String(item.id) === String(collegeId)) || null;
  const studentMatches = studentSearchQuery.data?.data || [];
  const selectedStudent = studentDetail.selectedStudent || null;
  const selectedStudentMetrics = studentDetail.metrics || {};
  const attemptRows = (studentDetail.attemptHistory || []).map((row) => ({
    id: row.id,
    testName: row.testName || "-",
    subject: row.subject || "-",
    scorePercent: clampPercent(row.scorePercent),
    obtainedMarks: toNumber(row.obtainedMarks),
    totalMarks: toNumber(row.totalMarks),
    timeTaken: toNumber(row.timeTaken),
    status: row.status || "-",
    date: row.date,
    violationsCount: toNumber(row.violationsCount),
    questionAnalysis: row.questionAnalysis || { correct: 0, total: 0 },
  }));

  const sortedDepartmentRows = sortRows(departmentRows, sortState);
  const sortedStudentRows = sortRows(studentRows, sortState);

  // Per-test student results table: driven by the /table endpoint (per-submission
  // rows, server-side search/sort/pagination), matching College Admin.
  const testTableRows = Array.isArray(testTableQuery.data?.data) ? testTableQuery.data.data : [];
  const testTablePagination = testTableQuery.data?.pagination || { page: 1, totalPages: 1, total: 0 };
  const sortedAttemptRows = sortRows(attemptRows, sortState);
  const visibleStudentRows = sortedStudentRows.slice(0, studentVisibleLimit);

  const departmentChartRows = [...departmentRows]
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 12)
    .map((row) => ({
      department: row.department,
      avgScore: clampPercent(row.avgScore),
      passRate: clampPercent(row.passRate),
      participation: clampPercent(row.participation),
    }));

  useEffect(() => {
    setSortState(MODE_DEFAULT_SORT[mode]);
    if (mode !== "student") setStudentSearch("");
    setStudentVisibleLimit(100);
  }, [mode]);

  useEffect(() => {
    setTestsPage(1);
  }, [testsSearch, testsSort, testsStatus, collegeId, departmentId, batchId, studentYear, studentScope, passoutYear, passoutCohortId]);

  // Reset the deep-dive table page when the test, its search, or the sort change.
  useEffect(() => {
    setDetailPage(1);
  }, [testId, detailSearch, deepDiveSort]);

  // A fresh deep dive starts with clean filters and the Performance view.
  useEffect(() => {
    setDetailSearch("");
    setDeepDiveSort("date");
    setDeepDiveView("performance");
  }, [testId]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPollingJob = (jobId) => {
    if (!jobId) return;
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const jobs = await superAdminApi.getReports(toQueryString({ collegeId }));
        const job = (jobs || []).find((item) => item.id === jobId);
        if (!job) return;
        const normalized = String(job.status || "").toLowerCase();
        setExportState((prev) => ({
          ...prev,
          status: normalized === "completed" ? "complete" : normalized === "failed" ? "failed" : "polling",
          progress: normalized === "completed" ? 100 : normalized === "processing" ? 60 : 15,
          downloadUrl: job.resultUrl || job.downloadUrl || prev.downloadUrl || `/api/super-admin/reports/${jobId}/download`,
          expiresAt: job.downloadExpiresAt || job?.filters?.resultUrlExpiresAt || prev.expiresAt,
          jobId,
        }));
        if (normalized === "completed" || normalized === "failed") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          reportsQuery.refetch();
        }
      } catch (error) {
        setExportState((prev) => ({ ...prev, status: "failed", errorMessage: toExportErrorMessage(error) }));
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 1800);
  };

  const handleExport = async () => {
    const reportType = mode === "student" ? "STUDENT_WISE" : mode === "departments" ? "DEPARTMENT_WISE" : "TEST_WISE";

    if (!collegeId) {
      setError("Select a college before exporting a report.");
      return;
    }

    if (mode === "student" && !studentId) {
      setError("Select a student before exporting a student report.");
      return;
    }

    setError(null);
    setExportState({ status: "loading", progress: 0, downloadUrl: "", expiresAt: null, jobId: "", errorMessage: "" });

    try {
      const result = await superAdminApi.generateReport({
        type: reportType,
        filters: {
          collegeId: collegeId || undefined,
          departmentId: departmentId || undefined,
          // Carry the active batch filter through to the export so the generated
          // PDF is batch-scoped exactly like the College Admin report (whose core,
          // buildInstitutionReportPayload, narrows students to this batch). Without
          // it the report silently ignores the batch selection.
          batchId: batchId || undefined,
          studentId: mode === "student" ? studentId || undefined : undefined,
          testId: testId === "all" ? undefined : testId,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        },
      });
      const jobId = result?.jobId || result?.id;
      if (!jobId) {
        setError("Failed to create report job.");
        setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "", errorMessage: "Failed to create report job." });
        return;
      }
      setExportState({ status: "polling", progress: 5, downloadUrl: `/api/super-admin/reports/${jobId}/download`, expiresAt: null, jobId, errorMessage: "" });
      startPollingJob(jobId);
    } catch (err) {
      const message = toExportErrorMessage(err);
      setError(message);
      setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "", errorMessage: message });
    }
  };

  const downloadJob = async (jobId, retried = false) => {
    try {
      const blob = await superAdminApi.downloadReport(jobId);
      const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `super-admin-report-${jobId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportState((prev) => ({ ...prev, status: "complete", errorMessage: "" }));
    } catch (error) {
      const message = toExportErrorMessage(error);
      if (error?.code === "REPORT_URL_EXPIRED" && !retried) {
        try {
          await superAdminApi.regenerateReportLink(jobId);
          await downloadJob(jobId, true);
          return;
        } catch (refreshError) {
          const refreshMessage = toExportErrorMessage(refreshError);
          setError(refreshMessage);
          setExportState((prev) => ({ ...prev, status: "failed", errorMessage: refreshMessage || message }));
          return;
        }
      }
      setError(message);
      setExportState((prev) => ({ ...prev, status: "failed", errorMessage: message }));
    }
  };

  const handleDownload = async () => {
    if (!exportState.jobId) return;
    try {
      const isExpired = exportState.expiresAt && new Date(exportState.expiresAt).getTime() <= Date.now();
      if (isExpired) {
        const refreshed = await superAdminApi.regenerateReportLink(exportState.jobId);
        setExportState((prev) => ({ ...prev, downloadUrl: refreshed.resultUrl || prev.downloadUrl, expiresAt: refreshed.expiresAt || prev.expiresAt }));
      }
      await downloadJob(exportState.jobId);
    } catch (error) {
      setError(toExportErrorMessage(error));
      setExportState((prev) => ({ ...prev, status: "failed", errorMessage: toExportErrorMessage(error) }));
    }
  };

  const handleSort = (key) => {
    setSortState((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key, dir: "asc" };
    });
  };

  const handleModeSwitch = (nextMode) => {
    updateParams({
      mode: nextMode,
      department: nextMode === "overview" ? "" : departmentId,
      student_id: "",
      test: "",
      batch_id: nextMode === "batch" ? batchId : "",
    });
    setTestsPage(1);
  };

  const handleBatchChange = (nextBatchId) => {
    updateParams({ batch_id: nextBatchId || "", test: "" });
    setTestsPage(1);
  };

  const handleTestOpen = (nextTestId) => {
    updateParams({ test: nextTestId || "" });
  };

  const handleTestBack = () => {
    updateParams({ test: "" });
  };

  const handleCollegeChange = (nextCollegeId) => {
    updateParams({ college: nextCollegeId, department: "", test: "all", passout_year: "", passout_cohort: "", student_id: "", batch_id: "" });
  };

  const handleDepartmentChange = (nextDepartmentId) => {
    // Batches are department-scoped, so a department change invalidates the batch.
    updateParams({ department: nextDepartmentId, student_id: "", batch_id: "" });
  };

  const handleYearChange = (nextYear) => {
    setStudentYear(nextYear || "");
    updateParams({ student_id: "" });
    setStudentSearch("");
  };

  const handleStudentScopeChange = (nextScope) => {
    updateParams({
      student_scope: nextScope === "current" ? "" : nextScope,
      passout_year: nextScope === "current" ? "" : passoutYear,
      passout_cohort: nextScope === "current" ? "" : passoutCohortId,
      student_id: "",
    });
    setStudentSearch("");
  };

  const handlePassoutYearChange = (nextYear) => {
    updateParams({ passout_year: nextYear || "", passout_cohort: "", student_id: "" });
    setStudentSearch("");
  };

  const handlePassoutCohortChange = (nextCohortId) => {
    updateParams({ passout_cohort: nextCohortId || "", student_id: "" });
    setStudentSearch("");
  };

  const loading = collegesQuery.isLoading || (hasCollegeSelected && scopeQuery.isLoading);

  const violationCount = toNumber(metrics.violations);
  const avgScoreTier =
    metrics.avgScore >= 75
      ? { badge: "Distinction", badgeTone: "success" }
      : metrics.avgScore >= 50
        ? { badge: "Average", badgeTone: "info" }
        : { badge: "Below Avg", badgeTone: "warning" };

  const overviewStatCards = [
    {
      key: "students",
      iconName: "students",
      iconTone: "navy",
      label: "Total Students",
      value: toNumber(metrics.totalStudents).toLocaleString(),
      sub: "In current scope",
      badge: `${toNumber(metrics.attemptedStudents).toLocaleString()} active`,
      badgeTone: "info",
    },
    { key: "avg", iconName: "score", iconTone: "primary", label: "Avg Score", value: formatPercent(metrics.avgScore), sub: "Submitted attempts", ...avgScoreTier },
    { key: "pass", iconName: "target", iconTone: "success", label: "Pass Rate", value: formatPercent(metrics.passRate), sub: "Score 40% and above", badge: "Target 40%", badgeTone: "info" },
    {
      key: "viol",
      iconName: "alert",
      iconTone: violationCount > 10 ? "danger" : "warning",
      label: "Pending Reviews",
      value: violationCount,
      sub: violationCount > 10 ? "High violation volume" : "Integrity flags",
      badge: violationCount > 10 ? "High Priority" : "Monitored",
      badgeTone: violationCount > 10 ? "danger" : "muted",
      flag: violationCount > 10,
    },
  ];

  const superTestKpis = [
    { key: "avg", iconName: "score", iconTone: "primary", label: "Avg Score", value: formatPercent(metrics.avgScore), sub: "Submitted attempts", ...avgScoreTier },
    { key: "pass", iconName: "target", iconTone: "success", label: "Pass Rate", value: formatPercent(metrics.passRate), sub: "Score 40%+", badge: "Target 40%", badgeTone: "info" },
    { key: "part", iconName: "participation", iconTone: "navy", label: "Participation", value: formatPercent(metrics.participationRate), sub: "Students who attempted", badge: `${toNumber(metrics.totalTests)} tests`, badgeTone: "muted" },
    {
      key: "viol",
      iconName: "alert",
      iconTone: violationCount > 10 ? "danger" : "warning",
      label: "Violations",
      value: violationCount,
      sub: violationCount > 10 ? "High violation volume" : "Proctoring flags",
      badge: violationCount > 10 ? "High Priority" : "Monitored",
      badgeTone: violationCount > 10 ? "danger" : "muted",
      flag: violationCount > 10,
    },
  ];

  const healthLabel = metrics.avgScore >= 75 ? "Excellent" : metrics.avgScore >= 50 ? "Healthy" : "Needs Attention";
  const insightMessage = hasCollegeSelected
    ? `Average score is ${formatPercent(metrics.avgScore)} across ${toNumber(metrics.totalSubmissions).toLocaleString()} submissions with a ${formatPercent(metrics.passRate)} pass rate. ${violationCount > 10 ? `${violationCount} integrity flags need review.` : "Integrity flags are within healthy limits."}`
    : "Select a college to view institutional health.";

  const testsScopeLabel = selectedBatch
    ? `Batch: ${selectedBatch.name}`
    : selectedDepartment
      ? `Department: ${selectedDepartment.name}`
      : selectedCollege?.name || "Selected college";

  // Shared tests listing rendered on every tab, scoped by the active filters.
  const renderTestsListCard = () => {
    const pageSize = Number(testsPagination.limit) || 9;
    const startIndex = (Number(testsPagination.page || 1) - 1) * pageSize;
    return (
      <section className="space-y-4">
        <article className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                </svg>
              </span>
              <div>
                <h3 className="text-lg font-semibold text-text-primary">Test Reports</h3>
                <p className="text-xs text-text-secondary">Per-test performance · {testsScopeLabel}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={testsSearch}
                onChange={(event) => setTestsSearch(event.target.value)}
                placeholder="Search tests…"
                className="h-9 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-sm"
              />
              <select
                value={testsStatus}
                onChange={(event) => setTestsStatus(event.target.value)}
                aria-label="Filter by status"
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
              >
                <option value="all">All statuses</option>
                <option value="LIVE">Live</option>
                <option value="COMPLETED">Completed</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="DRAFT">Draft</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <select
                value={testsSort}
                onChange={(event) => setTestsSort(event.target.value)}
                aria-label="Sort tests"
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
              >
                {TEST_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          {testsListQuery.isLoading ? (
            <div className="p-6 text-sm text-text-secondary">Loading tests…</div>
          ) : testsListQuery.isError ? (
            <div className="m-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load tests.</div>
          ) : testsList.length === 0 ? (
            <EmptyState title="No tests found" description="Adjust your search or filters to see test performance." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <Th>S.No</Th>
                      <Th>Assessment Name</Th>
                      <Th>Status</Th>
                      <Th>Date</Th>
                      <Th>Submissions</Th>
                      <Th>Avg Score</Th>
                      <Th>Pass Rate</Th>
                      <Th>Violations</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {testsList.map((test, index) => (
                      <tr key={test.testId} className="border-t border-border/70 hover:bg-muted/40">
                        <td className="px-4 py-3 tabular-nums text-text-secondary">{String(startIndex + index + 1).padStart(2, "0")}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-text-primary">{test.title || "Untitled test"}</p>
                          <p className="text-xs text-text-secondary">{test.department || "-"} · {test.batch || "-"}</p>
                        </td>
                        <td className="px-4 py-3"><StatusBadge label={test.status || "-"} variant={TEST_STATUS_VARIANT[test.status] || "default"} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{test.startsAt ? formatDateLabel(test.startsAt) : "-"}</td>
                        <td className="px-4 py-3 tabular-nums">{toNumber(test.submissionCount)}</td>
                        <td className="px-4 py-3"><ScoreBadge score={test.avgScore} /></td>
                        <td className="px-4 py-3 tabular-nums">{formatPercent(test.passRate)}</td>
                        <td className="px-4 py-3"><ViolationBadge count={test.violations} /></td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleTestOpen(test.testId)}
                            className="text-xs font-semibold text-primary transition-opacity hover:opacity-70"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border/70 p-4">
                <Pagination
                  page={testsPagination.page}
                  totalPages={testsPagination.totalPages}
                  total={testsPagination.total}
                  onPageChange={setTestsPage}
                />
              </div>
            </>
          )}
        </article>
      </section>
    );
  };

  const renderSuperTestDeepDive = () => {
    const moduleColumns = moduleColumnDefs(testTableRows, scope?.modulePerformance);
    const moduleStats = Array.isArray(scope?.modulePerformance?.moduleStats)
      ? scope.modulePerformance.moduleStats
      : [];
    return (
    <section className="space-y-4">
      <DeepDiveHeader
        title={selectedTestMeta?.title || selectedTestName || "Test performance"}
        subtitle={`${selectedCollege?.name || "College"} · deep-dive performance and integrity.`}
        onBack={handleTestBack}
      />

      <TabNav
        tabs={DEEP_DIVE_VIEWS.map((view) => ({ key: view.key, label: view.label }))}
        active={deepDiveView}
        onChange={setDeepDiveView}
      />

      {deepDiveView === "items" ? <ItemAnalysisView query={itemAnalysisQuery} /> : null}
      {deepDiveView === "integrity" ? <IntegrityView query={integrityQuery} /> : null}

      {deepDiveView !== "performance" ? null : scopeQuery.isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-text-secondary">Loading test analytics…</div>
      ) : scopeQuery.isError ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load test analytics.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {superTestKpis.map((item) => (
              <StatCard key={item.key} {...item} />
            ))}
          </div>

          {moduleStats.length > 0 ? (
            <article className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <div className="border-b border-border/70 pb-3">
                <h3 className="text-lg font-semibold text-text-primary">Module Performance</h3>
                <p className="text-xs text-text-secondary">Per-module average score, completion, and attempts</p>
              </div>
              <div className="grid gap-3 pt-4 md:grid-cols-3">
                {moduleStats.map((stat) => (
                  <div key={stat.key} className="rounded-xl border border-border bg-background p-3">
                    <p className="text-sm font-semibold text-text-primary">{stat.name}</p>
                    <p className="mt-1 text-3xl font-bold text-text-primary">{formatPercent(stat.averagePercentage)}</p>
                    <p className="text-xs text-text-secondary">avg score · {toNumber(stat.attempts)} attempts</p>
                    <div className="mt-2 flex items-center gap-1">
                      <span className={`h-1.5 flex-1 rounded-full ${clampPercent(stat.averagePercentage) >= 60 ? "bg-success" : clampPercent(stat.averagePercentage) >= 40 ? "bg-amber-500" : "bg-red-500"}`} />
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">{formatPercent(stat.completionRate)} completion rate</p>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[2fr_2fr]">
            <ChartCard title="Score Distribution" height="h-[220px]">
              <ScoreDonutChart data={scope.distribution || []} total={studentRows.length} />
            </ChartCard>
            <ChartCard title="Subject-wise Scores" height="h-[240px]">
              <TopicPieChart data={subjectData} />
            </ChartCard>
          </div>

          <ChartCard title="Score Spread" height="h-[220px]">
            <DistributionSummary stats={scope.distributionStats} />
          </ChartCard>

          <article className="rounded-2xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-text-primary">Student Results</h3>
                {testTableQuery.isFetching ? <span className="text-xs text-text-secondary">Updating…</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={detailSearch}
                  onChange={(event) => setDetailSearch(event.target.value)}
                  placeholder="Search student, roll no, batch…"
                  className="h-9 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-sm"
                />
                <select
                  value={deepDiveSort}
                  onChange={(event) => setDeepDiveSort(event.target.value)}
                  aria-label="Sort student results"
                  className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
                >
                  <option value="score">Highest score</option>
                  <option value="studentName">Name (A–Z)</option>
                  <option value="violationCount">Most violations</option>
                  <option value="timeTaken">Longest time</option>
                  <option value="date">Most recent</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Roll No</Th>
                    <Th>Department</Th>
                    <Th>Batch</Th>
                    <Th>Score</Th>
                    {moduleColumns.map((mod) => (
                      <Th key={mod.key}>{moduleShortLabel(mod.key)}</Th>
                    ))}
                    <Th>Result</Th>
                    <Th>Status</Th>
                    <Th>Violations</Th>
                  </tr>
                </thead>
                <tbody>
                  {testTableRows.map((row) => (
                    <tr key={row.submissionId || row.id} className="border-t border-border/70 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={row.studentName} seed={row.studentId} />
                          <span className="font-medium text-text-primary">{row.studentName || "-"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{row.studentRollNo || "-"}</td>
                      <td className="px-4 py-3 text-text-secondary">{row.department || "-"}</td>
                      <td className="px-4 py-3 text-text-secondary">{row.batch || "-"}</td>
                      <td className="px-4 py-3"><ScoreBadge score={row.scorePercent ?? row.score} /></td>
                      {moduleColumns.map((mod) => (
                        <td key={mod.key} className="px-4 py-3"><ScoreBadge score={modulePercentageFor(row, mod)} /></td>
                      ))}
                      <td className="px-4 py-3"><ResultBadge status={row.status} score={row.scorePercent ?? row.score} /></td>
                      <td className="px-4 py-3"><StatusBadge label={String(row.status || "-").toLowerCase()} variant={row.status === "SUBMITTED" ? "success" : "warning"} /></td>
                      <td className="px-4 py-3"><ViolationBadge count={row.violationCount} /></td>
                    </tr>
                  ))}
                  {testTableRows.length === 0 ? (
                    <tr>
                      <td colSpan={8 + moduleColumns.length} className="px-4 py-8">
                        <EmptyState title="No submissions yet" description="Student results appear once this test has submissions." />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border/70 p-4">
              <Pagination
                page={testTablePagination.page}
                totalPages={testTablePagination.totalPages}
                total={testTablePagination.total}
                onPageChange={setDetailPage}
              />
            </div>
          </article>

          {notAttendedStudents.length > 0 ? (
            <AbsentStudentsCard
              title="Not Attended Students"
              subtitle="Students who did not submit this test."
              students={notAttendedStudents}
              count={notAttendedStudents.length}
            />
          ) : null}
        </>
      )}
    </section>
  );
  };


  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-4 sm:px-6">
      {error ? (
        <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">{error}</section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">Reporting Dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-text-primary sm:text-3xl">Super Admin Reports</h1>
            <p className="mt-1 text-sm text-text-secondary">
              College, department, and student performance analytics with integrity tracking.
            </p>
          </div>
          <ExportButton
            exportState={exportState}
            onExport={handleExport}
            onDownload={handleDownload}
            disabled={!hasCollegeSelected}
            disabledReason={!hasCollegeSelected ? "Select a college before exporting reports." : ""}
          />
        </div>
        <div className="mt-4">
          <TabNav
            tabs={REPORT_MODES.map((item) => ({ key: item.key, label: item.label }))}
            active={mode}
            onChange={handleModeSwitch}
          />
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="grid gap-3 md:grid-cols-5 xl:grid-cols-6">
          <label className="space-y-1 text-xs text-text-secondary">
            <span>College</span>
            <select
              value={collegeId}
              onChange={(event) => handleCollegeChange(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
            >
              <option value="">Select College</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-text-secondary">
            <span>Department</span>
            <select
              value={departmentId}
              onChange={(event) => handleDepartmentChange(event.target.value)}
              disabled={!collegeId}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
            >
              <option value="">{collegeId ? "All Departments" : "Select a college first"}</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-text-secondary">
            <span>Test</span>
            <select
              value={testId}
              onChange={(event) => updateParams({ test: event.target.value })}
              disabled={!collegeId}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
            >
              <option value="all">{collegeId ? "All Tests" : "Select a college first"}</option>
              {tests.map((test) => (
                <option key={test.id} value={test.id}>{test.title}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-text-secondary">
            <span>Student Scope</span>
            <select
              value={studentScope}
              onChange={(event) => handleStudentScopeChange(event.target.value)}
              disabled={!collegeId}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
            >
              {STUDENT_SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {studentScope !== "current" ? (
            <>
              <label className="space-y-1 text-xs text-text-secondary">
                <span>Passout Year</span>
                <select
                  value={passoutYear}
                  onChange={(event) => handlePassoutYearChange(event.target.value)}
                  disabled={!collegeId}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
                >
                  <option value="">{collegeId ? "All passout years" : "Select a college first"}</option>
                  {passoutYearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-text-secondary">
                <span>Passout Cohort</span>
                <select
                  value={passoutCohortId}
                  onChange={(event) => handlePassoutCohortChange(event.target.value)}
                  disabled={!collegeId}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
                >
                  <option value="">{collegeId ? "All cohorts" : "Select a college first"}</option>
                  {visiblePassoutCohorts.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>
                      {cohort.academicLabel || cohort.passoutYear} ({cohort.totalStudents || 0})
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          <label className="space-y-1 text-xs text-text-secondary">
            <span>Student Year</span>
            <select
              value={studentYear}
              onChange={(event) => handleYearChange(event.target.value)}
              disabled={!collegeId}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
            >
              <option value="">{collegeId ? "All years" : "Select a college first"}</option>
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>{year} YEAR</option>
              ))}
            </select>
          </label>
        </div>

        {mode === "student" ? (
          <div className="relative max-w-xl">
            <input
              value={studentSearch}
              onChange={(event) => setStudentSearch(event.target.value)}
              placeholder="Search student by name, email, or roll number"
              disabled={!collegeId}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-60"
            />
            {studentSearch.trim().length >= 2 ? (
              <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                {studentMatches.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => {
                      updateParams({
                        college: student.collegeId || collegeId,
                        department: student.departmentId || "",
                        student_id: student.id,
                      });
                      setStudentSearch("");
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="font-medium text-text-primary">{student.fullName}</span>
                    <span className="block text-xs text-text-secondary">
                      {student.studentId || "-"} - {student.college?.name || selectedCollege?.name || "-"} - {student.department?.name || "-"} - {student.year || "-"}
                    </span>
                  </button>
                ))}
                {!studentSearchQuery.isLoading && studentMatches.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">No students found.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {!isTestDeepDive && ["overview", "departments", "student"].includes(mode) && loading ? <AnalyticsSkeleton /> : null}
      {!isTestDeepDive && ["overview", "departments", "student"].includes(mode) && hasCollegeSelected && scopeQuery.isError ? <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load report data.</section> : null}

      {!hasCollegeSelected && !collegesQuery.isLoading ? (
        <section className="rounded-2xl border border-border bg-card">
          <EmptyState title="Select a college" description="Choose a college first to view reports for that college." />
        </section>
      ) : null}

      {hasCollegeSelected && isTestDeepDive ? renderSuperTestDeepDive() : null}

      {hasCollegeSelected && !isTestDeepDive && mode === "batch" ? (
        <section className="space-y-4">
          <article className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <label className="block max-w-sm space-y-1 text-xs text-text-secondary">
              <span>Select Batch</span>
              <select
                value={batchId}
                onChange={(event) => handleBatchChange(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
              >
                <option value="">All batches in this college</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>{batch.name}</option>
                ))}
              </select>
            </label>
            {selectedBatch ? (
              <p className="mt-2 text-xs text-text-secondary">
                Showing the report scoped to <span className="font-medium text-text-primary">{selectedBatch.name}</span>.
              </p>
            ) : null}
          </article>

          {loading ? (
            <AnalyticsSkeleton />
          ) : scopeQuery.isError ? (
            <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load batch report data.</section>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {overviewStatCards.map((item) => (
                  <StatCard key={item.key} {...item} />
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Score Distribution" height="h-[240px]">
                  <ScoreDonutChart data={scope.distribution || []} total={toNumber(metrics.attemptedStudents)} />
                </ChartCard>
                <ChartCard title="Topic-wise Performance" height="h-[240px]">
                  <TopicPieChart data={subjectData} />
                </ChartCard>
              </div>

              <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 p-4">
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">
                      {selectedBatch ? `${selectedBatch.name} — Student Performance` : "Batch Student Performance"}
                    </h3>
                    <p className="text-xs text-text-secondary">Ranked by average score. Click a student to open their report.</p>
                  </div>
                  <span className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-text-secondary">
                    {sortedStudentRows.length} {sortedStudentRows.length === 1 ? "entry" : "entries"}
                  </span>
                </div>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <Th sortKey="rank" sortState={sortState} onSort={handleSort}>S.No</Th>
                      <Th sortKey="name" sortState={sortState} onSort={handleSort}>Student Name</Th>
                      <Th sortKey="department" sortState={sortState} onSort={handleSort}>Department</Th>
                      <Th sortKey="year" sortState={sortState} onSort={handleSort}>Year</Th>
                      <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg Score</Th>
                      <Th>Result</Th>
                      <Th sortKey="testsTaken" sortState={sortState} onSort={handleSort}>Tests</Th>
                      <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudentRows.map((row) => (
                      <tr key={row.studentId} className="border-t border-border/70 hover:bg-muted/40">
                        <td className="px-4 py-3 tabular-nums text-text-secondary">{row.rank ? `#${row.rank}` : "-"}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => updateParams({ college: row.collegeId || collegeId || "", department: row.departmentId || departmentId, student_id: row.studentId, mode: "student" })}
                            className="flex items-center gap-3 text-left"
                          >
                            <Avatar name={row.name} seed={row.studentId} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-text-primary hover:text-chart-1">{row.name}</span>
                              <span className="block truncate text-xs font-normal text-text-secondary">{row.rollNo}</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{row.department}</td>
                        <td className="px-4 py-3 text-text-secondary">{row.year ? `${row.year} YEAR` : "-"}</td>
                        <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                        <td className="px-4 py-3">{row.testsTaken > 0 ? <ResultBadge score={row.avgScore} /> : <span className="text-text-secondary">-</span>}</td>
                        <td className="px-4 py-3">{row.testsTaken}</td>
                        <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                      </tr>
                    ))}
                    {visibleStudentRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8">
                          <EmptyState title="No students in this batch scope" description="Students appear once they are assigned to the selected batch." />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                {sortedStudentRows.length > visibleStudentRows.length ? (
                  <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-xs text-text-secondary">
                    <span>Showing {visibleStudentRows.length} of {sortedStudentRows.length} students.</span>
                    <button
                      type="button"
                      onClick={() => setStudentVisibleLimit((value) => value + 100)}
                      className="rounded-lg border border-border px-3 py-1 font-semibold text-text-primary hover:bg-muted"
                    >
                      Show more
                    </button>
                  </div>
                ) : null}
              </article>
            </>
          )}

          {renderTestsListCard()}
        </section>
      ) : null}

      {hasCollegeSelected && !isTestDeepDive && mode === "trends" ? (
        <TrendsView
          query={trendsQuery}
          groupBy={trendGroupBy}
          onGroupByChange={setTrendGroupBy}
          indexed={trendIndexed}
          onIndexedChange={setTrendIndexed}
          showGroupBy
        />
      ) : null}

      {hasCollegeSelected && !isTestDeepDive && mode === "at-risk" ? (
        <AtRiskView
          query={atRiskQuery}
          canViewStudent
          onViewStudent={(id) => updateParams({ mode: "student", student_id: id })}
        />
      ) : null}

      {hasCollegeSelected && !isTestDeepDive && ["overview", "departments", "student"].includes(mode) && !loading && !scopeQuery.isError ? (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {overviewStatCards.map((item) => (
              <StatCard key={item.key} {...item} />
            ))}
          </div>

          {mode === "overview" ? (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Score Distribution" height="h-[240px]">
                  <ScoreDonutChart data={scope.distribution || []} total={toNumber(metrics.attemptedStudents)} />
                </ChartCard>
                <ChartCard title="Topic-wise Performance" height="h-[240px]">
                  <TopicPieChart data={subjectData} />
                </ChartCard>
                <InsightCard
                  title={`Institutional Health · ${healthLabel}`}
                  message={insightMessage}
                  action={{ label: "View Departments", onClick: () => handleModeSwitch("departments") }}
                />
              </div>

              <ChartCard title="Score Spread" height="h-[200px]">
                <DistributionSummary stats={scope.distributionStats} />
              </ChartCard>

              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                <ChartCard title="Score Trend" height="h-[240px]">
                  <AreaTrendChart data={trendData} xKey="month" dataKey="score" name="Avg Score" color="var(--chart-1)" />
                </ChartCard>
                <RecentExports reports={reports} onDownload={downloadJob} />
              </div>

              <ChartCard title={collegeId ? "Department Performance Comparison" : "Department Overview Across Colleges"} height="h-auto">
                <GroupedBarChart
                  data={departmentChartRows}
                  xKey="department"
                  series={[
                    { key: "avgScore", label: "Avg Score" },
                    { key: "passRate", label: "Pass Rate" },
                    { key: "participation", label: "Participation" },
                  ]}
                  onBarClick={(name) => {
                    const dep = departments.find((item) => item.name === name);
                    if (dep) updateParams({ mode: "departments", department: dep.id });
                  }}
                />
              </ChartCard>
            </>
          ) : null}

          {mode === "departments" ? (
            <>
              {!collegeId ? (
                <EmptyState title="Select a college" description="Choose a college to view all departments or one particular department." />
              ) : (
                <>
                  <div className="grid gap-4 lg:grid-cols-3">
                    <ChartCard title="Score Distribution" height="h-[240px]">
                      <ScoreDonutChart data={scope.distribution || []} total={toNumber(metrics.attemptedStudents)} />
                    </ChartCard>
                    <ChartCard title="Topic-wise Performance" height="h-[240px]">
                      <TopicPieChart data={subjectData} />
                    </ChartCard>
                    <ChartCard title={selectedDepartment ? `${selectedDepartment.name} Performance` : "All Departments Performance"} height="h-[240px]">
                      <div className="h-full overflow-auto">
                        <GroupedBarChart
                          data={departmentChartRows}
                          xKey="department"
                          series={[
                            { key: "avgScore", label: "Avg Score" },
                            { key: "passRate", label: "Pass Rate" },
                          ]}
                        />
                      </div>
                    </ChartCard>
                  </div>

                  <ChartCard title="Score Spread" height="h-[200px]">
                    <DistributionSummary stats={scope.distributionStats} />
                  </ChartCard>

                  <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <Th sortKey="department" sortState={sortState} onSort={handleSort}>Department</Th>
                          <Th sortKey="students" sortState={sortState} onSort={handleSort}>Students</Th>
                          <Th sortKey="submissions" sortState={sortState} onSort={handleSort}>Submissions</Th>
                          <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg Score</Th>
                          <Th sortKey="passRate" sortState={sortState} onSort={handleSort}>Pass Rate</Th>
                          <Th sortKey="participation" sortState={sortState} onSort={handleSort}>Participation</Th>
                          <Th>Status</Th>
                          <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDepartmentRows.map((row) => {
                          const health = row.avgScore >= 75
                            ? { label: "Healthy", variant: "success" }
                            : row.avgScore >= 50
                              ? { label: "Average", variant: "warning" }
                              : { label: "Needs Review", variant: "danger" };
                          return (
                          <tr key={row.departmentId || row.department} className="border-t border-border/70 hover:bg-muted/40">
                            <td className="px-4 py-3 font-medium text-text-primary">{row.department}</td>
                            <td className="px-4 py-3">{row.students}</td>
                            <td className="px-4 py-3">{row.submissions}</td>
                            <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                            <td className="px-4 py-3">{formatPercent(row.passRate)}</td>
                            <td className="px-4 py-3">{formatPercent(row.participation)}</td>
                            <td className="px-4 py-3"><StatusBadge label={health.label} variant={health.variant} /></td>
                            <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                          </tr>
                          );
                        })}
                        {sortedDepartmentRows.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-4 py-8">
                              <EmptyState title="No department reports yet" description="Department metrics appear after students submit tests." />
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </article>
                </>
              )}
            </>
          ) : null}

          {mode === "student" ? (
            <>
              

              {!studentId ? (
                <EmptyState title="Select a student" description="Search above or click a student row to view test-by-test performance." />
              ) : studentDetailQuery.isLoading ? (
                <section className="rounded-2xl border border-border bg-card p-4 text-sm text-text-secondary">Loading student performance...</section>
              ) : (
                <>
                  <StudentSummary student={selectedStudent} metrics={selectedStudentMetrics} />

                  <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                    <ChartCard title="Student Score Trend" height="h-[220px]">
                      <LineTrendChart
                        data={attemptRows.map((row) => ({ month: formatDateLabel(row.date), score: row.scorePercent })).reverse()}
                        xKey="month"
                        dataKey="score"
                        name="Score"
                        color="var(--chart-2)"
                      />
                    </ChartCard>
                    <ChartCard title="Topic-wise Performance" height="h-[220px]">
                      <TopicPieChart data={(studentDetail.subjectPerformance || []).map((row) => ({ subject: row.subject, score: toNumber(row.score) }))} />
                    </ChartCard>
                  </div>

                  <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <Th sortKey="date" sortState={sortState} onSort={handleSort}>Date</Th>
                          <Th sortKey="testName" sortState={sortState} onSort={handleSort}>Test</Th>
                          <Th sortKey="subject" sortState={sortState} onSort={handleSort}>Subject</Th>
                          <Th sortKey="scorePercent" sortState={sortState} onSort={handleSort}>Score</Th>
                          <Th>Result</Th>
                          <Th sortKey="obtainedMarks" sortState={sortState} onSort={handleSort}>Marks</Th>
                          <Th sortKey="timeTaken" sortState={sortState} onSort={handleSort}>Time</Th>
                          <Th sortKey="violationsCount" sortState={sortState} onSort={handleSort}>Violations</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAttemptRows.map((row) => (
                          <tr key={row.id} className="border-t border-border/70 hover:bg-muted/40">
                            <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{formatDateLabel(row.date)}</td>
                            <td className="px-4 py-3 font-medium text-text-primary">{row.testName}</td>
                            <td className="px-4 py-3 text-text-secondary">{row.subject}</td>
                            <td className="px-4 py-3"><ScoreBadge score={row.scorePercent} /></td>
                            <td className="px-4 py-3"><ResultBadge status={row.status} score={row.scorePercent} /></td>
                            <td className="px-4 py-3">
                              {row.totalMarks > 0 ? `${row.obtainedMarks.toFixed(2)} / ${row.totalMarks.toFixed(2)}` : "-"}
                            </td>
                            <td className="px-4 py-3">{Math.round(row.timeTaken / 60)} min</td>
                            <td className="px-4 py-3"><ViolationBadge count={row.violationsCount} /></td>
                          </tr>
                        ))}
                        {sortedAttemptRows.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-4 py-8">
                              <EmptyState title="No submitted tests" description="This student's completed tests will appear here." />
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </article>
                  <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-text-primary">Student Performance Log</h3>
                      <p className="text-xs text-text-secondary">Select a student to open complete test performance.</p>
                    </div>
                  </div>
                  <span className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-text-secondary">
                    {sortedStudentRows.length} {sortedStudentRows.length === 1 ? "entry" : "entries"}
                  </span>
                </div>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <Th sortKey="rank" sortState={sortState} onSort={handleSort}>S.No</Th>
                      <Th sortKey="name" sortState={sortState} onSort={handleSort}>Student Name</Th>
                      <Th sortKey="department" sortState={sortState} onSort={handleSort}>Department</Th>
                      <Th sortKey="year" sortState={sortState} onSort={handleSort}>Year</Th>
                      <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg Score</Th>
                      <Th>Result</Th>
                      <Th sortKey="testsTaken" sortState={sortState} onSort={handleSort}>Tests</Th>
                      <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudentRows.map((row) => (
                      <tr key={row.studentId} className="border-t border-border/70 hover:bg-muted/40">
                        <td className="px-4 py-3 tabular-nums text-text-secondary">{row.rank ? `#${row.rank}` : "-"}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => updateParams({ college: row.collegeId || collegeId || "", department: row.departmentId || departmentId, student_id: row.studentId })}
                            className="flex items-center gap-3 text-left"
                          >
                            <Avatar name={row.name} seed={row.studentId} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-text-primary hover:text-chart-1">{row.name}</span>
                              <span className="block truncate text-xs font-normal text-text-secondary">{row.rollNo}</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{row.department}</td>
                        <td className="px-4 py-3 text-text-secondary">{row.year ? `${row.year} YEAR` : "-"}</td>
                        <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                        <td className="px-4 py-3">{row.testsTaken > 0 ? <ResultBadge score={row.avgScore} /> : <span className="text-text-secondary">-</span>}</td>
                        <td className="px-4 py-3">{row.testsTaken}</td>
                        <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            title="View student report"
                            onClick={() => updateParams({ college: row.collegeId || collegeId || "", department: row.departmentId || departmentId, student_id: row.studentId })}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-muted hover:text-primary"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sortedStudentRows.length > visibleStudentRows.length ? (
                  <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-xs text-text-secondary">
                    <span>Showing {visibleStudentRows.length} of {sortedStudentRows.length} students.</span>
                    <button
                      type="button"
                      onClick={() => setStudentVisibleLimit((value) => value + 100)}
                      className="rounded-lg border border-border px-3 py-1 font-semibold text-text-primary hover:bg-muted"
                    >
                      Show more
                    </button>
                  </div>
                ) : null}
              </article>
                </>
              )}
            </>
          ) : null}
          {showNotAttendedCard ? (
            <AbsentStudentsCard
              title={selectedTestName ? `Not Attended: ${selectedTestName}` : "Not Attended Students"}
              subtitle="Students who did not submit the selected test."
              students={notAttendedStudents}
              count={notAttendedStudents.length}
            />
          ) : null}

          {renderTestsListCard()}
        </section>
      ) : null}
    </div>
  );
}
