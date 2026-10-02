import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ReportsPage from "@/pages/SuperAdmin/ReportsPage";
import { superAdminApi } from "@/services/api";

// The page must never reach for the removed trends endpoint, so it is
// deliberately absent from this mock: calling it would throw.
vi.mock("@/services/api", () => ({
  superAdminApi: {
    getColleges: vi.fn(),
    getDepartments: vi.fn(),
    getTests: vi.fn(),
    getPassoutCohorts: vi.fn(),
    getBatches: vi.fn(),
    getStudents: vi.fn(),
    getReports: vi.fn(),
    getReportAnalytics: vi.fn(),
    getReportTests: vi.fn(),
    getReportTable: vi.fn(),
    getReportAtRisk: vi.fn(),
    getReportItemAnalysis: vi.fn(),
    getReportIntegrity: vi.fn(),
    reviewReportAnomaly: vi.fn(),
  },
}));

const analyticsPayload = {
  filters: {},
  // A scope with no graded work: the API answers null for every rate, and the
  // page must show that as "N/A" rather than a 0%.
  metrics: {
    totalStudents: 24,
    attemptedStudents: 0,
    totalTests: 2,
    totalSubmissions: 0,
    avgScore: null,
    passRate: null,
    participationRate: null,
    violations: 0,
  },
  subjectPerformance: [{ subject: "Physics", score: null }],
  distribution: [],
  departmentRows: [
    {
      departmentId: "d1",
      department: "Computer Science",
      collegeId: "c1",
      college: "North College",
      students: 24,
      submissions: 0,
      avgScore: null,
      passRate: null,
      participation: null,
      violations: 0,
    },
  ],
  tableRows: [
    {
      rank: null,
      studentId: "s1",
      name: "Asha Rao",
      rollNo: "NC-042",
      collegeId: "c1",
      college: "North College",
      departmentId: "d1",
      department: "Computer Science",
      batch: "2024",
      year: 2,
      avgScore: null,
      testsTaken: 0,
      participation: null,
      violations: 0,
    },
  ],
  selectedStudent: null,
  attemptHistory: [],
  // Page metadata comes from the API; the lists arrive one page at a time.
  departmentPagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
  studentPagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
};

const renderPage = (entry = "/super-admin/reports?college=c1") => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe("Super Admin ReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    superAdminApi.getColleges.mockResolvedValue({ data: [{ id: "c1", name: "North College" }] });
    superAdminApi.getDepartments.mockResolvedValue({ data: [{ id: "d1", name: "Computer Science", college: { name: "North College" } }] });
    superAdminApi.getTests.mockResolvedValue({ data: [{ id: "t1", title: "Aptitude 1" }] });
    superAdminApi.getPassoutCohorts.mockResolvedValue({ data: [] });
    superAdminApi.getBatches.mockResolvedValue({ data: [], pagination: { page: 1, limit: 10, total: 0, pages: 1 } });
    superAdminApi.getStudents.mockResolvedValue({ data: [] });
    superAdminApi.getReports.mockResolvedValue([]);
    // The lists are served one page at a time, so the mock filters the student
    // roster the same way the API does.
    superAdminApi.getReportAnalytics.mockImplementation(async (queryString = "") => {
      const search = (new URLSearchParams(queryString).get("studentsSearch") || "").toLowerCase();
      if (!search) return analyticsPayload;
      const rows = analyticsPayload.tableRows.filter((row) =>
        [row.name, row.rollNo, row.department, row.batch].some((value) => String(value ?? "").toLowerCase().includes(search))
      );
      return {
        ...analyticsPayload,
        tableRows: rows,
        studentPagination: { page: 1, limit: 10, total: rows.length, totalPages: 1 },
      };
    });
    superAdminApi.getReportTests.mockResolvedValue({ data: [], pagination: { page: 1, totalPages: 1, total: 0 } });
    superAdminApi.getReportTable.mockResolvedValue({ data: [], pagination: { page: 1, totalPages: 1, total: 0 } });
    superAdminApi.getReportAtRisk.mockResolvedValue({
      students: [
        {
          studentId: "s1",
          name: "Asha Rao",
          rollNo: "NC-042",
          department: "Computer Science",
          batch: "2024",
          riskLevel: "MODERATE",
          riskScore: 40,
          averageScore: null,
          participation: null,
          reasons: [{ code: "LOW_PARTICIPATION", label: "Low participation", detail: "1 of 3 tests" }],
        },
      ],
      summary: { atRisk: 1, assessed: 24, critical: 0, high: 0, moderate: 1 },
    });
  });

  it("shows the six headline KPIs and reads missing rates as N/A", async () => {
    renderPage();

    expect(await screen.findByText("Total students")).toBeInTheDocument();
    expect(screen.getByText("Students attempted")).toBeInTheDocument();
    expect(screen.getByText("Total submissions")).toBeInTheDocument();
    expect(screen.getByText("Average score")).toBeInTheDocument();
    expect(screen.getByText("Participation rate")).toBeInTheDocument();
    // "Pass rate" is both a KPI label and a column header in the table below.
    expect(screen.getAllByText("Pass rate").length).toBeGreaterThanOrEqual(1);

    // No submissions in scope: every rate is "N/A", never 0%.
    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("keeps sending the academic status filter and never asks for trends", async () => {
    renderPage();

    await waitFor(() => expect(superAdminApi.getReportAnalytics).toHaveBeenCalled());
    expect(superAdminApi.getReportAnalytics).toHaveBeenCalledWith(expect.stringContaining("academicStatus=current"));
    expect(superAdminApi.getReportAnalytics).not.toHaveBeenCalledWith(expect.stringContaining("trend"));
  });

  it("drills from the overview department table into the Departments mode", async () => {
    const user = userEvent.setup();
    renderPage();

    const table = await screen.findByRole("table", { name: /departments in scope/i });
    await user.click(within(table).getByRole("button", { name: "Open department Computer Science" }));

    expect(await screen.findByRole("button", { name: /all departments/i })).toBeInTheDocument();
    expect(superAdminApi.getReportAnalytics).toHaveBeenCalledWith(expect.stringContaining("departmentId=d1"));
  });

  it("lists students in scope with a searchable ranking table", async () => {
    const user = userEvent.setup();
    renderPage("/super-admin/reports?college=c1&mode=student");

    const table = await screen.findByRole("table", { name: /students in scope/i });
    expect(within(table).getByRole("columnheader", { name: /rank/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /roll no/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /participation/i })).toBeInTheDocument();
    expect(within(table).getByText("Asha Rao")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/search students in this list/i), "nobody");
    await waitFor(
      () => expect(superAdminApi.getReportAnalytics).toHaveBeenCalledWith(expect.stringContaining("studentsSearch=nobody")),
      { timeout: 3000 }
    );
    expect(await screen.findByText("No students match")).toBeInTheDocument();
  });

  it("asks the API for a server-side page of every list", async () => {
    renderPage("/super-admin/reports?college=c1&mode=departments");

    await waitFor(() => expect(superAdminApi.getReportAnalytics).toHaveBeenCalled());
    const queryString = superAdminApi.getReportAnalytics.mock.calls.at(-1)[0];
    // Paging, sorting and searching are request parameters, not client-side work.
    expect(queryString).toContain("paginate=1");
    expect(queryString).toContain("departmentsPage=1");
    expect(queryString).toContain("departmentsSort=");
    expect(queryString).toContain("studentsPage=1");
    expect(queryString).toContain("studentsLimit=");
  });

  it("renders the at-risk view with a null-safe participation column", async () => {
    renderPage("/super-admin/reports?college=c1&mode=at-risk");

    const header = await screen.findByRole("columnheader", { name: /participation/i });
    const table = header.closest("table");
    // No assigned tests and no average: both read as N/A instead of 0%.
    expect(within(table).getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  });
});