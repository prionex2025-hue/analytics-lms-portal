import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import usePermission from "@/hooks/usePermission";
import useSavedReportViews from "@/hooks/useSavedReportViews";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { isCollegeAdminRole } from "@/features/Admin/adminRole";
import { adminApi } from "@/services/api";
import {
  AbsentStudentsCard,
  AnalyticsSkeleton,
  AreaTrendChart,
  Avatar,
  ChartCard,
  EmptyState,
  ExportButton,
  GroupedBarChart,
  InsightCard,
  LineTrendChart,
  Pagination,
  RecentExports,
  ResultBadge,
  ScoreBadge,
  DistributionSummary,
  ScoreDistributionChart,
  StatCard,
  StatusBadge,
  StudentSummary,
  TabNav,
  Th,
  TopicBarChart,
  ViolationBadge,
} from "@/components/Reports/components";
import { AtRiskView, IntegrityView, ItemAnalysisView, TrendsView } from "@/components/Reports/advanced-views";
import { clampPercent, formatDateLabel, formatPercent, toExportErrorMessage, toQueryString } from "@/components/Reports/utils";

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

const TEST_STATUS_VARIANT = {
  LIVE: "info",
  COMPLETED: "success",
  SCHEDULED: "warning",
  DRAFT: "default",
  ARCHIVED: "default",
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

const formatViolationType = (type) => String(type || "UNKNOWN").replace(/_/g, " ").toLowerCase();

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

const moduleScoreFor = (row, mod) =>
  (Array.isArray(row?.moduleScores) ? row.moduleScores : []).find((item) => item.key === mod.key) || null;

const modulePercentageFor = (row, mod) => {
  const score = moduleScoreFor(row, mod);
  return score ? score.percentage : null;
};

// Raw marks a student scored in one module, e.g. "18 / 25". Null when absent.
const moduleMarksFor = (row, mod) => {
  const score = moduleScoreFor(row, mod);
  if (!score) return null;
  return `${toNumber(score.score)} / ${toNumber(score.maxScore)}`;
};

// Overall marks across all modules (sum of per-module score / maxScore).
const overallModuleMarks = (row) => {
  const scores = Array.isArray(row?.moduleScores) ? row.moduleScores : [];
  if (scores.length === 0) return null;
  const obtained = scores.reduce((sum, item) => sum + toNumber(item.score), 0);
  const max = scores.reduce((sum, item) => sum + toNumber(item.maxScore), 0);
  return { obtained: Math.round(obtained * 100) / 100, max: Math.round(max * 100) / 100 };
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
  const [trendIndexed, setTrendIndexed] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [exportState, setExportState] = useState({ status: "idle", progress: 0, downloadUrl: "", expiresAt: null, jobId: "", errorMessage: "" });
  const [violationDialog, setViolationDialog] = useState({ open: false, studentName: "", events: [] });
  const [reviewState, setReviewState] = useState({ eventKey: "", action: "", reason: "", submitting: false, error: "" });
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
  const analyticsMode = mode === "batch" ? "batch" : mode === "student" ? "student" : "department";
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
      (mode !== "student" || Boolean(studentId) || isTestDeepDive) &&
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
    queryKey: [`${queryKeyPrefix}-trends-v1`, trendGroupBy, trendIndexed, departmentId, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      adminApi.getReportTrends(
        toQueryString({
          groupBy: trendGroupBy,
          indexed: trendIndexed ? "true" : undefined,
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
  const testsList = Array.isArray(testsListQuery.data?.data) ? testsListQuery.data.data : [];
  const testsPagination = testsListQuery.data?.pagination || { page: 1, limit: 9, totalPages: 1, total: 0 };
  const testTableRows = Array.isArray(testTableQuery.data?.data) ? testTableQuery.data.data : [];
  const testTablePagination = testTableQuery.data?.pagination || { page: 1, totalPages: 1, total: 0 };
  const selectedTestMeta = tests.find((item) => String(item.id) === String(testId)) || null;
  const selectedDepartment = departments.find((item) => String(item.id) === String(departmentId)) || null;
  const selectedBatch = batches.find((item) => String(item.id) === String(batchId)) || null;

  const notAttended = analytics?.notAttended || {};
  const notAttendedStudents = Array.isArray(notAttended.students) ? notAttended.students : [];

  const trendData = (analytics.scoreTrend || []).map((item, index) => ({
    month: item.month || `Period ${index + 1}`,
    score: clampPercent(item.score || 0),
  }));

  const topicData = (analytics.topicPerformance || []).map((item, index) => ({
    subject: item.subject || item.topic || `Topic ${index + 1}`,
    score: toNumber(item.score || item.avgScore),
  }));

  const departmentRows = (analytics.departmentComparative || []).map((item) => ({
    departmentId: item.departmentId,
    department: item.departmentName || item.department || "-",
    students: toNumber(item.students),
    submissions: toNumber(item.submissions),
    avgScore: clampPercent(item.avgScore),
    passRate: clampPercent(item.passRate),
    participation: toNumber(item.participationRate ?? item.participation),
    violations: toNumber(item.violations),
  }));

  const batchComparative = (analytics.batchComparative || []).map((item) => ({
    batch: item.batchName || item.batch || "-",
    avgScore: clampPercent(item.avgScore),
    passRate: clampPercent(item.passRate),
    participation: toNumber(item.participationRate),
  }));

  const comparativeChartRows = (isCollegeScope ? departmentRows : batchComparative)
    .slice()
    .sort((a, b) => b.avgScore - a.avgScore)
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

  // ---------------------------------------------------------------- StatCards
  const avgScoreTier = clampPercent(metrics.avgScore) >= 75
    ? { badge: "Excellent", badgeTone: "success" }
    : clampPercent(metrics.avgScore) >= 50
      ? { badge: "Healthy", badgeTone: "info" }
      : { badge: "Needs Attention", badgeTone: "danger" };

  const overviewStatCards = [
    {
      key: "students",
      iconName: "students",
      iconTone: "navy",
      label: "Total Students",
      value: toNumber(metrics.totalStudents).toLocaleString(),
      sub: isCollegeScope ? "In this college scope" : "In this department",
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

  const deepDiveStatCards = [
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

  const healthLabel = clampPercent(metrics.avgScore) >= 75 ? "Excellent" : clampPercent(metrics.avgScore) >= 50 ? "Healthy" : "Needs Attention";
  const insightMessage = `Average score is ${formatPercent(metrics.avgScore)} across ${toNumber(metrics.totalSubmissions).toLocaleString()} submissions with a ${formatPercent(metrics.passRate)} pass rate. ${violationCount > 10 ? `${violationCount} integrity flags need review.` : "Integrity flags are within healthy limits."}`;

  const testsScopeLabel = selectedBatch
    ? `Batch: ${selectedBatch.name}`
    : selectedDepartment
      ? `Department: ${selectedDepartment.name}`
      : isCollegeScope
        ? "All departments"
        : "Your department";

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

  const handleExport = async () => {
    if (!canExportReports) return;
    const reportType = isTestDeepDive
      ? "TEST_WISE"
      : mode === "batch"
        ? "BATCH_WISE"
        : mode === "student"
          ? "STUDENT_WISE"
          : "DEPARTMENT_WISE";

    setExportState({ status: "loading", progress: 0, downloadUrl: "", expiresAt: null, jobId: "", errorMessage: "" });
    try {
      const result = await adminApi.generateReport({
        type: reportType,
        filters: {
          testId: testId === "all" ? undefined : testId,
          departmentId: departmentId || undefined,
          batchId: mode === "batch" ? batchId || undefined : undefined,
          studentId: mode === "student" ? studentId || undefined : undefined,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
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
  const handleSpreadsheetExport = async (format = "csv") => {
    if (!canExportReports || csvBusy) return;
    const dataset = isTestDeepDive && deepDiveView === "items" ? "item-analysis" : mode === "at-risk" ? "at-risk" : "tests";
    setCsvBusy(true);
    try {
      const params = toQueryString({
        dataset,
        testId: dataset === "item-analysis" ? testId : undefined,
        departmentId: departmentId || undefined,
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
    setReviewState({ eventKey: "", action: "", reason: "", submitting: false, error: "" });
  };

  const handleViolationReview = async (event, action) => {
    const reason = reviewState.reason.trim();
    if (!event?.testId || !event?.anomalyId || !event?.anomalyType || !reason) {
      setReviewState((prev) => ({ ...prev, error: "A reason is required before submitting a review." }));
      return;
    }
    const eventKey = event.anomalyId;
    setReviewState((prev) => ({ ...prev, eventKey, action, submitting: true, error: "" }));
    try {
      await adminApi.reviewReportAnomaly({ testId: event.testId, anomalyId: event.anomalyId, anomalyType: event.anomalyType, action, reason });
      setViolationDialog((prev) => ({ ...prev, open: false }));
      setReviewState({ eventKey: "", action: "", reason: "", submitting: false, error: "" });
      analyticsQuery.refetch();
    } catch (_error) {
      setReviewState((prev) => ({ ...prev, submitting: false, error: "Unable to save review. Please try again." }));
    }
  };

  // ---------------------------------------------------------------- sections
  const renderTestsListCard = () => {
    const pageSize = toNumber(testsPagination.limit) || 9;
    const startIndex = (toNumber(testsPagination.page || 1) - 1) * pageSize;
    return (
      <article className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Test Reports</h3>
            <p className="text-xs text-text-secondary">Per-test performance · {testsScopeLabel}</p>
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
    );
  };

  const renderItemAnalysis = () => <ItemAnalysisView query={itemAnalysisQuery} />;

  const renderIntegrity = () => <IntegrityView query={integrityQuery} />;

  const DEEP_DIVE_VIEWS = [
    { key: "performance", label: "Performance" },
    { key: "items", label: "Question Analysis" },
    { key: "integrity", label: "Integrity" },
  ];

  const renderTestDeepDive = () => {
    const title = selectedTestMeta?.title || notAttended.testName || "Test performance";
    const moduleColumns = moduleColumnDefs(testTableRows, analytics?.modulePerformance);
    const moduleStats = Array.isArray(analytics?.modulePerformance?.moduleStats)
      ? analytics.modulePerformance.moduleStats
      : [];
    return (
      <section className="space-y-4">
        <article className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTestBack}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-background px-3 text-sm font-medium text-text-primary transition-colors hover:bg-muted"
            >
              ← Back
            </button>
            <div>
              <h2 className="text-lg font-bold text-text-primary">{title}</h2>
              <p className="text-xs text-text-secondary">Deep-dive performance and integrity · {testsScopeLabel}</p>
            </div>
          </div>
          <TabNav
            tabs={DEEP_DIVE_VIEWS.map((view) => ({ key: view.key, label: view.label }))}
            active={deepDiveView}
            onChange={setDeepDiveView}
          />
        </article>

        {deepDiveView === "items" ? renderItemAnalysis() : null}
        {deepDiveView === "integrity" ? renderIntegrity() : null}

        {deepDiveView !== "performance" ? null : analyticsQuery.isLoading ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-text-secondary">Loading test analytics…</div>
        ) : analyticsQuery.isError ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load test analytics.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {deepDiveStatCards.map((item) => (
                <StatCard key={item.key} {...item} />
              ))}
            </div>

            {moduleStats.length > 0 ? (
              <article className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <div className="border-b border-border/70 pb-3">
                  <h3 className="text-lg font-semibold text-text-primary">Module Performance</h3>
                  <p className="text-xs text-text-secondary">Per-module average marks, completion, time, and attempts</p>
                </div>

                {(() => {
                  const ranked = [...moduleStats].sort((a, b) => toNumber(a.averagePercentage) - toNumber(b.averagePercentage));
                  const weakest = ranked[0];
                  const strongest = ranked[ranked.length - 1];
                  if (!weakest || moduleStats.length < 2) return null;
                  return (
                    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
                      <span className="font-semibold text-text-primary">Weakest module: {weakest.name}</span>
                      <span className="text-text-secondary"> — cohort average {formatPercent(weakest.averagePercentage)}</span>
                      {strongest && strongest.key !== weakest.key ? (
                        <span className="text-text-secondary"> · strongest: {strongest.name} ({formatPercent(strongest.averagePercentage)})</span>
                      ) : null}
                    </div>
                  );
                })()}

                <div className="grid gap-3 pt-4 md:grid-cols-3">
                  {moduleStats.map((stat) => (
                    <div key={stat.key} className="rounded-xl border border-border bg-background p-3">
                      <p className="text-sm font-semibold text-text-primary">{stat.name}</p>
                      <p className="mt-1 text-3xl font-bold text-text-primary">
                        {toNumber(stat.averageScore).toFixed(1)}
                        <span className="text-base font-medium text-text-secondary"> / {toNumber(stat.averageMaxScore).toFixed(1)}</span>
                      </p>
                      <p className="text-xs text-text-secondary">avg marks · {formatPercent(stat.averagePercentage)} · {toNumber(stat.attempts)} attempts</p>
                      <div className="mt-2 flex items-center gap-1">
                        <span className={`h-1.5 flex-1 rounded-full ${clampPercent(stat.averagePercentage) >= 60 ? "bg-success" : clampPercent(stat.averagePercentage) >= 40 ? "bg-amber-500" : "bg-red-500"}`} />
                      </div>
                      <p className="mt-1 text-xs text-text-secondary">
                        {formatPercent(stat.completionRate)} completion · avg {formatSecondsShort(stat.averageTimeSeconds)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t border-border/70 pt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary">Module comparison (avg %)</p>
                  <div className="space-y-2">
                    {moduleStats.map((stat) => {
                      const pct = clampPercent(stat.averagePercentage);
                      const barColor = pct >= 60 ? "bg-success" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
                      return (
                        <div key={stat.key} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate text-xs text-text-secondary" title={stat.name}>{stat.name}</span>
                          <div className="h-2.5 flex-1 rounded-full bg-muted">
                            <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-24 shrink-0 text-right text-xs tabular-nums text-text-primary">
                            {toNumber(stat.averageScore).toFixed(1)}/{toNumber(stat.averageMaxScore).toFixed(1)} ({formatPercent(stat.averagePercentage)})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Score Distribution" height="h-[240px]">
                <ScoreDistributionChart data={analytics.distribution || []} total={toNumber(metrics.attemptedStudents)} />
              </ChartCard>
              <ChartCard title="Topic-wise Performance" height="h-[240px]">
                <TopicBarChart data={topicData} />
              </ChartCard>
            </div>

            <ChartCard title="Score Spread" height="h-[220px]">
              <DistributionSummary stats={analytics.distributionStats} />
            </ChartCard>

            <article className="rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-text-primary">Student Results</h3>
                  {testTableQuery.isFetching ? <span className="text-xs text-text-secondary">Updating…</span> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={deepDiveSearch}
                    onChange={(event) => setDeepDiveSearch(event.target.value)}
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
                      <Th>Batch</Th>
                      <Th>Score</Th>
                      {moduleColumns.map((mod) => (
                        <Th key={mod.key}>{moduleShortLabel(mod.key)} (marks)</Th>
                      ))}
                      {moduleColumns.length > 0 ? <Th>Overall (marks)</Th> : null}
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
                        <td className="px-4 py-3 text-text-secondary">{row.batch || "-"}</td>
                        <td className="px-4 py-3"><ScoreBadge score={row.scorePercent ?? row.score} /></td>
                        {moduleColumns.map((mod) => {
                          const marks = moduleMarksFor(row, mod);
                          const pct = modulePercentageFor(row, mod);
                          return (
                            <td key={mod.key} className="px-4 py-3">
                              {marks == null ? (
                                <span className="text-text-secondary">—</span>
                              ) : (
                                <div className="leading-tight">
                                  <span className="font-medium text-text-primary tabular-nums">{marks}</span>
                                  {pct != null ? <span className="ml-1 text-xs text-text-secondary">({formatPercent(pct)})</span> : null}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        {moduleColumns.length > 0 ? (
                          <td className="px-4 py-3">
                            {(() => {
                              const overall = overallModuleMarks(row);
                              return overall ? (
                                <span className="font-semibold text-text-primary tabular-nums">{overall.obtained} / {overall.max}</span>
                              ) : (
                                <span className="text-text-secondary">—</span>
                              );
                            })()}
                          </td>
                        ) : null}
                        <td className="px-4 py-3"><ResultBadge status={row.status} score={row.scorePercent ?? row.score} /></td>
                        <td className="px-4 py-3"><StatusBadge label={String(row.status || "-").toLowerCase()} variant={row.status === "SUBMITTED" ? "success" : "warning"} /></td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleViolationClick(row.studentName, row.violations)}
                            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            title="View violation details"
                          >
                            <ViolationBadge count={row.violationCount} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {testTableRows.length === 0 ? (
                      <tr>
                        <td colSpan={7 + moduleColumns.length + (moduleColumns.length > 0 ? 1 : 0)} className="px-4 py-8">
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
                  onPageChange={setDeepDivePage}
                />
              </div>
            </article>

            {notAttendedStudents.length > 0 ? (
              <AbsentStudentsCard
                title={notAttended.testName ? `Not Attended: ${notAttended.testName}` : "Not Attended Students"}
                subtitle="Students who did not submit this test."
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
    <TrendsView
      query={trendsQuery}
      groupBy={trendGroupBy}
      onGroupByChange={setTrendGroupBy}
      indexed={trendIndexed}
      onIndexedChange={setTrendIndexed}
      showGroupBy={isCollegeScope}
    />
  );

  const renderAtRisk = () => (
    <AtRiskView query={atRiskQuery} canViewStudent={canReadStudents} onViewStudent={handleStudentSelect} />
  );

  if (!canViewReports) {
    return <PermissionDenied action="view reports" />;
  }

  const loading = analyticsQuery.isLoading;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-4 sm:px-6">
      <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">Reporting Dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-text-primary sm:text-3xl">
              {isCollegeScope ? "College Reports" : "Department Reports"}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {isCollegeScope
                ? "Department, batch, and student performance analytics with integrity tracking."
                : "Batch and student performance analytics for your department, with integrity tracking."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canExportReports && (mode === "batch" || mode === "at-risk" || (isTestDeepDive && deepDiveView === "items")) ? (
              <div className="flex items-center overflow-hidden rounded-xl border border-border bg-card">
                <button
                  type="button"
                  onClick={() => handleSpreadsheetExport("csv")}
                  disabled={csvBusy}
                  className="px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {csvBusy ? "Preparing…" : "CSV"}
                </button>
                <span className="h-5 w-px bg-border" />
                <button
                  type="button"
                  onClick={() => handleSpreadsheetExport("xlsx")}
                  disabled={csvBusy}
                  className="px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Excel
                </button>
              </div>
            ) : null}
            <ExportButton
              exportState={exportState}
              onExport={handleExport}
              onDownload={handleDownload}
              disabled={!canExportReports}
              disabledReason={!canExportReports ? "Contact your administrator to request export access" : ""}
            />
          </div>
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
          {isCollegeScope ? (
            <label className="space-y-1 text-xs text-text-secondary">
              <span>Department</span>
              <select
                value={departmentId}
                onChange={(event) => handleDepartmentChange(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
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
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
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
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
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
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
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
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
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
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
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
            <input
              value={studentSearch}
              onChange={(event) => setStudentSearch(event.target.value)}
              placeholder="Search student by name, email, or roll number"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
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
                <button type="button" onClick={() => removeView(view.id)} aria-label={`Remove saved view ${view.name}`} className="text-text-secondary hover:text-red-500">
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
          <article className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <label className="block max-w-sm space-y-1 text-xs text-text-secondary">
              <span>Select Batch</span>
              <select
                value={batchId}
                onChange={(event) => handleBatchChange(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
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

      {!isTestDeepDive && (mode === "overview" || mode === "departments" || mode === "student") && loading ? (
        <AnalyticsSkeleton />
      ) : null}
      {!isTestDeepDive && (mode === "overview" || mode === "departments" || mode === "student") && analyticsQuery.isError ? (
        <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load report analytics.</section>
      ) : null}

      {!isTestDeepDive && (mode === "overview" || mode === "departments") && !loading && !analyticsQuery.isError ? (
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
                  <ScoreDistributionChart data={analytics.distribution || []} total={toNumber(metrics.attemptedStudents)} />
                </ChartCard>
                <ChartCard title="Topic-wise Performance" height="h-[240px]">
                  <TopicBarChart data={topicData} />
                </ChartCard>
                <InsightCard
                  title={`${isCollegeScope ? "Institutional" : "Department"} Health · ${healthLabel}`}
                  message={insightMessage}
                  action={
                    isCollegeScope
                      ? { label: "View Departments", onClick: () => handleModeSwitch("departments") }
                      : { label: "View Batches", onClick: () => handleModeSwitch("batch") }
                  }
                />
              </div>

              <ChartCard title="Score Spread" height="h-[200px]">
                <DistributionSummary stats={analytics.distributionStats} />
              </ChartCard>

              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                <ChartCard title="Score Trend" height="h-[240px]">
                  <AreaTrendChart data={trendData} xKey="month" dataKey="score" name="Avg Score" color="var(--chart-1)" />
                </ChartCard>
                <RecentExports reports={reportJobs} onDownload={downloadJob} subtitle={`Generated PDFs for ${isCollegeScope ? "this college" : "your department"}.`} />
              </div>

              <ChartCard title={isCollegeScope ? "Department Performance Comparison" : "Batch Performance Comparison"} height="h-auto">
                <GroupedBarChart
                  data={comparativeChartRows}
                  xKey={isCollegeScope ? "department" : "batch"}
                  series={[
                    { key: "avgScore", label: "Avg Score" },
                    { key: "passRate", label: "Pass Rate" },
                    { key: "participation", label: "Participation" },
                  ]}
                  onBarClick={isCollegeScope ? (name) => {
                    const dep = departments.find((item) => item.name === name);
                    if (dep) handleDepartmentChange(dep.id);
                  } : undefined}
                />
              </ChartCard>
            </>
          ) : null}

          {mode === "departments" && isCollegeScope ? (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Score Distribution" height="h-[240px]">
                  <ScoreDistributionChart data={analytics.distribution || []} total={toNumber(metrics.attemptedStudents)} />
                </ChartCard>
                <ChartCard title="Topic-wise Performance" height="h-[240px]">
                  <TopicBarChart data={topicData} />
                </ChartCard>
                <ChartCard title={selectedDepartment ? `${selectedDepartment.name} Performance` : "All Departments Performance"} height="h-[240px]">
                  <div className="h-full overflow-auto">
                    <GroupedBarChart
                      data={comparativeChartRows}
                      xKey="department"
                      series={[
                        { key: "avgScore", label: "Avg Score" },
                        { key: "passRate", label: "Pass Rate" },
                      ]}
                      highlightCategory={selectedDepartment?.name || ""}
                    />
                  </div>
                </ChartCard>
              </div>

              <ChartCard title="Score Spread" height="h-[200px]">
                <DistributionSummary stats={analytics.distributionStats} />
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
                          <td className="px-4 py-3 tabular-nums">{row.students}</td>
                          <td className="px-4 py-3 tabular-nums">{row.submissions}</td>
                          <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                          <td className="px-4 py-3 tabular-nums">{formatPercent(row.passRate)}</td>
                          <td className="px-4 py-3 tabular-nums">{formatPercent(row.participation)}</td>
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
          ) : null}

          {renderTestsListCard()}
        </section>
      ) : null}

      {!isTestDeepDive && mode === "student" && !loading && !analyticsQuery.isError ? (
        <section className="space-y-4">
          {studentId ? (
            <>
              <StudentSummary student={selectedStudent} metrics={selectedStudentMetrics} />

              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                <ChartCard title="Student Score Trend" height="h-[220px]">
                  <LineTrendChart
                    data={sortedAttemptRows.map((row) => ({ month: formatDateLabel(row.date), score: row.scorePercent })).reverse()}
                    xKey="month"
                    dataKey="score"
                    name="Score"
                    color="var(--chart-2)"
                  />
                </ChartCard>
                <ChartCard title="Topic-wise Performance" height="h-[220px]">
                  <TopicBarChart data={topicData} height="h-full" />
                </ChartCard>
              </div>

              <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <Th sortKey="date" sortState={sortState} onSort={handleSort}>Date</Th>
                      <Th sortKey="testName" sortState={sortState} onSort={handleSort}>Test</Th>
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
                        <td className="px-4 py-3"><ScoreBadge score={row.scorePercent} /></td>
                        <td className="px-4 py-3"><ResultBadge status={row.status} score={row.scorePercent} /></td>
                        <td className="px-4 py-3 tabular-nums">
                          {row.totalMarks > 0 ? `${row.obtainedMarks.toFixed(2)} / ${row.totalMarks.toFixed(2)}` : "-"}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{Math.round(row.timeTaken / 60)} min</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleViolationClick(selectedStudent?.name, row.violationEvents)}
                            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            title="View violation details"
                          >
                            <ViolationBadge count={row.violationsCount} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {sortedAttemptRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8">
                          <EmptyState title="No submitted tests" description="This student's completed tests will appear here." />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </article>
            </>
          ) : (
            <EmptyState title="Select a student" description="Search above or click a student row below to view test-by-test performance." />
          )}

          <article className="overflow-x-auto rounded-2xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 p-4">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">Student Performance Log</h3>
                <p className="text-xs text-text-secondary">Select a student to open complete test performance.</p>
              </div>
              <span className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-text-secondary">
                {sortedStudentLogRows.length} {sortedStudentLogRows.length === 1 ? "entry" : "entries"}
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
                {sortedStudentLogRows.map((row) => (
                  <tr
                    key={row.studentId || row.rank}
                    onClick={() => handleStudentSelect(row.studentId)}
                    className="cursor-pointer border-t border-border/70 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3 tabular-nums text-text-secondary">#{row.rank}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={row.name} seed={row.studentId} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-text-primary">{row.name}</p>
                          <p className="truncate text-xs text-text-secondary">{row.rollNo}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{row.department}</td>
                    <td className="px-4 py-3 text-text-secondary">{row.year ? `${row.year} YEAR` : "-"}</td>
                    <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                    <td className="px-4 py-3"><ResultBadge score={row.avgScore} /></td>
                    <td className="px-4 py-3 tabular-nums">{row.testsTaken}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleViolationClick(row.name, row.violationEvents);
                        }}
                        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        title="View violation details"
                      >
                        <ViolationBadge count={row.violations} />
                      </button>
                    </td>
                  </tr>
                ))}
                {sortedStudentLogRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8">
                      <EmptyState title="No student data" description="Students appear once tests are submitted in this scope." />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </article>

          {renderTestsListCard()}
        </section>
      ) : null}

      <Dialog open={violationDialog.open} onOpenChange={(open) => setViolationDialog((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Violation Details</DialogTitle>
            <DialogDescription>
              {violationDialog.studentName} - exam-time violations captured by proctoring.
            </DialogDescription>
          </DialogHeader>

          {violationDialog.events.length === 0 ? (
            <div className="rounded-xl border border-border bg-background p-4 text-sm text-text-secondary">
              No detailed violation events available for this student in the current report scope.
            </div>
          ) : (
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {violationDialog.events.map((event, index) => {
                const eventKey = event.anomalyId || event.id || `${event.submissionId || "submission"}-${index}`;
                const isCurrentReview = reviewState.eventKey === eventKey;
                const reviewable = Boolean(event.testId && event.anomalyId && event.anomalyType);
                const isSubmittingReview = isCurrentReview && reviewState.submitting;
                return (
                  <div key={eventKey} className="rounded-xl border border-border bg-background p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold capitalize text-text-primary">{formatViolationType(event.type || event.anomalyType)}</p>
                      <p className="text-xs text-text-secondary">{formatDateLabel(event.createdAt)}</p>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">Test: {event.testName || "-"}</p>
                    {event.metadata ? (
                      <pre className="mt-2 overflow-x-auto rounded-lg border border-border/70 bg-card p-2 text-[11px] text-text-secondary">{JSON.stringify(event.metadata, null, 2)}</pre>
                    ) : null}
                    <div className="mt-3 space-y-2">
                      {reviewable ? (
                        <>
                          <textarea
                            value={isCurrentReview ? reviewState.reason : ""}
                            onChange={(changeEvent) =>
                              setReviewState({ eventKey, action: "", reason: changeEvent.target.value, submitting: false, error: "" })
                            }
                            placeholder="Review reason"
                            className="min-h-18 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary"
                          />
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              disabled={isSubmittingReview}
                              onClick={() => handleViolationReview(event, "DISMISS")}
                              className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
                            >
                              Dismiss
                            </button>
                            <button
                              type="button"
                              disabled={isSubmittingReview}
                              onClick={() => handleViolationReview(event, "ESCALATE")}
                              className="rounded-full bg-danger px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
                            >
                              Escalate
                            </button>
                          </div>
                        </>
                      ) : null}
                      {isCurrentReview && reviewState.error ? <p className="text-xs text-red-500">{reviewState.error}</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
