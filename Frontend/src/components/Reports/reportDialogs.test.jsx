import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ViolationReviewDialog from "@/components/Reports/ViolationReviewDialog";
import ReportBuilderDialog, { MAX_REPORT_TESTS, toReportTestFilters } from "@/components/Admin/Reports/ReportBuilderDialog";

const violationEvent = {
  id: "v1",
  type: "TAB_SWITCH",
  anomalyId: "v1",
  anomalyType: "TAB_SWITCH",
  testId: "t1",
  testName: "Aptitude 1",
  createdAt: "2026-09-01T10:00:00.000Z",
};

const SUPER_ACTIONS = [
  { value: "DISMISS", label: "Dismiss", tone: "neutral" },
  { value: "CONFIRM", label: "Confirm", tone: "danger" },
];

describe("ViolationReviewDialog", () => {
  it("requires a reason before submitting", async () => {
    const onReview = vi.fn();
    render(<ViolationReviewDialog open onOpenChange={vi.fn()} studentName="Asha" events={[violationEvent]} actions={SUPER_ACTIONS} onReview={onReview} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("A reason is required before submitting a review.")).toBeInTheDocument();
    expect(onReview).not.toHaveBeenCalled();
  });

  it("submits the portal's action with the violation as the anomaly, then closes", async () => {
    const onReview = vi.fn(async () => {});
    const onOpenChange = vi.fn();
    render(<ViolationReviewDialog open onOpenChange={onOpenChange} studentName="Asha" events={[violationEvent]} actions={SUPER_ACTIONS} onReview={onReview} />);

    fireEvent.change(screen.getByPlaceholderText("Review reason"), { target: { value: "Confirmed on replay" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(onReview).toHaveBeenCalledWith({ testId: "t1", anomalyId: "v1", anomalyType: "TAB_SWITCH", action: "CONFIRM", reason: "Confirmed on replay" })
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the dialog open and shows an error when the review fails", async () => {
    const onReview = vi.fn(async () => {
      throw new Error("boom");
    });
    const onOpenChange = vi.fn();
    render(<ViolationReviewDialog open onOpenChange={onOpenChange} studentName="Asha" events={[violationEvent]} actions={SUPER_ACTIONS} onReview={onReview} />);

    fireEvent.change(screen.getByPlaceholderText("Review reason"), { target: { value: "Dismissing noise" } });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(await screen.findByText("Unable to save review. Please try again.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

const TESTS = Array.from({ length: 12 }, (_, index) => ({ id: `t${index + 1}`, title: `Aptitude Test ${index + 1}` }));

describe("ReportBuilderDialog", () => {
  it("has no date range filters", () => {
    render(<ReportBuilderDialog open onOpenChange={vi.fn()} tests={TESTS} onGenerate={vi.fn()} />);
    expect(screen.queryByLabelText("From date")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("To date")).not.toBeInTheDocument();
    expect(screen.queryByText(/Last 30 days/)).not.toBeInTheDocument();
  });

  it("blocks a student report until a student is selected", () => {
    render(<ReportBuilderDialog open onOpenChange={vi.fn()} defaultType="STUDENT_WISE" hasStudent={false} tests={TESTS} onGenerate={vi.fn()} />);

    expect(screen.getByText(/Select a student first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  it("requires at least one test for a test report", () => {
    render(<ReportBuilderDialog open onOpenChange={vi.fn()} defaultType="TEST_WISE" tests={TESTS} onGenerate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /Aptitude Test 2$/ }));
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("starts from the page's current test and sends every selected test", () => {
    const onGenerate = vi.fn();
    render(<ReportBuilderDialog open onOpenChange={vi.fn()} defaultType="COMPREHENSIVE" tests={TESTS} defaultTestIds={["t1"]} onGenerate={onGenerate} />);

    expect(screen.getByRole("checkbox", { name: /Aptitude Test 1$/ })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /Aptitude Test 3$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    expect(screen.getByText("One row per student per selected test.")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Notes to print on the report cover."), { target: { value: "Term 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(onGenerate).toHaveBeenCalledWith({ type: "COMPREHENSIVE", format: "xlsx", filters: { testIds: ["t1", "t3"], remarks: "Term 1" } });
  });

  it("sends an empty selection (all tests) after Clear", () => {
    const onGenerate = vi.fn();
    render(<ReportBuilderDialog open onOpenChange={vi.fn()} tests={TESTS} defaultTestIds={["t1"]} onGenerate={onGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("All tests in scope")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(onGenerate.mock.calls[0][0].filters.testIds).toEqual([]);
  });

  it(`caps the selection at ${MAX_REPORT_TESTS} tests`, () => {
    render(<ReportBuilderDialog open onOpenChange={vi.fn()} tests={TESTS} onGenerate={vi.fn()} />);

    TESTS.slice(0, MAX_REPORT_TESTS).forEach((test) => {
      fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`${test.title}$`) }));
    });
    expect(screen.getByText(`${MAX_REPORT_TESTS} selected`)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Aptitude Test 11$/ })).toBeDisabled();
  });

  it("filters the test list by search", () => {
    render(<ReportBuilderDialog open onOpenChange={vi.fn()} tests={TESTS} onGenerate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search tests to include"), { target: { value: "Test 12" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });
});

describe("toReportTestFilters", () => {
  it("maps a selection to testId / testIds the way the backend expects", () => {
    expect(toReportTestFilters([])).toEqual({ testId: undefined, testIds: undefined });
    expect(toReportTestFilters(["t1"])).toEqual({ testId: "t1", testIds: undefined });
    expect(toReportTestFilters(["t1", "t2"])).toEqual({ testId: undefined, testIds: ["t1", "t2"] });
  });
});
