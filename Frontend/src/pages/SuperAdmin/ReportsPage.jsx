import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { superAdminApi } from "@/services/api";
import useSavedReportViews from "@/hooks/useSavedReportViews";
import {
  AbsentStudentsCard,
  AnalyticsSkeleton,
  Avatar,
  EmptyState,
  ExportButton,
  Pagination,
  RecentExports,
  ResultBadge,
  ScoreBadge,
  ScoreDistributionChart,
  SectionCard,
  StudentSummary,
  TabNav,
  Th,
  ViolationBadge,
} from "@/components/Reports/components";
import { AtRiskView, IntegrityView, ItemAnalysisView, TrendsView } from "@/components/Reports/advanced-views";
import { GroupPerformanceList, MetricStrip, ScoreWithMarks, TopicStrengths } from "@/components/Reports/summary-blocks";
import ReportTestsTable from "@/components/Reports/ReportTestsTable";
import { moduleColumnDefs, moduleMarksFor, moduleShortLabel, overallModuleMarks } from "@/components/Reports/module-columns";
import ReportBuilderDialog, { toReportTestFilters } from "@/components/Admin/Reports/ReportBuilderDialog";
import ViolationReviewDialog from "@/components/Reports/ViolationReviewDialog";
import { SUPER_REVIEW_ACTIONS } from "@/components/Reports/reviewActions";
import { clampPercent, formatDateLabel, formatPercent, toExportErrorMessage, toQueryString } from "@/components/Reports/utils";
import { ArrowLeft, FileBarChart2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader, SearchInput } from "@/components/common/page-kit";

const REPORT_MODES = [
  { key: "overview", label: "Overview" },
  { key: "departments", label: "Departments" },
  { key: "batch", label: "Batch" },
  { key: "student", label: "Student" },
  { key: "trends", label: "Trends" },
  { key: "at-risk", label: "At Risk" },
];

const DEEP_DIVE_VIEWS = [
  { key: "performance", label: "Results" },
  { key: "items", label: "Questions" },
  { key: "integrity", label: "Integrity" },
];

// Tabs rendered from the scoped analytics payload (the others have their own endpoints).
const ANALYTICS_MODES = new Set(["overview", "departments", "student"]);

const MODE_DEFAULT_SORT = {
  overview: { key: "avgScore", dir: "desc" },
  departments: { key: "avgScore", dir: "desc" },
  batch: { key: "avgScore", dir: "desc" },
  student: { key: "rank", dir: "asc" },
  trends: { key: "avgScore", dir: "desc" },
  "at-risk": { key: "avgScore", dir: "desc" },
};

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

// Compact "Xm Ys" (or "Ys") for durations.
const formatSecondsShort = (seconds) => {
  const safe = Math.max(0, Math.round(toNumber(seconds)));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

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
  // Deep-dive ("view details") student results table: server-side search + sort +
  // pagination, matching the College Admin per-test results table.
  const [detailSearch, setDetailSearch] = useState("");
  const [deepDiveSort, setDeepDiveSort] = useState("date");
  const [detailPage, setDetailPage] = useState(1);
  const [sortState, setSortState] = useState(MODE_DEFAULT_SORT[mode]);
  const [error, setError] = useState(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [violationDialog, setViolationDialog] = useState({ open: false, studentName: "", events: [] });
  const { views: savedViews, saveView, removeView } = useSavedReportViews("super-admin-report");
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
    queryKey: ["super-report-trends-v1", collegeId, departmentId, batchId, trendGroupBy, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportTrends(
        toQueryString({
          collegeId,
          departmentId: departmentId || undefined,
          batchId: batchId || undefined,
          groupBy: trendGroupBy,
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
    violationEvents: Array.isArray(row.violationEvents) ? row.violationEvents : [],
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
      departmentId: row.departmentId,
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
        const status = await superAdminApi.getReportJobStatus(jobId);
        setExportState((prev) => ({
          ...prev,
          status: status.status === "completed" ? "complete" : status.status === "failed" ? "failed" : "polling",
          progress: toNumber(status.progress),
          downloadUrl: status.download_url || prev.downloadUrl || `/api/super-admin/reports/${jobId}/download`,
          expiresAt: status.expires_at || prev.expiresAt,
          errorMessage: status.status === "failed" ? status.error_message || "Report generation failed." : prev.errorMessage,
          jobId,
        }));
        if (status.status === "completed" || status.status === "failed") {
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

  // Report type implied by the active tab (the Report Builder can override it).
  // Includes BATCH_WISE for the Batch tab, which the old export never produced.
  const defaultReportType = isTestDeepDive
    ? "TEST_WISE"
    : mode === "batch"
      ? "BATCH_WISE"
      : mode === "student"
        ? "STUDENT_WISE"
        : "DEPARTMENT_WISE";

  const handleExport = async (overrides = {}) => {
    const reportType = overrides.type || defaultReportType;
    // The builder always sends its test selection (empty = every test in scope).
    const { testIds: pickedTestIds = [], ...extraFilters } = overrides.filters || {};

    if (!collegeId) {
      setError("Select a college before exporting a report.");
      return;
    }

    if (reportType === "STUDENT_WISE" && !studentId) {
      setError("Select a student before exporting a student report.");
      return;
    }

    setError(null);
    setExportState({ status: "loading", progress: 0, downloadUrl: "", expiresAt: null, jobId: "", errorMessage: "" });

    try {
      const result = await superAdminApi.generateReport({
        type: reportType,
        filters: {
          collegeId,
          departmentId: departmentId || undefined,
          // Carry the active batch through so the PDF is batch-scoped exactly like
          // the College Admin report (buildInstitutionReportPayload narrows to it).
          batchId: batchId || undefined,
          studentId: studentId || undefined,
          ...toReportTestFilters(pickedTestIds),
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
          ...extraFilters,
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

  // Spreadsheet export in either format, backed by the same super-scoped dataset
  // builder on the server, so CSV and Excel can never disagree.
  const handleSpreadsheetExport = async (format = "csv", { testIds: pickedTestIds = [] } = {}) => {
    if (!collegeId || csvBusy) return;
    // Selected tests export each student's result in each test; otherwise the
    // export follows the current tab.
    const dataset = pickedTestIds.length
      ? "results"
      : isTestDeepDive && deepDiveView === "items" ? "item-analysis" : mode === "at-risk" ? "at-risk" : "tests";
    setCsvBusy(true);
    try {
      const params = toQueryString({
        dataset,
        collegeId,
        testId: dataset === "item-analysis" ? testId : undefined,
        testIds: dataset === "results" ? pickedTestIds.join(",") : undefined,
        departmentId: departmentId || undefined,
        batchId: batchId || undefined,
        year: studentYear || undefined,
        studentScope,
        passoutYear: passoutYear || undefined,
        passoutCohortId: passoutCohortId || undefined,
      });
      const blob = format === "xlsx" ? await superAdminApi.exportReportXlsx(params) : await superAdminApi.exportReportCsv(params);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${dataset}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(toExportErrorMessage(err));
    } finally {
      setCsvBusy(false);
    }
  };

  const handleGenerate = ({ type, format, filters }) => {
    if (format === "csv" || format === "xlsx") {
      handleSpreadsheetExport(format, filters);
    } else {
      handleExport({ type, filters });
    }
  };

  const handleSaveView = () => {
    const name = window.prompt("Name this view (filters + tab will be saved)");
    if (name) saveView(name, window.location.search);
  };

  const handleViolationClick = (studentName, events) => {
    setViolationDialog({ open: true, studentName: studentName || "Student", events: Array.isArray(events) ? events : [] });
  };

  const handleViolationReview = async (review) => {
    await superAdminApi.reviewReportAnomaly(review);
    testTableQuery.refetch();
    studentDetailQuery.refetch();
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

  const analyticsReady = hasCollegeSelected && !isTestDeepDive && !loading && !scopeQuery.isError;

  // One strip of the numbers that matter, instead of badge-heavy stat cards.
  const violationCount = toNumber(metrics.violations);
  const attemptedStudents = toNumber(metrics.attemptedStudents);
  const totalStudents = toNumber(metrics.totalStudents);
  const flagsMetric = {
    key: "flags",
    label: "Integrity flags",
    value: violationCount.toLocaleString(),
    hint: "Proctoring violations",
    tone: violationCount > 0 ? "danger" : "default",
  };
  const passMetric = { key: "pass", label: "Pass rate", value: formatPercent(metrics.passRate), hint: "Scored 40% or more" };

  const overviewMetrics = [
    { key: "students", label: "Students attempted", value: attemptedStudents.toLocaleString(), hint: `of ${totalStudents.toLocaleString()} in this scope` },
    { key: "avg", label: "Average score", value: formatPercent(metrics.avgScore), hint: `${toNumber(metrics.totalSubmissions).toLocaleString()} submissions` },
    passMetric,
    flagsMetric,
  ];

  const deepDiveMetrics = [
    {
      key: "attempted",
      label: "Attempted",
      value: formatPercent(metrics.participationRate),
      hint: totalStudents ? `${attemptedStudents} of ${totalStudents} students` : "Of assigned students",
    },
    { key: "avg", label: "Average score", value: formatPercent(metrics.avgScore), hint: "Submitted attempts" },
    passMetric,
    flagsMetric,
  ];

  const testsScopeLabel = selectedBatch
    ? `Batch: ${selectedBatch.name}`
    : selectedDepartment
      ? `Department: ${selectedDepartment.name}`
      : selectedCollege?.name || "Selected college";

  const reportScopeSummary = [
    selectedCollege?.name ? `College: ${selectedCollege.name}` : null,
    testsScopeLabel !== (selectedCollege?.name || "Selected college") ? testsScopeLabel : null,
    selectedStudent?.name ? `Student: ${selectedStudent.name}` : null,
    studentYear ? `${studentYear} year` : null,
    studentScope !== "current" ? STUDENT_SCOPE_OPTIONS.find((option) => option.value === studentScope)?.label : null,
  ].filter(Boolean).join(" · ");

  const renderTestsListCard = () => (
    <ReportTestsTable
      query={testsListQuery}
      scopeLabel={testsScopeLabel}
      search={testsSearch}
      onSearchChange={setTestsSearch}
      status={testsStatus}
      onStatusChange={setTestsStatus}
      sort={testsSort}
      onSortChange={setTestsSort}
      onPageChange={setTestsPage}
      onOpenTest={handleTestOpen}
    />
  );

  // Per-module averages for MODULE_TEST results, weakest module called out.
  const renderModuleSummary = (moduleStats) => {
    if (moduleStats.length === 0) return null;
    const ranked = [...moduleStats].sort((a, b) => toNumber(a.averagePercentage) - toNumber(b.averagePercentage));
    const weakest = moduleStats.length > 1 ? ranked[0] : null;
    return (
      <SectionCard
        title="Modules"
        subtitle={weakest ? `Weakest: ${weakest.name} (${formatPercent(weakest.averagePercentage)} average)` : "Average per module"}
        bodyClassName="p-0"
      >
        <div className="relative overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <Th>Module</Th>
                <Th>Average</Th>
                <Th>Completed</Th>
                <Th>Avg time</Th>
              </tr>
            </thead>
            <tbody>
              {moduleStats.map((stat) => (
                <tr key={stat.key} className="border-t border-border/70">
                  <td className="px-4 py-3 font-medium text-text-primary">{stat.name}</td>
                  <td className="px-4 py-3">
                    <ScoreWithMarks
                      percent={stat.averagePercentage}
                      obtained={toNumber(stat.averageScore).toFixed(1)}
                      total={toNumber(stat.averageMaxScore).toFixed(1)}
                    />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatPercent(stat.completionRate)}</td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatSecondsShort(stat.averageTimeSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    );
  };

  // Ranked students in scope; the Student tab uses it as the picker.
  const renderStudentRanking = (title) => (
    <SectionCard title={title} subtitle="Ranked by average score. Select a student to see their results." bodyClassName="p-0">
      <div className="relative overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <Th sortKey="rank" sortState={sortState} onSort={handleSort}>#</Th>
              <Th sortKey="name" sortState={sortState} onSort={handleSort}>Student</Th>
              <Th sortKey="department" sortState={sortState} onSort={handleSort}>Department</Th>
              <Th sortKey="year" sortState={sortState} onSort={handleSort}>Year</Th>
              <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg score</Th>
              <Th sortKey="testsTaken" sortState={sortState} onSort={handleSort}>Tests</Th>
              <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
            </tr>
          </thead>
          <tbody>
            {visibleStudentRows.map((row) => (
              <tr key={row.studentId} className="border-t border-border/70 hover:bg-muted/40">
                <td className="px-4 py-3 tabular-nums text-text-secondary">{row.rank || "-"}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => updateParams({ college: row.collegeId || collegeId || "", department: row.departmentId || departmentId, student_id: row.studentId, mode: "student" })}
                    className="flex items-center gap-3 text-left"
                  >
                    <Avatar name={row.name} seed={row.studentId} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-text-primary hover:text-primary">{row.name}</span>
                      <span className="block truncate text-xs text-text-secondary">{row.rollNo}</span>
                    </span>
                  </button>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.department}</td>
                <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.year ? `Year ${row.year}` : "-"}</td>
                <td className="px-4 py-3">{row.testsTaken > 0 ? <ScoreBadge score={row.avgScore} /> : <span className="text-text-secondary">—</span>}</td>
                <td className="px-4 py-3 tabular-nums">{row.testsTaken}</td>
                <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
              </tr>
            ))}
            {visibleStudentRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8">
                  <EmptyState title="No students in this scope" description="Adjust the filters above to find students." />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
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
    </SectionCard>
  );

  const renderSuperTestDeepDive = () => {
    const moduleColumns = moduleColumnDefs(testTableRows, scope?.modulePerformance);
    const moduleStats = Array.isArray(scope?.modulePerformance?.moduleStats) ? scope.modulePerformance.moduleStats : [];
    return (
      <section className="space-y-4">
        <article className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleTestBack}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-background px-3 text-sm font-medium text-text-primary transition-colors hover:bg-muted"
            >
              ← Back
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-text-primary">{selectedTestMeta?.title || selectedTestName || "Test results"}</h2>
              <p className="text-xs text-text-secondary">
                {[selectedCollege?.name, testsScopeLabel !== selectedCollege?.name ? testsScopeLabel : null].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <TabNav tabs={DEEP_DIVE_VIEWS} active={deepDiveView} onChange={setDeepDiveView} />
          </div>
        </article>

        {deepDiveView === "items" ? <ItemAnalysisView query={itemAnalysisQuery} /> : null}
        {deepDiveView === "integrity" ? <IntegrityView query={integrityQuery} /> : null}

        {deepDiveView !== "performance" ? null : scopeQuery.isLoading ? (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-text-secondary" role="status">Loading test results…</div>
        ) : scopeQuery.isError ? (
          <ErrorState title="Unable to load test results." />
        ) : (
          <>
            <MetricStrip items={deepDiveMetrics} />

            {renderModuleSummary(moduleStats)}

            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title="Score distribution">
                <ScoreDistributionChart data={scope.distribution || []} height="h-[200px]" />
              </SectionCard>
              <SectionCard title="Topics">
                <TopicStrengths topics={subjectData} />
              </SectionCard>
            </div>

            <SectionCard
              title="Student results"
              subtitle={testTableQuery.isFetching ? "Updating…" : `${toNumber(testTablePagination.total)} submissions`}
              bodyClassName="p-0"
              right={
                <>
                  <input
                    value={detailSearch}
                    onChange={(event) => setDetailSearch(event.target.value)}
                    placeholder="Search student or roll no"
                    aria-label="Search student results"
                    className="h-9 w-full basis-full rounded-lg border border-border bg-background px-3 text-sm sm:w-56 sm:basis-auto"
                  />
                  <select
                    value={deepDiveSort}
                    onChange={(event) => setDeepDiveSort(event.target.value)}
                    aria-label="Sort student results"
                    className="ui-select"
                  >
                    <option value="score">Highest score</option>
                    <option value="studentName">Name (A–Z)</option>
                    <option value="violationCount">Most violations</option>
                    <option value="timeTaken">Longest time</option>
                    <option value="date">Most recent</option>
                  </select>
                </>
              }
            >
              <div className="relative overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <Th>Student</Th>
                      <Th>Department · Batch</Th>
                      <Th>Score</Th>
                      {moduleColumns.map((mod) => (
                        <Th key={mod.key}>{moduleShortLabel(mod.key)}</Th>
                      ))}
                      <Th>Result</Th>
                      <Th>Violations</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {testTableRows.map((row) => {
                      const overall = moduleColumns.length > 0 ? overallModuleMarks(row) : null;
                      return (
                        <tr key={row.submissionId || row.id} className="border-t border-border/70 hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar name={row.studentName} seed={row.studentId} />
                              <div className="min-w-0">
                                <p className="truncate font-medium text-text-primary">{row.studentName || "-"}</p>
                                <p className="truncate text-xs text-text-secondary">{row.studentRollNo || "-"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.department || "-"} · {row.batch || "-"}</td>
                          <td className="px-4 py-3">
                            <ScoreWithMarks
                              percent={row.scorePercent ?? row.score}
                              obtained={overall ? overall.obtained : row.obtainedMarks}
                              total={overall ? overall.max : row.totalMarks}
                            />
                          </td>
                          {moduleColumns.map((mod) => {
                            const marks = moduleMarksFor(row, mod);
                            return (
                              <td key={mod.key} className="px-4 py-3 tabular-nums text-text-primary">
                                {marks == null ? <span className="text-text-secondary">—</span> : marks}
                              </td>
                            );
                          })}
                          <td className="px-4 py-3">
                            <ResultBadge status={row.status} score={row.scorePercent ?? row.score} />
                            {row.status && row.status !== "SUBMITTED" ? (
                              <p className="mt-1 text-[11px] text-text-secondary">{String(row.status).replace(/_/g, " ").toLowerCase()}</p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => handleViolationClick(row.studentName, row.violations)}
                              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              title="Review violations"
                            >
                              <ViolationBadge count={row.violationCount} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {testTableRows.length === 0 ? (
                      <tr>
                        <td colSpan={5 + moduleColumns.length} className="px-4 py-8">
                          <EmptyState title="No submissions yet" description="Student results appear once this test has submissions." />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border/70 p-4">
                <Pagination page={testTablePagination.page} totalPages={testTablePagination.totalPages} total={testTablePagination.total} onPageChange={setDetailPage} />
              </div>
            </SectionCard>

            {notAttendedStudents.length > 0 ? (
              <AbsentStudentsCard
                title="Did not attempt"
                subtitle="Assigned students with no submission for this test."
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
    <div className="space-y-6">
      {error ? <ErrorState title="Report error" description={error} /> : null}

      <PageHeader
        eyebrow="Reporting dashboard"
        title="Reports"
        description="College, department, and student performance analytics with integrity tracking."
        actions={
          exportState.status === "idle" ? (
            <Button
              type="button"
              onClick={() => setBuilderOpen(true)}
              disabled={!hasCollegeSelected || csvBusy}
              title={!hasCollegeSelected ? "Select a college before exporting reports." : ""}
              className="h-10 rounded-lg px-4"
            >
              <FileBarChart2 className="size-4" />
              {csvBusy ? "Preparing…" : "Generate Report"}
            </Button>
          ) : (
            <ExportButton
              exportState={exportState}
              onExport={() => setBuilderOpen(true)}
              onDownload={handleDownload}
              disabled={!hasCollegeSelected}
              disabledReason={!hasCollegeSelected ? "Select a college before exporting reports." : ""}
            />
          )
        }
      />

      <section className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
        <div className="-mx-4 border-b border-border px-4 sm:-mx-5 sm:px-5">
          <TabNav
            tabs={REPORT_MODES.map((item) => ({ key: item.key, label: item.label }))}
            active={mode}
            onChange={handleModeSwitch}
            className="border-b-0"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <label className="space-y-1 text-xs text-text-secondary">
            <span>College</span>
            <select
              value={collegeId}
              onChange={(event) => handleCollegeChange(event.target.value)}
              className="ui-select w-full"
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
              className="ui-select w-full"
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
              className="ui-select w-full"
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
              className="ui-select w-full"
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
                  className="ui-select w-full"
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
                  className="ui-select w-full"
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
              className="ui-select w-full"
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
            <SearchInput
              label="Search students"
              value={studentSearch}
              onChange={(event) => setStudentSearch(event.target.value)}
              placeholder="Search student by name, email, or roll number"
              disabled={!collegeId}
            />
            {studentSearch.trim().length >= 2 ? (
              <div className="absolute z-20 mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
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
                    className="block w-full rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
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

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs font-medium text-text-secondary">Saved views</span>
          {savedViews.length === 0 ? (
            <span className="text-xs text-text-secondary">None yet — save the current filters to reuse them.</span>
          ) : (
            savedViews.map((view) => (
              <span key={view.id} className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-background pr-1 pl-3 text-xs">
                <button type="button" onClick={() => setSearchParams(new URLSearchParams(view.search))} className="rounded font-medium text-text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                  {view.name}
                </button>
                <button
                  type="button"
                  onClick={() => removeView(view.id)}
                  aria-label={`Remove saved view ${view.name}`}
                  className="grid size-6 place-items-center rounded-full text-text-secondary outline-none hover:bg-danger/10 hover:text-danger focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))
          )}
          <button
            type="button"
            onClick={handleSaveView}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-border px-3 text-xs font-medium text-text-secondary outline-none hover:bg-muted hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Plus className="size-3.5" />
            Save current view
          </button>
        </div>
      </section>

      {!hasCollegeSelected && !collegesQuery.isLoading ? (
        <section className="rounded-xl border border-dashed border-border bg-card">
          <EmptyState title="Select a college" description="Choose a college above to see its reports." />
        </section>
      ) : null}

      {hasCollegeSelected && isTestDeepDive ? renderSuperTestDeepDive() : null}

      {hasCollegeSelected && !isTestDeepDive && (ANALYTICS_MODES.has(mode) || mode === "batch") && loading ? <AnalyticsSkeleton /> : null}
      {hasCollegeSelected && !isTestDeepDive && (ANALYTICS_MODES.has(mode) || mode === "batch") && scopeQuery.isError ? (
        <ErrorState title="Unable to load report data." onRetry={() => scopeQuery.refetch()} />
      ) : null}

      {hasCollegeSelected && !isTestDeepDive && mode === "batch" ? (
        <section className="space-y-4">
          <article className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <label className="block max-w-sm space-y-1 text-xs text-text-secondary">
              <span>Batch</span>
              <select
                value={batchId}
                onChange={(event) => handleBatchChange(event.target.value)}
                className="ui-select w-full"
              >
                <option value="">All batches in this college</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>{batch.name}</option>
                ))}
              </select>
            </label>
          </article>
          {analyticsReady ? (
            <>
              <MetricStrip items={overviewMetrics} />
              {renderStudentRanking(selectedBatch ? `${selectedBatch.name} — students` : "Students")}
            </>
          ) : null}
          {renderTestsListCard()}
        </section>
      ) : null}

      {hasCollegeSelected && !isTestDeepDive && mode === "trends" ? (
        <TrendsView query={trendsQuery} groupBy={trendGroupBy} onGroupByChange={setTrendGroupBy} showGroupBy />
      ) : null}

      {hasCollegeSelected && !isTestDeepDive && mode === "at-risk" ? (
        <AtRiskView query={atRiskQuery} canViewStudent onViewStudent={(id) => updateParams({ mode: "student", student_id: id })} />
      ) : null}

      {analyticsReady && mode === "overview" ? (
        <section className="space-y-4">
          <MetricStrip items={overviewMetrics} />

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Score distribution">
              <ScoreDistributionChart data={scope.distribution || []} height="h-[200px]" />
            </SectionCard>
            <SectionCard title="Topics">
              <TopicStrengths topics={subjectData} />
            </SectionCard>
          </div>

          <SectionCard title="Departments" subtitle="Ranked by average score — select one to focus the report">
            <GroupPerformanceList
              rows={departmentChartRows}
              labelKey="department"
              onSelect={(row) => row.departmentId && handleDepartmentChange(row.departmentId)}
            />
          </SectionCard>

          {renderTestsListCard()}

          <RecentExports reports={reports} onDownload={downloadJob} subtitle="Generated PDFs for this college." />
        </section>
      ) : null}

      {analyticsReady && mode === "departments" ? (
        <SectionCard title="Departments" subtitle="Select a department to open its report" bodyClassName="p-0">
          <div className="relative overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <Th sortKey="department" sortState={sortState} onSort={handleSort}>Department</Th>
                  <Th sortKey="students" sortState={sortState} onSort={handleSort}>Students</Th>
                  <Th sortKey="submissions" sortState={sortState} onSort={handleSort}>Submissions</Th>
                  <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg score</Th>
                  <Th sortKey="passRate" sortState={sortState} onSort={handleSort}>Pass rate</Th>
                  <Th sortKey="participation" sortState={sortState} onSort={handleSort}>Participation</Th>
                  <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                </tr>
              </thead>
              <tbody>
                {sortedDepartmentRows.map((row) => (
                  <tr key={row.departmentId || row.department} className="border-t border-border/70 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => updateParams({ department: row.departmentId || "", mode: "", student_id: "", batch_id: "" })}
                        className="text-left font-medium text-text-primary hover:text-primary"
                      >
                        {row.department}
                      </button>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.students}</td>
                    <td className="px-4 py-3 tabular-nums">{row.submissions}</td>
                    <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                    <td className="px-4 py-3 tabular-nums">{formatPercent(row.passRate)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatPercent(row.participation)}</td>
                    <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                  </tr>
                ))}
                {sortedDepartmentRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8">
                      <EmptyState title="No department results yet" description="Department results appear after students submit tests." />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {analyticsReady && mode === "student" && studentId ? (
        <section className="space-y-4">
          <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={() => updateParams({ student_id: "" })}>
            <ArrowLeft className="size-4" />
            All students
          </Button>

          {studentDetailQuery.isLoading ? (
            <section className="rounded-xl border border-border bg-card p-4 text-sm text-text-secondary" role="status">Loading student results…</section>
          ) : (
            <>
              <StudentSummary student={selectedStudent} metrics={selectedStudentMetrics} />

              <SectionCard title="Topics">
                <TopicStrengths topics={(studentDetail.subjectPerformance || []).map((row) => ({ subject: row.subject, score: toNumber(row.score) }))} />
              </SectionCard>

              <SectionCard title="Test attempts" subtitle={`${attemptRows.length} submitted`} bodyClassName="p-0">
                <div className="relative overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr>
                        <Th sortKey="date" sortState={sortState} onSort={handleSort}>Date</Th>
                        <Th sortKey="testName" sortState={sortState} onSort={handleSort}>Test</Th>
                        <Th sortKey="scorePercent" sortState={sortState} onSort={handleSort}>Score</Th>
                        <Th>Result</Th>
                        <Th sortKey="timeTaken" sortState={sortState} onSort={handleSort}>Time</Th>
                        <Th sortKey="violationsCount" sortState={sortState} onSort={handleSort}>Violations</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAttemptRows.map((row) => (
                        <tr key={row.id} className="border-t border-border/70 hover:bg-muted/40">
                          <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{formatDateLabel(row.date)}</td>
                          <td className="px-4 py-3 font-medium text-text-primary">{row.testName}</td>
                          <td className="px-4 py-3"><ScoreWithMarks percent={row.scorePercent} obtained={row.obtainedMarks} total={row.totalMarks} /></td>
                          <td className="px-4 py-3"><ResultBadge status={row.status} score={row.scorePercent} /></td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">{formatSecondsShort(row.timeTaken)}</td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => handleViolationClick(selectedStudent?.name, row.violationEvents)}
                              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              title="Review violations"
                            >
                              <ViolationBadge count={row.violationsCount} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {sortedAttemptRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8">
                            <EmptyState title="No submitted tests" description="This student's submitted tests will appear here." />
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          )}
        </section>
      ) : null}

      {analyticsReady && mode === "student" && !studentId ? renderStudentRanking("Students") : null}

      <ReportBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        defaultType={defaultReportType}
        scopeSummary={reportScopeSummary}
        hasStudent={Boolean(studentId)}
        tests={tests}
        defaultTestIds={isTestDeepDive ? [testId] : []}
        onGenerate={handleGenerate}
      />

      <ViolationReviewDialog
        open={violationDialog.open}
        onOpenChange={(open) => setViolationDialog((prev) => ({ ...prev, open }))}
        studentName={violationDialog.studentName}
        events={violationDialog.events}
        actions={SUPER_REVIEW_ACTIONS}
        onReview={handleViolationReview}
      />
    </div>
  );
}
