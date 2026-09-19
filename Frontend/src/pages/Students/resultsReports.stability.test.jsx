import React, { StrictMode } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ResultsPage from "@/pages/Students/ResultsPage";
import ReportsPage from "@/pages/Students/ReportsPage";

vi.mock("@/components/Students/reports-charts/ReportsLineChart", () => ({
  ReportsLineChart: () => <div>Line Chart</div>,
}));

vi.mock("@/components/Students/reports-charts/ReportsRadarChart", () => ({
  ReportsRadarChart: () => <div>Radar Chart</div>,
}));

vi.mock("@/components/Students/reports-charts/ReportsBarChart", () => ({
  ReportsBarChart: () => <div>Bar Chart</div>,
}));

vi.mock("@/services/studentApi", () => ({
  studentApi: {
    getAttemptResult: vi.fn(),
    getReports: vi.fn(),
    getUpcomingTests: vi.fn(),
    exportReportsPdf: vi.fn(),
  },
}));

const { studentApi } = await import("@/services/studentApi");

const renderWithQueryRouter = (ui, initialEntry) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          {ui}
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>
  );
};

describe("Student results and reports pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the results page without crashing during query updates", async () => {
    studentApi.getAttemptResult.mockResolvedValue({
      score: 78,
      percentile: 92,
      time_taken: 750,
      review_mode: "show_score_only",
      test: {
        end_date: new Date(Date.now() + 3600_000).toISOString(),
      },
    });

    renderWithQueryRouter(
      <Routes>
        <Route path="/results/:attemptId" element={<ResultsPage />} />
      </Routes>,
      "/results/attempt-1"
    );

    await waitFor(() => {
      expect(screen.getAllByText("Result Summary").length).toBeGreaterThan(0);
    });
  });

  it("shows zero-valued answers instead of treating them as unanswered", async () => {
    studentApi.getAttemptResult.mockResolvedValue({
      score: 5,
      percentile: 50,
      time_taken: 120,
      review_mode: "show_all",
      is_test_completed: true,
      can_review_answers: true,
      question_breakdown: [
        {
          question_id: "q-1",
          prompt: "Pick the first option",
          student_answer: 0,
          correct_answer: 1,
          marks: 0,
          total_marks: 1,
        },
      ],
    });

    renderWithQueryRouter(
      <Routes>
        <Route path="/results/:attemptId" element={<ResultsPage />} />
      </Routes>,
      "/results/attempt-1"
    );

    await waitFor(() => {
      expect(screen.getByText("View Answers")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("View Answers"));

    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("Not answered")).not.toBeInTheDocument();
  });

  it("renders the reports page without crashing during query updates", async () => {
    studentApi.getReports.mockImplementation(async (filters = {}) => {
      if (filters?.view === "by_test") {
        return {
          by_test: {
            test: { id: "test-1", title: "Algorithms Mock 1" },
            total_marks: 100,
            obtained_marks: 82,
            percentage: 82,
            percentile: 91,
            time_analytics: {
              total_time: "42m",
              avg_time_per_question: "1m 24s",
            },
            questions: [
              {
                id: "q-1",
                topic: "Graphs",
                type: "MCQ",
                student_answer: "B",
                correct_answer: "B",
                marks: 4,
              },
            ],
          },
          test: { id: "test-1", title: "Algorithms Mock 1" },
        };
      }

      return {
        overall: {
          summary: {
            tests_taken: 3,
            avg_score: 76,
            best_score: 88,
            missed_tests: 1,
          },
          line_chart: [{ label: "Mock 1", score: 76 }],
          topic_performance: [
            { subject: "Graphs", score: 81 },
            { subject: "DP", score: 72 },
            { subject: "Trees", score: 85 },
          ],
        },
        test_wise: [
          {
            test_id: "test-1",
            test_name: "Algorithms Mock 1",
            submission_id: "attempt-1",
          },
        ],
      };
    });

    studentApi.getUpcomingTests.mockResolvedValue({
      items: [{ id: "test-2", title: "Networks Mock 1" }],
    });

    renderWithQueryRouter(
      <Routes>
        <Route path="/reports" element={<ReportsPage />} />
      </Routes>,
      "/reports"
    );

    await waitFor(() => {
      expect(screen.getByText("Tests Attempted")).toBeInTheDocument();
    });
  });
});
