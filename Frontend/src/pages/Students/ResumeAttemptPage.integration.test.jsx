import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ResumeAttemptPage from "@/pages/Students/ResumeAttemptPage";
import { studentApi } from "@/services/studentApi";

vi.mock("@/services/studentApi", () => ({
  studentApi: {
    getActiveAttempts: vi.fn(),
  },
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/resume"]}>
        <Routes>
          <Route path="/resume" element={<ResumeAttemptPage />} />
          <Route path="/test/:attemptId" element={<div>Resumed Test</div>} />
          <Route path="/tests/ongoing" element={<div>Ongoing Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe("ResumeAttemptPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to active in-progress attempt when available", async () => {
    studentApi.getActiveAttempts.mockResolvedValue({
      items: [
        {
          id: "test-1",
          submissionId: "attempt-123",
          latestSubmissionStatus: "IN_PROGRESS",
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Resumed Test")).toBeInTheDocument();
    });
  });

  it("redirects to ongoing tests when no resumable attempt exists", async () => {
    studentApi.getActiveAttempts.mockResolvedValue({
      items: [
        {
          id: "test-1",
          submissionId: null,
          latestSubmissionStatus: "SUBMITTED",
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ongoing Page")).toBeInTheDocument();
    });
  });
});
