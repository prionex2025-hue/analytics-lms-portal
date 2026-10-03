import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import usePermission from "@/hooks/usePermission";
import useSavedReportViews from "@/hooks/useSavedReportViews";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { isCollegeAdminRole } from "@/features/Admin/adminRole";
import { adminApi } from "@/services/api";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState, PageHeader, SearchInput } from "@/components/common/page-kit";
import { FileDown } from "lucide-react";
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
  StatusBadge,
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
import { ADMIN_REVIEW_ACTIONS } from "@/components/Reports/reviewActions";
import { clampPercent, comparePercentDesc, formatDateLabel, formatPercent, percentOrNull, toExportErrorMessage, toQueryString } from "@/components/Reports/utils";

// Same mode set as the Super-Admin reports page; the Departments tab is only
// offered to college-level admins (a department admin's scope is one
// department, enforced server-side by buildAdminReportScope).
const buildReportModes = (isCollegeScope) => [
  { key: "overview", label: "Overview" },
  ...(isCollegeScope ? [{ key: "departments", label: "Departments" }] : []),
  { key: "batch", label: "Batch" },
  { key: "student", label: "Student" },
  { key: "trends", label: "Trends" },
  { key: "at-risk", label: "At Risk" },
];

const YEAR_OPTIONS = ["1", "2", "3", "4"];

// Tabs rendered from the main analytics payload (the others have their own endpoints).
const ANALYTICS_MODES = new Set(["overview", "departments", "student"]);
const STUDENT_SCOPE_OPTIONS = [
  { value: "current", label: "Current" },
  { value: "passout", label: "Passed Out" },
  { value: "all", label: "All" },
];

const NUMERIC_SORT_KEYS = new Set([
  "rank", "students", "submissions", "avgScore", "passRate", "participation",
  "testsTaken", "violations", "year", "scorePercent", "obtainedMarks", "timeTaken", "violationsCount",
]);

const toNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

// Compact "Xm Ys" (or "Ys") for average per-module time.
const formatSecondsShort = (seconds) => {
  const safe = Math.max(0, Math.round(toNumber(seconds)));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
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

export default function ReportsPage({ basePathOverride = null, showStudentDepartmentFilter = false } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = basePathOverride || (location.pathname.startsWith("/college-admin") ? "/college-admin" : "/admin");
  const apiBasePath = `/api${basePath}`;
  const queryKeyPrefix = basePath === "/college-admin" ? "college-admin-report" : "admin-report";
  const [searchParams, setSearchParams] = useSearchParams();

  const authState = useAdminAuthState();
  const adminRole = authState?.admin?.role || null;
  // College-level scope: college-admin portal, a college-admin role, or the
  // wrapper explicitly asking for cross-department filters.
  const isCollegeScope = basePath === "/college-admin" || isCollegeAdminRole(adminRole) || showStudentDepartmentFilter;
  const REPORT_MODES = useMemo(() => buildReportModes(isCollegeScope), [isCollegeScope]);

  const canViewReports = usePermission(ADMIN_PERMISSIONS.VIEW_REPORTS);
  const canExportReports = usePermission(ADMIN_PERMISSIONS.EXPORT_REPORTS);
  const canViewTests = usePermission(ADMIN_PERMISSIONS.VIEW_TESTS);
  const canEditTests = usePermission(ADMIN_PERMISSIONS.EDIT_TEST);
  const canManageQuestions = usePermission(ADMIN_PERMISSIONS.MANAGE_QUESTIONS);
  const canViewBatches = usePermission(ADMIN_PERMISSIONS.VIEW_BATCHES);
  const canManageBatches = usePermission(ADMIN_PERMISSIONS.MANAGE_BATCHES);
  const canViewStudents = usePermission(ADMIN_PERMISSIONS.VIEW_STUDENTS);
  const canManageStudents = usePermission(ADMIN_PERMISSIONS.MANAGE_STUDENTS);
  const canManageDepartments = usePermission(ADMIN_PERMISSIONS.MANAGE_DEPARTMENTS);
  const canReadTests = canViewTests || canEditTests || canManageQuestions;
  const canReadBatches = canViewBatches || canManageBatches;
  const canReadStudents = canViewStudents || canManageStudents;
  const canReadDepartments = canReadBatches || canManageDepartments;

  const mode = REPORT_MODES.some((item) => item.key === searchParams.get("mode")) ? searchParams.get("mode") : "overview";
  const departmentId = isCollegeScope ? searchParams.get("department") || "" : "";
  const batchId = searchParams.get("batch_id") || "";
  const testId = searchParams.get("test") || "all";
  const studentId = searchParams.get("student_id") || "";
  const rawStudentScope = searchParams.get("student_scope") || "current";
  const studentScope = STUDENT_SCOPE_OPTIONS.some((item) => item.value === rawStudentScope) ? rawStudentScope : "current";
  const passoutYear = searchParams.get("passout_year") || "";
  const passoutCohortId = searchParams.get("passout_cohort") || "";
  const isTestDeepDive = Boolean(testId) && testId !== "all";

  const [studentSearch, setStudentSearch] = useState("");
  const [studentYear, setStudentYear] = useState("");
  const [sortState, setSortState] = useState({ key: "avgScore", dir: "desc" });
  const [testsSearch, setTestsSearch] = useState("");
  const [testsSort, setTestsSort] = useState("startsAt");
  const [testsStatus, setTestsStatus] = useState("all");
  const [testsPage, setTestsPage] = useState(1);
  const [deepDivePage, setDeepDivePage] = useState(1);
  const [deepDiveSearch, setDeepDiveSearch] = useState("");
  const [deepDiveSort, setDeepDiveSort] = useState("score");
  const [deepDiveView, setDeepDiveView] = useState("performance");
  const [trendGroupBy, setTrendGroupBy] = useState(isCollegeScope ? "department" : "batch");
  const [csvBusy, setCsvBusy] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [exportState, setExportState] = useState({ status: "idle", progress: 0, downloadUrl: "", expiresAt: null, jobId: "", errorMessage: "" });
  const [violationDialog, setViolationDialog] = useState({ open: false, studentName: "", events: [] });
  const { views: savedViews, saveView, removeView } = useSavedReportViews(queryKeyPrefix);
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

  // ------------------------------------------------------------------ queries
  const testsQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-tests-v2`],
    queryFn: () => adminApi.getTests("?page=1&limit=100"),
    enabled: canViewReports && canReadTests,
    staleTime: 120000,
  });

  const batchesQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-batches-v2`],
    queryFn: () => adminApi.getBatches(),
    enabled: canViewReports && canReadBatches,
    staleTime: 120000,
  });

  const departmentsQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-departments-v2`],
    queryFn: () => adminApi.getDepartments(),
    enabled: canViewReports && canReadDepartments && isCollegeScope,
    staleTime: 120000,
  });

  const passoutCohortsQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-passout-cohorts-v1`],
    queryFn: () => adminApi.getPassoutCohorts(),
    enabled: canViewReports,
    staleTime: 120000,
  });

  const reportsJobsQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-jobs-v1`],
    queryFn: () => adminApi.getReportJobs(),
    enabled: canViewReports,
    staleTime: 30000,
  });

  const studentSearchTerm = studentSearch.trim();
  const studentSearchQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-student-search-v2`, studentSearchTerm, studentYear, departmentId, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      adminApi.getStudents(
        toQueryString({
          page: 1,
          limit: 8,
          search: studentSearchTerm,
          year: studentYear || undefined,
          departmentId: departmentId || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: canViewReports && canReadStudents && mode === "student" && studentSearchTerm.length >= 2,
    staleTime: 30000,
  });

  // Analytics mode mapping: overview/departments read department-mode analytics,
  // batch reads batch mode, student reads student mode. Trends/At-Risk and the
  // tests list have their own dedicated endpoints.
  // Student mode needs a selected student (the backend narrows to that one
  // student). With none selected, the Student tab lists every student ranked,
  // which is exactly the department-mode payload the Overview already loads.
  const analyticsMode = mode === "batch" ? "batch" : mode === "student" && studentId ? "student" : "department";
  const analyticsQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-analytics-v2`, analyticsMode, testId, departmentId, batchId, studentId, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      adminApi.getReportAnalytics(
        toQueryString({
          mode: analyticsMode,
          testId,
          departmentId: departmentId || undefined,
          batchId: mode === "batch" ? batchId || undefined : undefined,
          studentId: mode === "student" ? studentId || undefined : undefined,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled:
      canViewReports &&
      mode !== "trends" &&
      mode !== "at-risk" &&
      !(mode === "batch" && !isTestDeepDive),
    staleTime: 45000,
  });

  const studentDetailQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-student-detail-v2`, studentId, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      adminApi.getReportStudentDetail(
        studentId,
        toQueryString({
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: canViewReports && mode === "student" && Boolean(studentId) && !isTestDeepDive,
    staleTime: 45000,
  });

  const testsListQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-tests-list-v2`, departmentId, batchId, testsPage, testsSort, testsStatus, testsSearch.trim(), studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      adminApi.getReportTests(
        toQueryString({
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
    // Same as the Super-Admin page: the tests list is shown on every scope tab
    // (overview / departments / batch / student), scoped by the active filters.
    enabled: canViewReports && !isTestDeepDive && ["overview", "departments", "batch", "student"].includes(mode),
    placeholderData: (prev) => prev,
    staleTime: 30000,
  });

  const testTableQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-test-table-v2`, testId, departmentId, batchId, deepDivePage, deepDiveSearch.trim(), deepDiveSort, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      adminApi.getReportTable(
        toQueryString({
          testId,
          // Carry the active department/batch scope so a per-test results table
          // opened from the Batch tab is narrowed to that batch's students, not
          // every student who took the test.
          departmentId: departmentId || undefined,
          batchId: batchId || undefined,
          page: deepDivePage,
          limit: 10,
          sortBy: deepDiveSort,
          sortDir: deepDiveSort === "studentName" ? "asc" : "desc",
          search: deepDiveSearch.trim() || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: canViewReports && isTestDeepDive && deepDiveView === "performance",
    placeholderData: (prev) => prev,
    staleTime: 30000,
  });

  const itemAnalysisQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-item-analysis-v1`, testId, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      adminApi.getReportItemAnalysis(
        toQueryString({ testId, studentScope, passoutYear: passoutYear || undefined, passoutCohortId: passoutCohortId || undefined })
      ),
    enabled: canViewReports && isTestDeepDive && deepDiveView === "items",
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  const integrityQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-integrity-v1`, testId, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      adminApi.getReportIntegrity(
        toQueryString({ testId, studentScope, passoutYear: passoutYear || undefined, passoutCohortId: passoutCohortId || undefined })
      ),
    enabled: canViewReports && isTestDeepDive && deepDiveView === "integrity",
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  const trendsQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-trends-v1`, trendGroupBy, departmentId, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      adminApi.getReportTrends(
        toQueryString({
          groupBy: trendGroupBy,
          departmentId: departmentId || undefined,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: canViewReports && mode === "trends" && !isTestDeepDive,
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  const atRiskQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-at-risk-v1`, departmentId, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      adminApi.getReportAtRisk(
        toQueryString({
          departmentId: departmentId || undefined,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: canViewReports && mode === "at-risk" && !isTestDeepDive,
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  // ------------------------------------------------------------ derived data
  const tests = testsQuery.data?.data || [];
  const batches = batchesQuery.data || [];
  const departments = Array.isArray(departmentsQuery.data) ? departmentsQuery.data : [];
  const passoutCohortsData = passoutCohortsQuery.data?.data;
  const passoutCohorts = Array.isArray(passoutCohortsData) ? passoutCohortsData : [];
  const passoutYearOptions = [...new Set(passoutCohorts.map((cohort) => String(cohort.passoutYear || "")).filter(Boolean))];
  const visiblePassoutCohorts = passoutCohorts.filter((cohort) => !passoutYear || String(cohort.passoutYear) === String(passoutYear));
  const reportJobs = Array.isArray(reportsJobsQuery.data?.data)
    ? reportsJobsQuery.data.data
    : Array.isArray(reportsJobsQuery.data)
      ? reportsJobsQuery.data
      : [];
  const studentSearchData = studentSearchQuery.data?.data;
  const studentMatches = studentSearchTerm.length >= 2 && Array.isArray(studentSearchData) ? studentSearchData : [];

  const analytics = analyticsQuery.data || {};
  const metrics = analytics.metrics || {};
  const violationCount = toNumber(metrics.violations);
  const testTableRows = Array.isArray(testTableQuery.data?.data) ? testTableQuery.data.data : [];
  const testTablePagination = testTableQuery.data?.pagination || { page: 1, totalPages: 1, total: 0 };
  const selectedTestMeta = tests.find((item) => String(item.id) === String(testId)) || null;
  const selectedDepartment = departments.find((item) => String(item.id) === String(departmentId)) || null;
  const selectedBatch = batches.find((item) => String(item.id) === String(batchId)) || null;

  const notAttended = analytics?.notAttended || {};
  const notAttendedStudents = Array.isArray(notAttended.students) ? notAttended.students : [];

  const topicData = (analytics.topicPerformance || []).map((item, index) => ({
    subject: item.subject || item.topic || `Topic ${index + 1}`,
    score: toNumber(item.score || item.avgScore),
  }));

  // The API answers `null` for a percentage it has no data for (a department or
  // batch where nobody attempted). `percentOrNull` keeps that missing instead of
  // collapsing it into a real 0%, which would claim students scored zero.
  const departmentRows = (analytics.departmentComparative || []).map((item) => ({
    departmentId: item.departmentId,
    department: item.departmentName || item.department || "-",
    students: toNumber(item.students),
    submissions: toNumber(item.submissions),
    avgScore: percentOrNull(item.avgScore),
    passRate: percentOrNull(item.passRate),
    participation: percentOrNull(item.participationRate ?? item.participation),
    violations: toNumber(item.violations),
  }));

  const batchComparative = (analytics.batchComparative || []).map((item) => ({
    batch: item.batchName || item.batch || "-",
    avgScore: percentOrNull(item.avgScore),
    passRate: percentOrNull(item.passRate),
    participation: percentOrNull(item.participationRate),
  }));

  // Highest first, with departments/batches that have no data ranked last rather
  // than as a real 0 (a plain subtraction would coerce `null` to 0 and let
  // "no data" masquerade as the worst performer).
  const comparativeChartRows = (isCollegeScope ? departmentRows : batchComparative)
    .slice()
    .sort((a, b) => comparePercentDesc(a.avgScore, b.avgScore))
    .slice(0, 12);

  const studentLogRows = (analytics.tableRows || []).map((row, index) => ({
    rank: toNumber(row.rank || index + 1),
    studentId: row.studentId,
    name: row.name || "-",
    rollNo: row.rollNo || row.studentId || "-",
    department: row.department || row.departmentName || "-",
    batch: row.batch || row.batchName || "-",
    year: row.year || null,
    avgScore: clampPercent(row.avgScore),
    testsTaken: toNumber(row.testsTaken),
    violations: toNumber(row.violations),
    violationEvents: Array.isArray(row.violationEvents) ? row.violationEvents : [],
  }));

  const attemptRows = ((studentDetailQuery.data?.tests || analytics.attemptHistory) || []).map((item) => ({
    id: item.id,
    testId: item.testId,
    testName: item.testName || item.testTitle || "-",
    subject: item.subject || "-",
    scorePercent: clampPercent(item.scorePercent ?? item.accuracy ?? 0),
    obtainedMarks: toNumber(item.obtainedMarks),
    totalMarks: toNumber(item.totalMarks),
    timeTaken: toNumber(item.timeTaken),
    date: item.date,
    status: item.status || "-",
    violationsCount: toNumber(item.violationsCount),
    violationEvents: Array.isArray(item.violationEvents) ? item.violationEvents : [],
  }));

  const selectedStudent = analytics.selectedStudent || studentDetailQuery.data?.student || null;
  const selectedStudentMetrics = {
    avgScore: metrics.avgScore,
    totalSubmissions: attemptRows.length,
    violations: metrics.violations,
  };

  const sortedDepartmentRows = sortRows(departmentRows, sortState);
  const sortedStudentLogRows = sortRows(studentLogRows, sortState);
  const sortedAttemptRows = sortRows(attemptRows, sortState);

  // ------------------------------------------------------ headline metrics
  // One strip of the numbers that matter, instead of badge-heavy stat cards.
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
    {
      key: "students",
      label: "Students attempted",
      value: attemptedStudents.toLocaleString(),
      hint: `of ${totalStudents.toLocaleString()} ${isCollegeScope ? "in this scope" : "in your department"}`,
    },
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
      : isCollegeScope
        ? "All departments"
        : "Your department";

  // Human-readable summary of the active filters, shown in the Report Builder so
  // the admin sees exactly what the generated report will cover.
  const scopeParts = [
    testsScopeLabel,
    selectedStudent?.name ? `Student: ${selectedStudent.name}` : null,
    studentYear ? `${studentYear} year` : null,
    studentScope !== "current" ? STUDENT_SCOPE_OPTIONS.find((o) => o.value === studentScope)?.label : null,
  ].filter(Boolean);
  const reportScopeSummary = scopeParts.join(" · ");

  // ------------------------------------------------------------------ effects
  useEffect(() => {
    if (mode !== "student") setStudentSearch("");
  }, [mode]);

  useEffect(() => {
    setTestsPage(1);
  }, [testsSearch, testsSort, testsStatus, departmentId, batchId, studentYear, studentScope, passoutYear, passoutCohortId]);

  useEffect(() => {
    setDeepDivePage(1);
    setDeepDiveView("performance");
    setDeepDiveSearch("");
    setDeepDiveSort("score");
  }, [testId]);

  useEffect(() => {
    setDeepDivePage(1);
  }, [deepDiveSearch, deepDiveSort]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ----------------------------------------------------------------- exports
  const startPollingJob = (jobId) => {
    if (!jobId) return;
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const status = await adminApi.getReportJobStatus(jobId);
        setExportState((prev) => ({
          ...prev,
          status: status.status === "completed" ? "complete" : status.status === "failed" ? "failed" : "polling",
          progress: toNumber(status.progress),
          downloadUrl: status.download_url || prev.downloadUrl || `${apiBasePath}/reports/${jobId}/download`,
          expiresAt: status.expires_at || prev.expiresAt,
          jobId,
        }));
        if (status.status === "completed" || status.status === "failed") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          reportsJobsQuery.refetch();
        }
      } catch (error) {
        setExportState((prev) => ({ ...prev, status: "failed", errorMessage: toExportErrorMessage(error) }));
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 1800);
  };

  // Report type implied by the active tab; the Report Builder dialog can
  // override it (e.g. choosing COMPREHENSIVE from any tab).
  const defaultReportType = isTestDeepDive
    ? "TEST_WISE"
    : mode === "batch"
      ? "BATCH_WISE"
      : mode === "student"
        ? "STUDENT_WISE"
        : "DEPARTMENT_WISE";

  const handleExport = async (overrides = {}) => {
    if (!canExportReports) return;
    const reportType = overrides.type || defaultReportType;
    // The builder always sends its test selection (empty = every test in scope).
    const { testIds: pickedTestIds = [], ...extraFilters } = overrides.filters || {};

    setExportState({ status: "loading", progress: 0, downloadUrl: "", expiresAt: null, jobId: "", errorMessage: "" });
    try {
      const result = await adminApi.generateReport({
        type: reportType,
        filters: {
          ...toReportTestFilters(pickedTestIds),
          departmentId: departmentId || undefined,
          batchId: batchId || undefined,
          studentId: studentId || undefined,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
          ...extraFilters,
        },
      });
      const jobId = result?.jobId;
      if (!jobId) {
        setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "", errorMessage: "Report generation did not return a job id. Please try again." });
        return;
      }
      setExportState({ status: "polling", progress: 5, downloadUrl: `${apiBasePath}/reports/${jobId}/download`, expiresAt: null, jobId, errorMessage: "" });
      startPollingJob(jobId);
    } catch (error) {
      setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "", errorMessage: toExportErrorMessage(error) });
    }
  };

  const downloadJob = async (jobId, retried = false) => {
    try {
      const blob = await adminApi.downloadReport(jobId);
      const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${queryKeyPrefix}-${jobId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportState((prev) => ({ ...prev, status: "complete", errorMessage: "" }));
    } catch (error) {
      if (error?.code === "REPORT_URL_EXPIRED" && !retried) {
        try {
          await adminApi.regenerateReportLink(jobId);
          await downloadJob(jobId, true);
          return;
        } catch (refreshError) {
          setExportState((prev) => ({
            ...prev,
            status: "failed",
            errorMessage: toExportErrorMessage(refreshError) || toExportErrorMessage(error),
          }));
          return;
        }
      }
      setExportState((prev) => ({
        ...prev,
        status: "failed",
        errorMessage: toExportErrorMessage(error),
      }));
    }
  };

  const handleDownload = async () => {
    if (!exportState.jobId) return;
    try {
      const isExpired = exportState.expiresAt && new Date(exportState.expiresAt).getTime() <= Date.now();
      if (isExpired) {
        const refreshed = await adminApi.regenerateReportLink(exportState.jobId);
        setExportState((prev) => ({
          ...prev,
          downloadUrl: refreshed.resultUrl || prev.downloadUrl,
          expiresAt: refreshed.expiresAt || prev.expiresAt,
        }));
      }
      await downloadJob(exportState.jobId);
    } catch (error) {
      setExportState((prev) => ({ ...prev, status: "failed", errorMessage: toExportErrorMessage(error) }));
    }
  };

  // Spreadsheet export in either format; both hit the same server-side dataset
  // assembly, so CSV and Excel can never disagree.
  const handleSpreadsheetExport = async (format = "csv", { testIds: pickedTestIds = [] } = {}) => {
    if (!canExportReports || csvBusy) return;
    // Selected tests export each student's result in each test; otherwise the
    // export follows the current tab.
    const dataset = pickedTestIds.length
      ? "results"
      : isTestDeepDive && deepDiveView === "items" ? "item-analysis" : mode === "at-risk" ? "at-risk" : "tests";
    setCsvBusy(true);
    try {
      const params = toQueryString({
        dataset,
        testId: dataset === "item-analysis" ? testId : undefined,
        testIds: dataset === "results" ? pickedTestIds.join(",") : undefined,
        departmentId: departmentId || undefined,
        batchId: batchId || undefined,
        year: studentYear || undefined,
        studentScope,
        passoutYear: passoutYear || undefined,
        passoutCohortId: passoutCohortId || undefined,
      });
      const blob = format === "xlsx" ? await adminApi.exportReportXlsx(params) : await adminApi.exportReportCsv(params);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${dataset}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (_error) {
      // Export button simply resets; nothing destructive to surface.
    } finally {
      setCsvBusy(false);
    }
  };

  const handleSaveView = () => {
    const name = window.prompt("Name this view (filters + tab will be saved)");
    if (name) saveView(name, window.location.search);
  };

  // Report Builder dialog → route to the async PDF job or the spreadsheet export
  // depending on the chosen format. Both reuse the existing export plumbing.
  const handleGenerate = ({ type, format, filters }) => {
    if (format === "csv" || format === "xlsx") {
      handleSpreadsheetExport(format, filters);
    } else {
      handleExport({ type, filters });
    }
  };

  // ---------------------------------------------------------------- handlers
  const handleSort = (key) => {
    setSortState((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  const handleModeSwitch = (nextMode) => {
    updateParams({
      mode: nextMode === "overview" ? "" : nextMode,
      student_id: "",
      test: "",
      batch_id: nextMode === "batch" ? batchId : "",
    });
    setTestsPage(1);
    setStudentSearch("");
  };

  const handleTestOpen = (nextTestId) => updateParams({ test: nextTestId || "" });
  const handleTestBack = () => updateParams({ test: "" });
  const handleBatchChange = (nextBatchId) => {
    updateParams({ batch_id: nextBatchId || "", test: "" });
    setTestsPage(1);
  };
  const handleDepartmentChange = (nextDepartmentId) => updateParams({ department: nextDepartmentId || "", student_id: "" });
  const handleStudentSelect = (nextStudentId) => {
    updateParams({ mode: "student", student_id: nextStudentId || "" });
    setStudentSearch("");
  };
  const handleYearChange = (nextYear) => {
    setStudentYear(nextYear || "");
    updateParams({ student_id: "" });
  };
  const handleStudentScopeChange = (nextScope) => {
    updateParams({
      student_scope: nextScope === "current" ? "" : nextScope,
      passout_year: nextScope === "current" ? "" : passoutYear,
      passout_cohort: nextScope === "current" ? "" : passoutCohortId,
      student_id: "",
    });
  };
  const handlePassoutYearChange = (nextYear) => updateParams({ passout_year: nextYear || "", passout_cohort: "", student_id: "" });
  const handlePassoutCohortChange = (nextCohortId) => updateParams({ passout_cohort: nextCohortId || "", student_id: "" });

  const handleViolationClick = (studentName, events) => {
    setViolationDialog({ open: true, studentName: studentName || "Student", events: Array.isArray(events) ? events : [] });
  };

  const handleViolationReview = async (review) => {
    await adminApi.reviewReportAnomaly(review);
    analyticsQuery.refetch();
  };

  // ---------------------------------------------------------------- sections
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

  const DEEP_DIVE_VIEWS = [
    { key: "performance", label: "Results" },
    { key: "items", label: "Questions" },
    { key: "integrity", label: "Integrity" },
  ];

  // Per-module averages for MODULE_TEST results: one compact table with the
  // weakest module called out, instead of cards plus a second bar list of the
  // same percentages.
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

  const renderTestDeepDive = () => {
    const title = selectedTestMeta?.title || notAttended.testName || "Test results";
    const moduleColumns = moduleColumnDefs(testTableRows, analytics?.modulePerformance);
    const moduleStats = Array.isArray(analytics?.modulePerformance?.moduleStats) ? analytics.modulePerformance.moduleStats : [];
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
              <h2 className="truncate text-lg font-bold text-text-primary">{title}</h2>
              <p className="text-xs text-text-secondary">{testsScopeLabel}</p>
            </div>
          </div>
          <div className="mt-3">
            <TabNav tabs={DEEP_DIVE_VIEWS} active={deepDiveView} onChange={setDeepDiveView} />
          </div>
        </article>

        {deepDiveView === "items" ? <ItemAnalysisView query={itemAnalysisQuery} /> : null}
        {deepDiveView === "integrity" ? <IntegrityView query={integrityQuery} /> : null}

        {deepDiveView !== "performance" ? null : analyticsQuery.isLoading ? (
          <LoadingState label="Loading test results…" />
        ) : analyticsQuery.isError ? (
          <ErrorState title="Unable to load test results" onRetry={() => analyticsQuery.refetch()} />
        ) : (
          <>
            <MetricStrip items={deepDiveMetrics} />

            {renderModuleSummary(moduleStats)}

            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title="Score distribution">
                <ScoreDistributionChart data={analytics.distribution || []} height="h-[200px]" />
              </SectionCard>
              <SectionCard title="Topics">
                <TopicStrengths topics={topicData} />
              </SectionCard>
            </div>

            <SectionCard
              title="Student results"
              subtitle={testTableQuery.isFetching ? "Updating…" : `${toNumber(testTablePagination.total)} submissions`}
              bodyClassName="p-0"
              right={
                <>
                  <input
                    value={deepDiveSearch}
                    onChange={(event) => setDeepDiveSearch(event.target.value)}
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
                      <Th>Batch</Th>
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
                          <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.batch || "-"}</td>
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
                <Pagination page={testTablePagination.page} totalPages={testTablePagination.totalPages} total={testTablePagination.total} onPageChange={setDeepDivePage} />
              </div>
            </SectionCard>

            {notAttendedStudents.length > 0 ? (
              <AbsentStudentsCard
                title="Did not attempt"
                subtitle="Assigned students with no submission for this test."
                students={notAttendedStudents}
                count={notAttended.count}
              />
            ) : null}
          </>
        )}
      </section>
    );
  };

  const renderTrends = () => (
    <TrendsView query={trendsQuery} groupBy={trendGroupBy} onGroupByChange={setTrendGroupBy} showGroupBy={isCollegeScope} />
  );

  const renderAtRisk = () => (
    <AtRiskView query={atRiskQuery} canViewStudent={canReadStudents} onViewStudent={handleStudentSelect} />
  );

  if (!canViewReports) {
    return <PermissionDenied action="view reports" />;
  }

  const loading = analyticsQuery.isLoading;
  const analyticsReady = !isTestDeepDive && ANALYTICS_MODES.has(mode) && !loading && !analyticsQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reporting"
        title={isCollegeScope ? "College Reports" : "Department Reports"}
        description={
          isCollegeScope
            ? "Department, batch, and student performance analytics with integrity tracking."
            : "Batch and student performance analytics for your department, with integrity tracking."
        }
        actions={
          exportState.status === "idle" ? (
            <Button
              className="h-10 rounded-lg px-4"
              onClick={() => setBuilderOpen(true)}
              disabled={!canExportReports}
              title={!canExportReports ? "Contact your administrator to request export access" : ""}
            >
              <FileDown className="size-4" />
              Generate Report
            </Button>
          ) : (
            <ExportButton
              exportState={exportState}
              onExport={() => setBuilderOpen(true)}
              onDownload={handleDownload}
              disabled={!canExportReports}
              disabledReason={!canExportReports ? "Contact your administrator to request export access" : ""}
            />
          )
        }
      />

      <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs">
        <div className="relative -mx-4 overflow-x-auto overflow-y-hidden px-4">
          <TabNav
            tabs={REPORT_MODES.map((item) => ({ key: item.key, label: item.label }))}
            active={mode}
            onChange={handleModeSwitch}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {isCollegeScope ? (
            <label className="space-y-1 text-xs text-text-secondary">
              <span>Department</span>
              <select
                value={departmentId}
                onChange={(event) => handleDepartmentChange(event.target.value)}
                className="ui-select w-full"
              >
                <option value="">All Departments</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="space-y-1 text-xs text-text-secondary">
            <span>Test</span>
            <select
              value={testId}
              onChange={(event) => updateParams({ test: event.target.value })}
              className="ui-select w-full"
            >
              <option value="all">All Tests</option>
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
                  className="ui-select w-full"
                >
                  <option value="">All passout years</option>
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
                  className="ui-select w-full"
                >
                  <option value="">All cohorts</option>
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
              className="ui-select w-full"
            >
              <option value="">All years</option>
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>{year} YEAR</option>
              ))}
            </select>
          </label>
        </div>

        {mode === "student" ? (
          <div className="relative max-w-xl">
            <SearchInput
              value={studentSearch}
              onChange={(event) => setStudentSearch(event.target.value)}
              placeholder="Search student by name, email, or roll number"
              aria-label="Search students"
            />
            {studentSearchTerm.length >= 2 ? (
              <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                {studentMatches.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => handleStudentSelect(student.id)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="font-medium text-text-primary">{student.fullName}</span>
                    <span className="block text-xs text-text-secondary">
                      {student.studentId || "-"} - {student.department?.name || "-"} - {student.year || "-"}
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
          <span className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">Saved views</span>
          {savedViews.length === 0 ? (
            <span className="text-xs text-text-secondary">None yet — save the current filters to reuse them.</span>
          ) : (
            savedViews.map((view) => (
              <span key={view.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs">
                <button type="button" onClick={() => navigate(`${basePath}/reports${view.search}`)} className="font-medium text-text-primary hover:underline">
                  {view.name}
                </button>
                <button type="button" onClick={() => removeView(view.id)} aria-label={`Remove saved view ${view.name}`} className="rounded-full px-1 text-text-secondary hover:text-danger focus-visible:outline-2 focus-visible:outline-ring">
                  ×
                </button>
              </span>
            ))
          )}
          <button
            type="button"
            onClick={handleSaveView}
            className="rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-text-secondary hover:bg-muted hover:text-text-primary"
          >
            + Save current view
          </button>
        </div>
      </section>

      {isTestDeepDive ? renderTestDeepDive() : null}

      {!isTestDeepDive && mode === "batch" ? (
        <section className="space-y-4">
          <article className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <label className="block max-w-sm space-y-1 text-xs text-text-secondary">
              <span>Batch</span>
              <select
                value={batchId}
                onChange={(event) => handleBatchChange(event.target.value)}
                className="ui-select w-full"
              >
                <option value="">{isCollegeScope ? "All batches in this college" : "All batches in your department"}</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>{batch.name}</option>
                ))}
              </select>
            </label>
          </article>
          {renderTestsListCard()}
        </section>
      ) : null}

      {!isTestDeepDive && mode === "trends" ? renderTrends() : null}
      {!isTestDeepDive && mode === "at-risk" ? renderAtRisk() : null}

      {!isTestDeepDive && ANALYTICS_MODES.has(mode) && loading ? <AnalyticsSkeleton /> : null}
      {!isTestDeepDive && ANALYTICS_MODES.has(mode) && analyticsQuery.isError ? (
        <ErrorState title="Unable to load report analytics" onRetry={() => analyticsQuery.refetch()} />
      ) : null}

      {analyticsReady && mode === "overview" ? (
        <section className="space-y-4">
          <MetricStrip items={overviewMetrics} />

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Score distribution">
              <ScoreDistributionChart data={analytics.distribution || []} height="h-[200px]" />
            </SectionCard>
            <SectionCard title="Topics">
              <TopicStrengths topics={topicData} />
            </SectionCard>
          </div>

          <SectionCard
            title={isCollegeScope ? "Departments" : "Batches"}
            subtitle={isCollegeScope ? "Ranked by average score — select one to focus the report" : "Ranked by average score"}
          >
            <GroupPerformanceList
              rows={comparativeChartRows}
              labelKey={isCollegeScope ? "department" : "batch"}
              onSelect={isCollegeScope ? (row) => row.departmentId && handleDepartmentChange(row.departmentId) : undefined}
            />
          </SectionCard>

          {renderTestsListCard()}

          <RecentExports reports={reportJobs} onDownload={downloadJob} subtitle={`Generated PDFs for ${isCollegeScope ? "this college" : "your department"}.`} />
        </section>
      ) : null}

      {analyticsReady && mode === "departments" && isCollegeScope ? (
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
                        onClick={() => updateParams({ department: row.departmentId || "", mode: "", student_id: "" })}
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
          <button
            type="button"
            onClick={() => updateParams({ student_id: "" })}
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-card px-3 text-sm font-medium text-text-primary transition-colors hover:bg-muted"
          >
            ← All students
          </button>

          <StudentSummary student={selectedStudent} metrics={selectedStudentMetrics} />

          <SectionCard title="Topics">
            <TopicStrengths topics={topicData} />
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
        </section>
      ) : null}

      {analyticsReady && mode === "student" && !studentId ? (
        <SectionCard
          title="Students"
          subtitle="Ranked by average score. Select a student, or search above, to see their results."
          bodyClassName="p-0"
        >
          <div className="relative overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <Th sortKey="rank" sortState={sortState} onSort={handleSort}>#</Th>
                  <Th sortKey="name" sortState={sortState} onSort={handleSort}>Student</Th>
                  {isCollegeScope ? <Th sortKey="department" sortState={sortState} onSort={handleSort}>Department</Th> : null}
                  <Th sortKey="year" sortState={sortState} onSort={handleSort}>Year</Th>
                  <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg score</Th>
                  <Th sortKey="testsTaken" sortState={sortState} onSort={handleSort}>Tests</Th>
                  <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                </tr>
              </thead>
              <tbody>
                {sortedStudentLogRows.map((row) => (
                  <tr key={row.studentId || row.rank} className="border-t border-border/70 hover:bg-muted/40">
                    <td className="px-4 py-3 tabular-nums text-text-secondary">{row.rank}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => handleStudentSelect(row.studentId)} className="flex items-center gap-3 text-left">
                        <Avatar name={row.name} seed={row.studentId} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-text-primary hover:text-primary">{row.name}</span>
                          <span className="block truncate text-xs text-text-secondary">{row.rollNo}</span>
                        </span>
                      </button>
                    </td>
                    {isCollegeScope ? <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.department}</td> : null}
                    <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.year ? `Year ${row.year}` : "-"}</td>
                    <td className="px-4 py-3">{row.testsTaken > 0 ? <ScoreBadge score={row.avgScore} /> : <span className="text-text-secondary">—</span>}</td>
                    <td className="px-4 py-3 tabular-nums">{row.testsTaken}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleViolationClick(row.name, row.violationEvents)}
                        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        title="Review violations"
                      >
                        <ViolationBadge count={row.violations} />
                      </button>
                    </td>
                  </tr>
                ))}
                {sortedStudentLogRows.length === 0 ? (
                  <tr>
                    <td colSpan={isCollegeScope ? 7 : 6} className="px-4 py-8">
                      <EmptyState title="No students in this scope" description="Adjust the filters above to find students." />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

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
        actions={ADMIN_REVIEW_ACTIONS}
        onReview={handleViolationReview}
      />
    </div>
  );
}
