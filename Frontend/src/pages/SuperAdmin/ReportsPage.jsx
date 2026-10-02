import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { superAdminApi } from "@/services/api";
import useSavedReportViews from "@/hooks/useSavedReportViews";
import useDebouncedValue from "@/hooks/useDebouncedValue";
import {
  AbsentStudentsCard,
  AnalyticsSkeleton,
  Avatar,
  ChartCard,
  EmptyState,
  ExportButton,
  Pagination,
  RecentExports,
  ResultBadge,
  ScoreBadge,
  ScoreDistributionChart,
  SectionCard,
  StatCard,
  StudentSummary,
  SubjectPerformanceChart,
  TabNav,
  Th,
  ViolationBadge,
} from "@/components/Reports/components";
import { AtRiskView, IntegrityView, ItemAnalysisView } from "@/components/Reports/advanced-views";
import { MetricStrip, ScoreWithMarks } from "@/components/Reports/summary-blocks";
import ReportTestsTable from "@/components/Reports/ReportTestsTable";
import { moduleColumnDefs, moduleMarksFor, moduleShortLabel, overallModuleMarks } from "@/components/Reports/module-columns";
import ReportBuilderDialog, { toReportTestFilters } from "@/components/Admin/Reports/ReportBuilderDialog";
import ViolationReviewDialog from "@/components/Reports/ViolationReviewDialog";
import { SUPER_REVIEW_ACTIONS } from "@/components/Reports/reviewActions";
import { clampPercent, comparePercentAsc, formatDateLabel, formatPercent, NO_DATA_LABEL, percentOrNull, toExportErrorMessage, toQueryString } from "@/components/Reports/utils";
import { ArrowLeft, FileBarChart2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ui } from "@/styles/ui-tokens";
import { ErrorState, PageHeader, SearchInput } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";

const REPORT_MODES = [
  { key: "overview", label: "Overview" },
  { key: "departments", label: "Departments" },
  { key: "batch", label: "Batch" },
  { key: "student", label: "Student" },
  { key: "at-risk", label: "At Risk" },
];

const DEEP_DIVE_VIEWS = [
  { key: "performance", label: "Results" },
  { key: "items", label: "Questions" },
  { key: "integrity", label: "Integrity" },
];

// Tabs rendered from the scoped analytics payload (the others have their own endpoints).
const ANALYTICS_MODES = new Set(["overview", "departments", "student"]);

// Every list on this page is served by the API: the sort column, direction and
// page below are request parameters, not client-side work.
const DEFAULT_SORTS = {
  department: { key: "avgScore", dir: "desc" },
  student: { key: "rank", dir: "asc" },
  batch: { key: "name", dir: "asc" },
};

// Page sizes handed to the server for each list. Departments are the widest
// table, so it takes the bigger page; students and batches are denser.
const DEPARTMENT_PAGE_LIMIT = 25;
const STUDENT_PAGE_LIMIT = 10;
const BATCH_PAGE_LIMIT = 10;
const SEARCH_DEBOUNCE_MS = 300;

// Page metadata always comes from the API; this is only the shape to render
// before the first response (or for a payload sent without pagination).
const toPagination = (value, fallbackTotal = 0) => ({
  page: toNumber(value?.page) || 1,
  limit: toNumber(value?.limit) || 0,
  total: toNumber(value?.total ?? fallbackTotal),
  totalPages: toNumber(value?.totalPages) || 1,
});

// One header per mode: what this view answers, and the actions that only make
// sense inside it.
const MODE_META = {
  overview: {
    title: "Report overview",
    description: "Institution-wide analytics for the filters above.",
  },
  departments: {
    title: "Department performance",
    description: "Compare every department in scope, then open one to drill in.",
  },
  batch: {
    title: "Batch performance",
    description: "Open a batch to see its scores, department split and test activity.",
  },
  student: {
    title: "Student performance",
    description: "Rank the students in scope, then open one for their full result history.",
  },
  "at-risk": {
    title: "Students at risk",
    description: "Students crossing the risk threshold in scope, with the reasons behind it.",
  },
};

// This workspace reads a missing number as "N/A" everywhere: a rate or score
// the API could not compute is never shown, sorted, or coloured as a real 0%.
const NO_DATA_TEXT = "N/A";
const formatRate = (value) => (value == null ? NO_DATA_TEXT : formatPercent(value));
const formatCount = (value) => (value == null ? NO_DATA_TEXT : toNumber(value).toLocaleString());

/** Shared mode header: title, one-line purpose, and mode-specific actions. */
function ModeHeader({ title, description, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-xs">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-text-primary">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-text-secondary">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

const YEAR_OPTIONS = ["1", "2", "3", "4"];

// Academic status replaces the old current/passout/all scope filter: it names
// every lifecycle state a student record can be in.
const ACADEMIC_STATUS_OPTIONS = [
  { value: "current", label: "Current" },
  { value: "graduated", label: "Graduated" },
  { value: "on_hold", label: "On Hold" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "transferred", label: "Transferred" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

// Mirrors the server's academicStatus -> studentScope mapping, so the legacy
// `studentScope` param we still send can never contradict the chosen status.
const academicStatusToStudentScope = (status) => {
  if (status === "graduated") return "passout";
  if (status === "all") return "all";
  return "current";
};

// Passout year / cohort only exist for students who have already left.
const PASSOUT_STATUSES = new Set(["graduated", "all"]);

// Every report query carries these two; `all` is a real choice for both, so it
// must survive query-string serialisation instead of being dropped as "unset".
const SCOPE_QUERY_OPTIONS = { keepAll: ["academicStatus", "studentScope"] };

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

// Compact "Xm Ys" (or "Ys") for durations; "—" when the API has no value.
const formatSecondsShort = (seconds) => {
  if (seconds == null) return NO_DATA_LABEL;
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
  const rawAcademicStatus = searchParams.get("academicStatus") || "current";
  const academicStatus = ACADEMIC_STATUS_OPTIONS.some((item) => item.value === rawAcademicStatus) ? rawAcademicStatus : "current";
  // Legacy param, still sent to the API so older builds keep filtering correctly.
  const studentScope = academicStatusToStudentScope(academicStatus);
  const showPassoutFilters = PASSOUT_STATUSES.has(academicStatus);
  const passoutYear = searchParams.get("passout_year") || "";
  const passoutCohortId = searchParams.get("passout_cohort") || "";
  const batchId = searchParams.get("batch_id") || "";
  const dateFrom = searchParams.get("date_from") || "";
  const dateTo = searchParams.get("date_to") || "";
  const hasDateRange = Boolean(dateFrom || dateTo);
  const hasCollegeSelected = Boolean(collegeId);
  const isTestDeepDive = Boolean(testId) && testId !== "all";

  const [studentSearch, setStudentSearch] = useState("");
  const [studentYear, setStudentYear] = useState("");
  // Department list: search, page and sort are request parameters, so the
  // search box is debounced before it reaches the query key.
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [departmentPage, setDepartmentPage] = useState(1);
  const [departmentSort, setDepartmentSort] = useState(DEFAULT_SORTS.department);
  // Batch list: its own paginated query, separate from the dropdown source.
  const [batchSearch, setBatchSearch] = useState("");
  const [batchPage, setBatchPage] = useState(1);
  const [batchSort, setBatchSort] = useState(DEFAULT_SORTS.batch);
  // Student ranking ("roster"): distinct from the student lookup box above.
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterPage, setRosterPage] = useState(1);
  const [rosterSort, setRosterSort] = useState(DEFAULT_SORTS.student);
  const [attemptSort, setAttemptSort] = useState({ key: "date", dir: "desc" });
  const [testsSearch, setTestsSearch] = useState("");
  const [testsSort, setTestsSort] = useState("startsAt");
  const [testsStatus, setTestsStatus] = useState("all");
  const [testsPage, setTestsPage] = useState(1);
  const [deepDiveView, setDeepDiveView] = useState("performance");
  // Deep-dive ("view details") student results table: server-side search + sort +
  // pagination, matching the College Admin per-test results table.
  const [detailSearch, setDetailSearch] = useState("");
  const [deepDiveSort, setDeepDiveSort] = useState("date");
  const [detailPage, setDetailPage] = useState(1);
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

  // Filters are dropped from the URL when they mean "unset" so the page falls
  // back to its default. `preserve` keeps params whose "all" is a real choice.
  const updateParams = (next, preserve = []) => {
    const nextParams = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value == null || value === "" || (value === "all" && !preserve.includes(key))) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    });
    setSearchParams(nextParams);
  };

  // Typing must not fire a request per keystroke: the inputs stay instant, the
  // query only sees the search once the user pauses.
  const debouncedDepartmentSearch = useDebouncedValue(departmentSearch.trim(), SEARCH_DEBOUNCE_MS);
  const debouncedRosterSearch = useDebouncedValue(rosterSearch.trim(), SEARCH_DEBOUNCE_MS);
  const debouncedBatchSearch = useDebouncedValue(batchSearch.trim(), SEARCH_DEBOUNCE_MS);

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

  // Dropdown source: the full batch list (bounded) that powers the filter and
  // resolves the selected batch. The batch *table* below uses its own
  // paginated query, so this one is never paginated or searched client-side.
  const batchesQuery = useQuery({
    queryKey: ["super-report-batches-v1", collegeId],
    queryFn: () => superAdminApi.getBatches(toQueryString({ page: 1, limit: 200, collegeId })),
    enabled: hasCollegeSelected,
    staleTime: 120000,
  });

  // Batch table page: server-side search + pagination, scoped by department.
  const batchesTableQuery = useQuery({
    queryKey: ["super-report-batches-table-v1", collegeId, departmentId, batchPage, debouncedBatchSearch, batchSort.key, batchSort.dir],
    queryFn: () =>
      superAdminApi.getBatches(
        toQueryString({
          page: batchPage,
          limit: BATCH_PAGE_LIMIT,
          collegeId,
          search: debouncedBatchSearch || undefined,
          departmentId: departmentId || undefined,
          sortBy: batchSort.key,
          sortDir: batchSort.dir,
        })
      ),
    enabled: hasCollegeSelected && mode === "batch",
    placeholderData: (prev) => prev,
    staleTime: 120000,
  });

  const scopeQuery = useQuery({
    queryKey: [
      "super-report-analytics-scope-v6",
      collegeId,
      departmentId,
      batchId,
      testId,
      studentYear,
      academicStatus,
      passoutYear,
      passoutCohortId,
      dateFrom,
      dateTo,
      departmentPage,
      departmentSort.key,
      departmentSort.dir,
      debouncedDepartmentSearch,
      rosterPage,
      rosterSort.key,
      rosterSort.dir,
      debouncedRosterSearch,
    ],
    queryFn: () =>
      superAdminApi.getReportAnalytics(
        toQueryString(
          {
            collegeId,
            departmentId,
            // Batch scoping mirrors College Admin: the analytics narrow to the
            // selected batch's students (and that batch's tests), so the whole
            // report view — metrics, charts, per-test deep-dive — reflects it.
            batchId: batchId || undefined,
            testId,
            year: studentYear || undefined,
            academicStatus,
            studentScope,
            passoutYear: passoutYear || undefined,
            passoutCohortId: passoutCohortId || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            // Both embedded lists come back as one server-side page each.
            paginate: "1",
            // A test deep-dive needs every row for the "not attended" list, so
            // it asks for the complete student list instead of a page.
            rows: isTestDeepDive ? "absent" : undefined,
            departmentsPage: departmentPage,
            departmentsLimit: DEPARTMENT_PAGE_LIMIT,
            departmentsSearch: debouncedDepartmentSearch || undefined,
            departmentsSort: departmentSort.key,
            departmentsDir: departmentSort.dir,
            studentsPage: rosterPage,
            studentsLimit: STUDENT_PAGE_LIMIT,
            studentsSearch: debouncedRosterSearch || undefined,
            studentsSort: rosterSort.key,
            studentsDir: rosterSort.dir,
          },
          SCOPE_QUERY_OPTIONS
        )
      ),
    // Enabled on the Batch tab too, so a selected batch renders a real batch-scoped
    // report (not just the tests list), and on any open test deep-dive.
    enabled: hasCollegeSelected && (isTestDeepDive || ["overview", "departments", "student", "batch"].includes(mode)),
    // Paging and re-sorting must not blank the tables while the next page loads.
    placeholderData: (prev) => prev,
    staleTime: 45000,
  });

  // Shared, scope-aware tests listing. The same query backs the tests table on
  // every tab - the active college/department/batch filters carry the scope.
  const testsListQuery = useQuery({
    queryKey: ["super-report-tests-list-v2", collegeId, departmentId, batchId, testsPage, testsSort, testsStatus, testsSearch.trim(), studentYear, academicStatus, passoutYear, passoutCohortId, dateFrom, dateTo],
    queryFn: () =>
      superAdminApi.getReportTests(
        toQueryString(
          {
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
            academicStatus,
            studentScope,
            passoutYear: passoutYear || undefined,
            passoutCohortId: passoutCohortId || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          },
          SCOPE_QUERY_OPTIONS
        )
      ),
    enabled: hasCollegeSelected && !isTestDeepDive,
    placeholderData: (prev) => prev,
    staleTime: 30000,
  });

  // Advanced analytics — parity with the admin portal, scoped by the selected
  // college. Item-analysis / integrity are test deep-dive views; at-risk is
  // its own tab.
  const itemAnalysisQuery = useQuery({
    queryKey: ["super-report-item-analysis-v1", collegeId, testId, academicStatus, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportItemAnalysis(
        toQueryString(
          { collegeId, testId, academicStatus, studentScope, passoutYear: passoutYear || undefined, passoutCohortId: passoutCohortId || undefined },
          SCOPE_QUERY_OPTIONS
        )
      ),
    enabled: hasCollegeSelected && isTestDeepDive && deepDiveView === "items",
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  const integrityQuery = useQuery({
    queryKey: ["super-report-integrity-v1", collegeId, testId, academicStatus, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportIntegrity(
        toQueryString(
          { collegeId, testId, academicStatus, studentScope, passoutYear: passoutYear || undefined, passoutCohortId: passoutCohortId || undefined },
          SCOPE_QUERY_OPTIONS
        )
      ),
    enabled: hasCollegeSelected && isTestDeepDive && deepDiveView === "integrity",
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  // Per-submission student results for the selected test, scoped to the active
  // college/department/batch — the same endpoint shape College Admin uses, so the
  // batch-wise test report is identical across both portals.
  const testTableQuery = useQuery({
    queryKey: ["super-report-test-table-v1", collegeId, departmentId, batchId, testId, detailPage, detailSearch.trim(), deepDiveSort, studentYear, academicStatus, passoutYear, passoutCohortId, dateFrom, dateTo],
    queryFn: () =>
      superAdminApi.getReportTable(
        toQueryString(
          {
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
            academicStatus,
            studentScope,
            passoutYear: passoutYear || undefined,
            passoutCohortId: passoutCohortId || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          },
          SCOPE_QUERY_OPTIONS
        )
      ),
    enabled: hasCollegeSelected && isTestDeepDive && deepDiveView === "performance",
    placeholderData: (prev) => prev,
    staleTime: 30000,
  });

  const atRiskQuery = useQuery({
    queryKey: ["super-report-at-risk-v1", collegeId, departmentId, batchId, studentYear, academicStatus, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportAtRisk(
        toQueryString(
          {
            collegeId,
            departmentId: departmentId || undefined,
            batchId: batchId || undefined,
            year: studentYear || undefined,
            academicStatus,
            studentScope,
            passoutYear: passoutYear || undefined,
            passoutCohortId: passoutCohortId || undefined,
          },
          SCOPE_QUERY_OPTIONS
        )
      ),
    enabled: hasCollegeSelected && mode === "at-risk" && !isTestDeepDive,
    placeholderData: (prev) => prev,
    staleTime: 60000,
  });

  const studentDetailQuery = useQuery({
    queryKey: ["super-report-student-detail-v4", collegeId, departmentId, testId, studentId, studentYear, academicStatus, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportAnalytics(
        toQueryString(
          {
            collegeId,
            departmentId,
            testId,
            studentId,
            year: studentYear || undefined,
            academicStatus,
            studentScope,
            passoutYear: passoutYear || undefined,
            passoutCohortId: passoutCohortId || undefined,
          },
          SCOPE_QUERY_OPTIONS
        )
      ),
    enabled: hasCollegeSelected && Boolean(studentId),
    staleTime: 45000,
  });

  const studentSearchQuery = useQuery({
    queryKey: ["super-report-student-search-v4", collegeId, departmentId, studentSearch.trim(), studentYear, academicStatus, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getStudents(
        toQueryString(
          {
            page: 1,
            limit: 10,
            collegeId,
            departmentId,
            search: studentSearch.trim(),
            year: studentYear || undefined,
            academicStatus,
            studentScope,
            passoutYear: passoutYear || undefined,
            passoutCohortId: passoutCohortId || undefined,
          },
          SCOPE_QUERY_OPTIONS
        )
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
  const selectedBatch = allBatches.find((item) => String(item.id) === String(batchId)) || null;
  const passoutYearOptions = [...new Set(passoutCohorts.map((cohort) => String(cohort.passoutYear || "")).filter(Boolean))];
  const visiblePassoutCohorts = passoutCohorts.filter((cohort) => !passoutYear || String(cohort.passoutYear) === String(passoutYear));
  const scope = scopeQuery.data || {};
  const testsList = Array.isArray(testsListQuery.data?.data) ? testsListQuery.data.data : [];
  const selectedTestMeta = testsList.find((item) => String(item.testId) === String(testId)) || null;
  const studentDetail = studentDetailQuery.data || {};
  const reports = Array.isArray(reportsQuery.data) ? reportsQuery.data : [];

  const metrics = scope.metrics || {};
  // Both lists arrive as one server-side page: the API filtered, sorted and
  // paged them, so the page only normalises a row for rendering.
  // The API answers `null` for a percentage it has no data for, so these stay
  // null (rendered as "—") instead of being collapsed into a real 0%.
  const departmentRows = (Array.isArray(scope.departmentRows) ? scope.departmentRows : []).map((row) => ({
    departmentId: row.departmentId,
    college: row.college || "-",
    department: row.department || "-",
    students: toNumber(row.students),
    submissions: toNumber(row.submissions),
    avgScore: percentOrNull(row.avgScore),
    passRate: percentOrNull(row.passRate),
    participation: percentOrNull(row.participation),
    violations: toNumber(row.violations),
  }));
  const departmentPagination = toPagination(scope.departmentPagination, departmentRows.length);

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
    avgScore: percentOrNull(row.avgScore),
    testsTaken: toNumber(row.testsTaken),
    participation: percentOrNull(row.participation),
    violations: toNumber(row.violations),
  }));
  // A test deep-dive asks for the complete student list (for "not attended"), so
  // the API sends no page metadata and the ranking table is not rendered.
  const studentListPagination = scope.studentPagination ? toPagination(scope.studentPagination, studentRows.length) : null;

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
    score: percentOrNull(item.score),
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

  // Per-module averages for MODULE_TEST results (section performance).
  const moduleStats = Array.isArray(scope.modulePerformance?.moduleStats) ? scope.modulePerformance.moduleStats : [];

  // Student KPIs come from the student's own analytics call. Question accuracy
  // is summed across their attempts and stays null when they have no graded
  // questions, so a student who never sat a test never reads as 0%.
  const studentQuestions = attemptRows.reduce(
    (acc, row) => ({
      correct: acc.correct + toNumber(row.questionAnalysis?.correct),
      total: acc.total + toNumber(row.questionAnalysis?.total),
    }),
    { correct: 0, total: 0 }
  );
  const studentAccuracy = studentQuestions.total > 0
    ? percentOrNull((studentQuestions.correct / studentQuestions.total) * 100)
    : null;

  // Batch table rows: the batches endpoint counts students and tests per batch
  // but carries no scores; scores appear once a batch is opened and the
  // analytics narrow to it. The endpoint has no sort parameter, so the current
  // page is ordered here only.
  const batchRows = (Array.isArray(batchesTableQuery.data?.data) ? batchesTableQuery.data.data : []).map((batch) => ({
    id: batch.id,
    name: batch.name || "-",
    college: batch.college?.name || "-",
    department: batch.department?.name
      || (Array.isArray(batch.departments) && batch.departments.length
        ? batch.departments.map((item) => item.name).filter(Boolean).join(", ")
        : "-"),
    year: batch.year ?? null,
    students: batch._count?.students ?? null,
    tests: batch._count?.tests ?? null,
  }));
  // The API returns the page already sorted, so nothing is reordered here.
  const batchPagination = toPagination(batchesTableQuery.data?.pagination, batchRows.length);

  // Per-test student results table: driven by the /table endpoint (per-submission
  // rows, server-side search/sort/pagination), matching College Admin.
  const testTableRows = Array.isArray(testTableQuery.data?.data) ? testTableQuery.data.data : [];
  const testTablePagination = testTableQuery.data?.pagination || { page: 1, totalPages: 1, total: 0 };
  const sortedAttemptRows = sortRows(attemptRows, attemptSort);

  // Leaving a mode resets what that mode owned: the department list search has
  // no control outside the Departments tab, so it must not filter the overview.
  useEffect(() => {
    setDepartmentSort(DEFAULT_SORTS.department);
    setRosterSort(DEFAULT_SORTS.student);
    setBatchSort(DEFAULT_SORTS.batch);
    if (mode !== "student") setStudentSearch("");
    setDepartmentSearch("");
    setDepartmentPage(1);
    setBatchPage(1);
    setRosterPage(1);
  }, [mode]);

  // A new search or a new scope always starts each server-side list at page 1.
  useEffect(() => {
    setDepartmentPage(1);
  }, [departmentSearch, collegeId, departmentId, batchId, studentYear, academicStatus, passoutYear, passoutCohortId, dateFrom, dateTo]);

  useEffect(() => {
    setBatchPage(1);
  }, [batchSearch, collegeId, departmentId, studentYear, academicStatus, passoutYear, passoutCohortId, dateFrom, dateTo]);

  useEffect(() => {
    setRosterPage(1);
  }, [rosterSearch, collegeId, departmentId, batchId, testId, studentYear, academicStatus, passoutYear, passoutCohortId, dateFrom, dateTo]);

  // A narrower result set can leave the open page past the last one the server
  // has; step back to that last page instead of showing an empty table.
  useEffect(() => {
    if (scopeQuery.isFetching) return;
    if (departmentPagination.totalPages > 0 && departmentPage > departmentPagination.totalPages) {
      setDepartmentPage(departmentPagination.totalPages);
    }
    if (studentListPagination && studentListPagination.totalPages > 0 && rosterPage > studentListPagination.totalPages) {
      setRosterPage(studentListPagination.totalPages);
    }
    if (batchPagination.totalPages > 0 && batchPage > batchPagination.totalPages) {
      setBatchPage(batchPagination.totalPages);
    }
  }, [scopeQuery.isFetching, departmentPagination.totalPages, departmentPage, studentListPagination, rosterPage, batchPagination.totalPages, batchPage]);

  useEffect(() => {
    setTestsPage(1);
  }, [testsSearch, testsSort, testsStatus, collegeId, departmentId, batchId, studentYear, academicStatus, passoutYear, passoutCohortId, dateFrom, dateTo]);

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
          academicStatus,
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
      const params = toQueryString(
        {
          dataset,
          collegeId,
          testId: dataset === "item-analysis" ? testId : undefined,
          testIds: dataset === "results" ? pickedTestIds.join(",") : undefined,
          departmentId: departmentId || undefined,
          batchId: batchId || undefined,
          year: studentYear || undefined,
          academicStatus,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        },
        SCOPE_QUERY_OPTIONS
      );
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

  // Sorting a server-side list re-requests it, so a new column starts ascending
  // and the same column flips direction.
  const handleDepartmentSort = (key) => {
    setDepartmentSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  // The attempt history keeps its own sort: it lives next to the student ranking
  // in the same mode, and the two tables sort by unrelated columns.
  const handleAttemptSort = (key) => {
    setAttemptSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key, dir: "desc" };
    });
  };

  // Same reasoning for the ranking table: in Batch mode it sits under the batch
  // table, and sharing one sort would make the two tables fight over it.
  const handleRosterSort = (key) => {
    setRosterSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  // The batch endpoint has no sort parameter, so this one orders the page it
  // already received.
  const handleBatchSort = (key) => {
    setBatchSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  const handleDateChange = (key, value) => {
    updateParams({ [key]: value || "", student_id: "" });
  };

  const handleDepartmentOpen = (nextDepartmentId) => {
    updateParams({ department: nextDepartmentId || "", mode: "departments", student_id: "", batch_id: "", test: "" });
    setTestsPage(1);
  };

  const handleStudentOpen = (row) => {
    updateParams({
      college: row.collegeId || collegeId || "",
      department: row.departmentId || departmentId,
      student_id: row.studentId,
      mode: "student",
      // The student's own report is not batch-scoped, so a batch carried over
      // from the Batch tab would silently contradict its numbers.
      batch_id: "",
    });
    setRosterSearch("");
    setRosterPage(1);
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

  const handleAcademicStatusChange = (nextStatus) => {
    // "all" is a real status choice, so it stays in the URL; passout filters
    // only apply to a status that can include students who have left.
    const keepsPassoutFilters = PASSOUT_STATUSES.has(nextStatus);
    updateParams(
      {
        academicStatus: nextStatus,
        passout_year: keepsPassoutFilters ? passoutYear : "",
        passout_cohort: keepsPassoutFilters ? passoutCohortId : "",
        student_id: "",
      },
      ["academicStatus"]
    );
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
  const totalSubmissions = toNumber(metrics.totalSubmissions);
  const totalTests = toNumber(metrics.totalTests);
  const avgScore = percentOrNull(metrics.avgScore);
  const passRate = percentOrNull(metrics.passRate);
  const participationRate = percentOrNull(metrics.participationRate);
  const flagsMetric = {
    key: "flags",
    label: "Integrity flags",
    value: violationCount.toLocaleString(),
    hint: "Proctoring violations",
    tone: violationCount > 0 ? "danger" : "default",
  };
  const passMetric = { key: "pass", label: "Pass rate", value: formatRate(passRate), hint: "Scored 40% or more" };

  const deepDiveMetrics = [
    {
      key: "attempted",
      label: "Attempted",
      value: formatRate(participationRate),
      hint: totalStudents ? `${attemptedStudents} of ${totalStudents} students` : "Of assigned students",
    },
    { key: "avg", label: "Average score", value: formatRate(avgScore), hint: "Submitted attempts" },
    passMetric,
    flagsMetric,
  ];

  /**
   * The six headline KPIs for the current scope. Counts and rates are kept
   * apart: every rate states the sample it came from, and a rate the API could
   * not compute reads "N/A" instead of a misleading 0%.
   */
  const renderKpiStrip = () => (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <StatCard
        iconName="students"
        iconTone="navy"
        label="Total students"
        value={formatCount(totalStudents)}
        sub="Students in this scope"
      />
      <StatCard
        iconName="participation"
        iconTone="primary"
        label="Students attempted"
        value={formatCount(attemptedStudents)}
        sub={`of ${totalStudents.toLocaleString()} students`}
      />
      <StatCard
        iconName="submissions"
        iconTone="warning"
        label="Total submissions"
        value={formatCount(totalSubmissions)}
        sub={`Across ${totalTests.toLocaleString()} ${totalTests === 1 ? "test" : "tests"}`}
      />
      <StatCard
        iconName="score"
        iconTone="success"
        label="Average score"
        value={formatRate(avgScore)}
        sub={totalSubmissions ? `From ${totalSubmissions.toLocaleString()} submissions` : "No submissions yet"}
      />
      <StatCard
        iconName="target"
        iconTone="success"
        label="Pass rate"
        value={formatRate(passRate)}
        sub={totalSubmissions ? `Scored 40%+ in ${totalSubmissions.toLocaleString()} submissions` : "No submissions yet"}
      />
      <StatCard
        iconName="alert"
        iconTone={participationRate != null && participationRate < 60 ? "danger" : "primary"}
        label="Participation rate"
        value={formatRate(participationRate)}
        sub={
          participationRate == null
            ? "No students in this scope"
            : `${attemptedStudents.toLocaleString()} of ${totalStudents.toLocaleString()} students attempted`
        }
      />
    </div>
  );

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
    academicStatus !== "current" ? ACADEMIC_STATUS_OPTIONS.find((option) => option.value === academicStatus)?.label : null,
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

  /**
   * Section performance, straight from the module stats the analytics already
   * returns. Rows keep the module order the API sends; the weakest section is
   * only called out in the subtitle, and a section with no data can never be
   * picked as the weakest one.
   */
  const renderSectionPerformance = () => {
    if (moduleStats.length === 0) return null;
    const ranked = [...moduleStats].sort((a, b) => comparePercentAsc(a.averagePercentage, b.averagePercentage));
    const weakest = moduleStats.length > 1 ? ranked[0] : null;
    return (
      <SectionCard
        title="Section performance"
        subtitle={
          weakest
            ? `Weakest section: ${weakest.name} (${formatRate(percentOrNull(weakest.averagePercentage))} average)`
            : `Average across ${moduleStats.length} ${moduleStats.length === 1 ? "section" : "sections"}`
        }
        bodyClassName="p-0"
      >
        <div className="relative overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Average score, completion rate and time taken per section</caption>
            <thead>
              <tr>
                <Th>Section</Th>
                <Th>Attempts</Th>
                <Th>Average</Th>
                <Th>Score %</Th>
                <Th>Completion rate</Th>
                <Th>Avg time</Th>
              </tr>
            </thead>
            <tbody>
              {moduleStats.map((stat) => (
                <tr key={stat.key} className="border-t border-border/70">
                  <td className="px-4 py-3 font-medium text-text-primary">{stat.name}</td>
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{formatCount(stat.attempts)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <ScoreWithMarks
                      percent={percentOrNull(stat.averagePercentage)}
                      obtained={toNumber(stat.averageScore).toFixed(1)}
                      total={toNumber(stat.averageMaxScore).toFixed(1)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-primary">
                    {formatRate(percentOrNull(stat.averagePercentage))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">
                    {formatRate(percentOrNull(stat.completionRate))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">
                    {stat.averageTimeSeconds == null ? NO_DATA_TEXT : formatSecondsShort(stat.averageTimeSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    );
  };

  // Ranked students in scope; the Student tab uses it as the picker. The rows
  // come back one server-side page at a time.
  const renderStudentRanking = () => {
    const pagination = studentListPagination || toPagination(null, 0);
    return (
      <SectionCard
        title="Students"
        subtitle={`${pagination.total.toLocaleString()} ${pagination.total === 1 ? "student" : "students"} in scope. Select a student to open their report.`}
        bodyClassName="p-0"
        right={
          <SearchInput
            value={rosterSearch}
            onChange={(event) => setRosterSearch(event.target.value)}
            placeholder="Search name, roll no, department"
            label="Search students in this list"
            className="w-full sm:w-72"
          />
        }
      >
        <div className="relative overflow-x-auto" aria-busy={scopeQuery.isFetching}>
          <table className="min-w-full text-sm">
            <caption className="sr-only">Students in scope with rank, tests taken, average score, participation and violations</caption>
            <thead>
              <tr>
                <Th sortKey="rank" sortState={rosterSort} onSort={handleRosterSort}>Rank</Th>
                <Th sortKey="name" sortState={rosterSort} onSort={handleRosterSort}>Student</Th>
                <Th sortKey="rollNo" sortState={rosterSort} onSort={handleRosterSort}>Roll no</Th>
                <Th sortKey="department" sortState={rosterSort} onSort={handleRosterSort}>Department</Th>
                <Th sortKey="batch" sortState={rosterSort} onSort={handleRosterSort}>Batch</Th>
                <Th sortKey="year" sortState={rosterSort} onSort={handleRosterSort}>Year</Th>
                <Th sortKey="testsTaken" sortState={rosterSort} onSort={handleRosterSort}>Tests taken</Th>
                <Th sortKey="avgScore" sortState={rosterSort} onSort={handleRosterSort}>Average</Th>
                <Th sortKey="participation" sortState={rosterSort} onSort={handleRosterSort}>Participation</Th>
                <Th sortKey="violations" sortState={rosterSort} onSort={handleRosterSort}>Violations</Th>
              </tr>
            </thead>
            <tbody>
              {studentRows.map((row) => (
                <tr key={row.studentId} className="border-t border-border/70 hover:bg-muted/40">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{row.rank ?? NO_DATA_TEXT}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleStudentOpen(row)}
                      className="flex items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Avatar name={row.name} seed={row.studentId} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-text-primary hover:text-primary">{row.name}</span>
                        <span className="block truncate text-xs text-text-secondary">{row.college}</span>
                      </span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">{row.rollNo}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.department}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.batch}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">{row.year ?? NO_DATA_TEXT}</td>
                  <td className="px-4 py-3 tabular-nums">{formatCount(row.testsTaken)}</td>
                  <td className="whitespace-nowrap px-4 py-3"><ScoreBadge score={row.avgScore} noDataLabel={NO_DATA_TEXT} /></td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">{formatRate(row.participation)}</td>
                  <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                </tr>
              ))}
              {studentRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8">
                    <EmptyState
                      title="No students match"
                      description={rosterSearch ? "Try a different name, roll number or department." : "Adjust the filters above to find students."}
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border/70 px-4 py-3">
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            onPageChange={setRosterPage}
          />
        </div>
      </SectionCard>
    );
  };

  const renderSuperTestDeepDive = () => {
    const moduleColumns = moduleColumnDefs(testTableRows, scope?.modulePerformance);
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

            {renderSectionPerformance()}

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Score distribution" height="h-[220px]" footer="Students per score band.">
                <ScoreDistributionChart data={scope.distribution || []} height="h-full" />
              </ChartCard>
              <ChartCard title="Subject performance" height="h-[220px]" footer="Average score per subject.">
                <SubjectPerformanceChart topics={subjectData} height="h-full" />
              </ChartCard>
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
                  <caption className="sr-only">Per-student results for this test, with module marks and integrity violations</caption>
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
            <span>Academic Status</span>
            <select
              value={academicStatus}
              onChange={(event) => handleAcademicStatusChange(event.target.value)}
              disabled={!collegeId}
              className="ui-select w-full"
            >
              {ACADEMIC_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-text-secondary">
            <span>From</span>
            <Input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => handleDateChange("date_from", event.target.value)}
              disabled={!collegeId}
              aria-label="Submissions from date"
              className={cn(ui.field, "w-full")}
            />
          </label>

          <label className="space-y-1 text-xs text-text-secondary">
            <span>To</span>
            <Input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => handleDateChange("date_to", event.target.value)}
              disabled={!collegeId}
              aria-label="Submissions to date"
              className={cn(ui.field, "w-full")}
            />
          </label>

          {showPassoutFilters ? (
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
          {hasDateRange ? (
            <button
              type="button"
              onClick={() => updateParams({ date_from: "", date_to: "", student_id: "" })}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-background px-3 text-xs font-medium text-text-primary outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-3.5" />
              Clear date range
            </button>
          ) : null}
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
          <ModeHeader
            title={selectedBatch?.name || MODE_META.batch.title}
            description={selectedBatch ? `${selectedBatch.year ? `${selectedBatch.year} · ` : ""}${selectedBatch.college?.name || selectedCollege?.name || "Selected college"}` : MODE_META.batch.description}
          >
            {selectedBatch ? (
              <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={() => handleBatchChange("")}>
                All batches
              </Button>
            ) : null}
          </ModeHeader>

          <SectionCard
            title="Batches"
            subtitle={`${batchPagination.total.toLocaleString()} ${batchPagination.total === 1 ? "batch" : "batches"} in this college. Open one to see its performance.`}
            bodyClassName="p-0"
            right={
              <SearchInput
                value={batchSearch}
                onChange={(event) => setBatchSearch(event.target.value)}
                placeholder="Search batch, college or department"
                label="Search batches"
                className="w-full sm:w-72"
              />
            }
          >
            <div className="relative overflow-x-auto" aria-busy={batchesTableQuery.isFetching}>
              <table className="min-w-full text-sm">
                <caption className="sr-only">Batches in this college with student and test counts</caption>
                <thead>
                  <tr>
                    <Th sortKey="name" sortState={batchSort} onSort={handleBatchSort}>Batch</Th>
                    <Th>College</Th>
                    <Th>Department</Th>
                    <Th sortKey="year" sortState={batchSort} onSort={handleBatchSort}>Year</Th>
                    <Th>Students</Th>
                    <Th>Tests</Th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((row) => (
                    <tr
                      key={row.id}
                      className={`border-t border-border/70 hover:bg-muted/40 ${String(row.id) === String(batchId) ? "bg-primary/5" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleBatchChange(String(row.id))}
                          aria-label={`Open batch ${row.name}`}
                          className="rounded-md text-left font-medium text-text-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.college}</td>
                      <td className="px-4 py-3 text-text-secondary">{row.department}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">{row.year ?? NO_DATA_TEXT}</td>
                      <td className="px-4 py-3 tabular-nums">{formatCount(row.students)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatCount(row.tests)}</td>
                    </tr>
                  ))}
                  {batchRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8">
                        <EmptyState
                          title="No batches match"
                          description={batchSearch ? "Try a different batch, college or department." : "Batches appear once the college has some."}
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border/70 px-4 py-3">
              <Pagination page={batchPagination.page} totalPages={batchPagination.totalPages} total={batchPagination.total} onPageChange={setBatchPage} />
            </div>
          </SectionCard>

          {analyticsReady ? (
            <>
              {/* Batch KPIs are only meaningful once a batch narrows the scope. */}
              {selectedBatch ? renderKpiStrip() : null}
              {renderStudentRanking()}
            </>
          ) : null}

          {renderTestsListCard()}
        </section>
      ) : null}

      {hasCollegeSelected && !isTestDeepDive && mode === "at-risk" ? (
        <section className="space-y-4">
          <ModeHeader title={MODE_META["at-risk"].title} description={MODE_META["at-risk"].description} />
          <AtRiskView
            query={atRiskQuery}
            canViewStudent
            showParticipation
            noDataLabel={NO_DATA_TEXT}
            onViewStudent={(id) => updateParams({ mode: "student", student_id: id })}
          />
        </section>
      ) : null}

      {analyticsReady && mode === "overview" ? (
        <section className="space-y-4">
          <ModeHeader title={MODE_META.overview.title} description={MODE_META.overview.description} />

          {renderKpiStrip()}

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Performance distribution" height="h-[240px]" footer="Students per score band.">
              <ScoreDistributionChart data={scope.distribution || []} height="h-full" />
            </ChartCard>
            <ChartCard title="Subject performance" height="h-[240px]" footer="Average score per subject.">
              <SubjectPerformanceChart topics={subjectData} height="h-full" />
            </ChartCard>
          </div>

          <SectionCard
            title="Departments at a glance"
            subtitle="Select a department to focus the whole report on it."
            bodyClassName="p-0"
          >
            <div className="relative overflow-x-auto" aria-busy={scopeQuery.isFetching}>
              <table className="min-w-full text-sm">
                <caption className="sr-only">Departments in scope with students, submissions, scores, pass rate, participation and violations</caption>
                <thead>
                  <tr>
                    <Th sortKey="department" sortState={departmentSort} onSort={handleDepartmentSort}>Department</Th>
                    <Th sortKey="students" sortState={departmentSort} onSort={handleDepartmentSort}>Students</Th>
                    <Th sortKey="submissions" sortState={departmentSort} onSort={handleDepartmentSort}>Submissions</Th>
                    <Th sortKey="avgScore" sortState={departmentSort} onSort={handleDepartmentSort}>Average</Th>
                    <Th sortKey="passRate" sortState={departmentSort} onSort={handleDepartmentSort}>Pass rate</Th>
                    <Th sortKey="participation" sortState={departmentSort} onSort={handleDepartmentSort}>Participation</Th>
                    <Th sortKey="violations" sortState={departmentSort} onSort={handleDepartmentSort}>Violations</Th>
                  </tr>
                </thead>
                <tbody>
                  {departmentRows.map((row) => (
                    <tr key={row.departmentId || row.department} className="border-t border-border/70 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleDepartmentOpen(row.departmentId)}
                          aria-label={`Open department ${row.department}`}
                          className="rounded-md text-left font-medium text-text-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {row.department}
                        </button>
                        <p className="text-xs text-text-secondary">{row.college}</p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatCount(row.students)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatCount(row.submissions)}</td>
                      <td className="whitespace-nowrap px-4 py-3"><ScoreBadge score={row.avgScore} noDataLabel={NO_DATA_TEXT} /></td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatRate(row.passRate)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatRate(row.participation)}</td>
                      <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                    </tr>
                  ))}
                  {departmentRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8">
                        <EmptyState title="No department results yet" description="Department results appear after students submit tests." />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {departmentPagination.totalPages > 1 ? (
              <div className="border-t border-border/70 px-4 py-3">
                <Pagination
                  page={departmentPagination.page}
                  totalPages={departmentPagination.totalPages}
                  total={departmentPagination.total}
                  onPageChange={setDepartmentPage}
                />
              </div>
            ) : null}
          </SectionCard>

          {renderSectionPerformance()}

          {renderTestsListCard()}

          <RecentExports reports={reports} onDownload={downloadJob} subtitle="Generated PDFs for this college." />
        </section>
      ) : null}

      {analyticsReady && mode === "departments" ? (
        <section className="space-y-4">
          <ModeHeader
            title={selectedDepartment ? selectedDepartment.name : MODE_META.departments.title}
            description={
              selectedDepartment
                ? `${selectedDepartment.college?.name || selectedCollege?.name || "Selected college"} · focused on this department.`
                : MODE_META.departments.description
            }
          >
            {selectedDepartment ? (
              <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={() => handleDepartmentOpen("")}>
                All departments
              </Button>
            ) : null}
          </ModeHeader>

          <SectionCard
            title="Departments"
            subtitle={`${departmentPagination.total.toLocaleString()} ${departmentPagination.total === 1 ? "department" : "departments"} in scope. Select one to drill in.`}
            bodyClassName="p-0"
            right={
              <SearchInput
                value={departmentSearch}
                onChange={(event) => setDepartmentSearch(event.target.value)}
                placeholder="Search department"
                label="Search departments"
                className="w-full sm:w-72"
              />
            }
          >
            <div className="relative overflow-x-auto" aria-busy={scopeQuery.isFetching}>
              <table className="min-w-full text-sm">
                <caption className="sr-only">Departments in scope with students, submissions, average score, pass rate, participation and violations</caption>
                <thead>
                  <tr>
                    <Th sortKey="department" sortState={departmentSort} onSort={handleDepartmentSort}>Department</Th>
                    <Th sortKey="students" sortState={departmentSort} onSort={handleDepartmentSort}>Students</Th>
                    <Th sortKey="submissions" sortState={departmentSort} onSort={handleDepartmentSort}>Submissions</Th>
                    <Th sortKey="avgScore" sortState={departmentSort} onSort={handleDepartmentSort}>Average</Th>
                    <Th sortKey="passRate" sortState={departmentSort} onSort={handleDepartmentSort}>Pass rate</Th>
                    <Th sortKey="participation" sortState={departmentSort} onSort={handleDepartmentSort}>Participation</Th>
                    <Th sortKey="violations" sortState={departmentSort} onSort={handleDepartmentSort}>Violations</Th>
                  </tr>
                </thead>
                <tbody>
                  {departmentRows.map((row) => (
                    <tr key={row.departmentId || row.department} className="border-t border-border/70 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleDepartmentOpen(row.departmentId)}
                          aria-label={`Open department ${row.department}`}
                          className="rounded-md text-left font-medium text-text-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {row.department}
                        </button>
                        <p className="text-xs text-text-secondary">{row.college}</p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatCount(row.students)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatCount(row.submissions)}</td>
                      <td className="whitespace-nowrap px-4 py-3"><ScoreBadge score={row.avgScore} noDataLabel={NO_DATA_TEXT} /></td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatRate(row.passRate)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatRate(row.participation)}</td>
                      <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                    </tr>
                  ))}
                  {departmentRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8">
                        <EmptyState
                          title="No departments match"
                          description={departmentSearch ? "Try a different department name." : "Department results appear after students submit tests."}
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border/70 px-4 py-3">
              <Pagination
                page={departmentPagination.page}
                totalPages={departmentPagination.totalPages}
                total={departmentPagination.total}
                onPageChange={setDepartmentPage}
              />
            </div>
          </SectionCard>
        </section>
      ) : null}

      {analyticsReady && mode === "student" && studentId ? (
        <section className="space-y-4">
          <ModeHeader
            title={selectedStudent?.name || "Student report"}
            description={MODE_META.student.description}
          >
            <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={() => updateParams({ student_id: "" })}>
              <ArrowLeft className="size-4" />
              Back to all students
            </Button>
          </ModeHeader>

          {studentDetailQuery.isLoading ? (
            <section className="rounded-xl border border-border bg-card p-4 text-sm text-text-secondary" role="status">Loading student results…</section>
          ) : (
            <>
              <StudentSummary student={selectedStudent} metrics={selectedStudentMetrics} />

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  iconName="score"
                  iconTone="success"
                  label="Average score"
                  value={formatRate(percentOrNull(selectedStudentMetrics.avgScore))}
                  sub={`Across ${formatCount(attemptRows.length)} submitted ${attemptRows.length === 1 ? "test" : "tests"}`}
                />
                <StatCard
                  iconName="submissions"
                  iconTone="primary"
                  label="Tests attempted"
                  value={formatCount(attemptRows.length)}
                  sub={selectedStudent?.batch ? `Batch: ${selectedStudent.batch}` : "In this scope"}
                />
                <StatCard
                  iconName="target"
                  iconTone="primary"
                  label="Questions correct"
                  value={formatRate(studentAccuracy)}
                  sub={studentQuestions.total > 0 ? `${studentQuestions.correct.toLocaleString()} of ${studentQuestions.total.toLocaleString()} questions` : "No graded questions yet"}
                />
                <StatCard
                  iconName="alert"
                  iconTone={toNumber(selectedStudentMetrics.violations) > 0 ? "danger" : "success"}
                  label="Integrity flags"
                  value={formatCount(selectedStudentMetrics.violations)}
                  sub={toNumber(selectedStudentMetrics.violations) > 0 ? "Proctoring violations on record" : "No proctoring violations"}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Score distribution" height="h-[220px]" footer="Attempts per score band.">
                  <ScoreDistributionChart data={studentDetail.distribution || []} height="h-full" />
                </ChartCard>
                <ChartCard title="Subject performance" height="h-[220px]" footer="Average score per subject.">
                  <SubjectPerformanceChart
                    topics={(studentDetail.subjectPerformance || []).map((row) => ({ subject: row.subject, score: percentOrNull(row.score) }))}
                    height="h-full"
                  />
                </ChartCard>
              </div>

              <SectionCard title="Attempt history" subtitle={`${attemptRows.length} submitted ${attemptRows.length === 1 ? "test" : "tests"}`} bodyClassName="p-0">
                <div className="relative overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <caption className="sr-only">Every submitted test for this student with score, result, time taken and violations</caption>
                    <thead>
                      <tr>
                        <Th sortKey="date" sortState={attemptSort} onSort={handleAttemptSort}>Date</Th>
                        <Th sortKey="testName" sortState={attemptSort} onSort={handleAttemptSort}>Test</Th>
                        <Th sortKey="subject" sortState={attemptSort} onSort={handleAttemptSort}>Subject</Th>
                        <Th sortKey="scorePercent" sortState={attemptSort} onSort={handleAttemptSort}>Score</Th>
                        <Th>Result</Th>
                        <Th sortKey="timeTaken" sortState={attemptSort} onSort={handleAttemptSort}>Time</Th>
                        <Th sortKey="violationsCount" sortState={attemptSort} onSort={handleAttemptSort}>Violations</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAttemptRows.map((row) => (
                        <tr key={row.id} className="border-t border-border/70 hover:bg-muted/40">
                          <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{formatDateLabel(row.date)}</td>
                          <td className="px-4 py-3 font-medium text-text-primary">{row.testName}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{row.subject}</td>
                          <td className="whitespace-nowrap px-4 py-3"><ScoreWithMarks percent={row.scorePercent} obtained={row.obtainedMarks} total={row.totalMarks} /></td>
                          <td className="px-4 py-3"><ResultBadge status={row.status} score={row.scorePercent} /></td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">
                            {row.timeTaken ? formatSecondsShort(row.timeTaken) : NO_DATA_TEXT}
                          </td>
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
                          <td colSpan={7} className="px-4 py-8">
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

      {analyticsReady && mode === "student" && !studentId ? (
        <section className="space-y-4">
          <ModeHeader title={MODE_META.student.title} description={MODE_META.student.description} />
          {renderStudentRanking()}
        </section>
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
        actions={SUPER_REVIEW_ACTIONS}
        onReview={handleViolationReview}
      />
    </div>
  );
}
