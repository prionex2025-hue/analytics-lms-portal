import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import EscalationsPage from "@/pages/SuperAdmin/EscalationsPage";
import { superAdminApi } from "@/services/api";

vi.mock("@/services/api", () => ({
  superAdminApi: {
    getColleges: vi.fn(),
    getEscalatedAnomalies: vi.fn(),
    reviewReportAnomaly: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

const pendingItem = {
  id: "log-1",
  testId: "t1",
  anomalyId: "v1",
  anomalyType: "TAB_SWITCH",
  reason: "Switched tabs 14 times",
  escalatedAt: "2026-09-20T09:00:00.000Z",
  college: { id: "c1", name: "North College", code: "NC" },
  admin: { id: "a1", fullName: "Priya Admin" },
  test: { id: "t1", title: "Aptitude 1" },
  student: { id: "s1", name: "Asha Rao", rollNo: "NC-042" },
  violation: { type: "TAB_SWITCH", occurredAt: "2026-09-19T10:00:00.000Z", submissionId: "sub-1" },
  status: "pending",
  resolution: null,
};

const renderPage = (initialEntry = "/super-admin/escalations") => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <EscalationsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe("EscalationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    superAdminApi.getColleges.mockResolvedValue({ data: [{ id: "c1", name: "North College" }] });
    superAdminApi.getEscalatedAnomalies.mockResolvedValue({
      data: [pendingItem],
      summary: { pending: 1, resolved: 2, withdrawn: 0, total: 3 },
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      truncated: false,
    });
    superAdminApi.reviewReportAnomaly.mockResolvedValue({ message: "ok" });
  });

  it("loads the pending queue with counts, student, and a link to the test report", async () => {
    renderPage();

    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(superAdminApi.getEscalatedAnomalies).toHaveBeenCalledWith(expect.stringContaining("status=pending"));
    expect(screen.getByRole("button", { name: "Pending (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolved (2)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open report" })).toHaveAttribute("href", "/super-admin/reports?college=c1&test=t1");
  });

  it("requests status=all explicitly (not dropped as a sentinel)", async () => {
    renderPage("/super-admin/escalations?status=all");
    await screen.findByText("Asha Rao");
    expect(superAdminApi.getEscalatedAnomalies).toHaveBeenCalledWith(expect.stringContaining("status=all"));
  });

  it("confirms an escalation with the admin's context shown", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Switched tabs 14 times/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByPlaceholderText("Review reason"), { target: { value: "Confirmed on replay" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(superAdminApi.reviewReportAnomaly).toHaveBeenCalledWith({
        testId: "t1",
        anomalyId: "v1",
        anomalyType: "TAB_SWITCH",
        action: "CONFIRM",
        reason: "Confirmed on replay",
      })
    );
  });
});
