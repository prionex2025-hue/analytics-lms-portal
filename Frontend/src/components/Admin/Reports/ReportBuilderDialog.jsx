import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/common/page-kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Most tests one report may cover (Backend/src/constants/report-limits.js): the
// multi-test PDF lays tests out as columns of a student × test table.
export const MAX_REPORT_TESTS = 10;

// Request filters for a test selection: one test stays a single-test report
// (testId), several make a multi-test report (testIds); none means all tests.
export const toReportTestFilters = (testIds = []) => ({
  testId: testIds.length === 1 ? testIds[0] : undefined,
  testIds: testIds.length > 1 ? testIds : undefined,
});

// Report types mirror the backend generateReportSchema enum
// (Backend/src/schemas/Admin/admin-core.schema.js). Each entry declares the
// scope it needs so the dialog can block a generate the server would reject or
// return empty for.
const REPORT_TYPES = [
  { value: "DEPARTMENT_WISE", label: "Department report", requires: null, hint: "Performance across departments in scope." },
  { value: "BATCH_WISE", label: "Batch report", requires: null, hint: "Batch-level performance and participation." },
  { value: "STUDENT_WISE", label: "Student report", requires: "student", hint: "One student's test-by-test performance." },
  { value: "TEST_WISE", label: "Test report", requires: "test", hint: "Results for the selected tests." },
  { value: "COMPREHENSIVE", label: "Comprehensive (all sections)", requires: null, hint: "Every section: metrics, departments, students, subjects, questions." },
];

const FORMATS = [
  { value: "pdf", label: "PDF" },
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "Excel" },
];

const formatShortDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : "";
};

export default function ReportBuilderDialog({
  open,
  onOpenChange,
  defaultType = "DEPARTMENT_WISE",
  scopeSummary = "",
  hasStudent = false,
  tests = [],
  defaultTestIds = [],
  onGenerate,
}) {
  const [type, setType] = useState(defaultType);
  const [format, setFormat] = useState("pdf");
  const [remarks, setRemarks] = useState("");
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [testSearch, setTestSearch] = useState("");

  const testOptions = useMemo(
    () => (Array.isArray(tests) ? tests : []).filter((test) => test?.id).map((test) => ({ id: String(test.id), title: test.title || "Untitled test", date: test.startsAt || test.endsAt || null })),
    [tests]
  );

  // Re-seed type and test selection from the page each time the dialog opens.
  // defaultTestIds is compared by value so a new array each render doesn't reset it.
  const defaultTestKey = (defaultTestIds || []).map(String).join(",");
  useEffect(() => {
    if (!open) return;
    setType(defaultType);
    setSelectedTestIds(defaultTestKey ? defaultTestKey.split(",") : []);
    setTestSearch("");
  }, [open, defaultType, defaultTestKey]);

  const selectedType = REPORT_TYPES.find((item) => item.value === type) || REPORT_TYPES[0];
  const selectedSet = new Set(selectedTestIds);
  const atLimit = selectedTestIds.length >= MAX_REPORT_TESTS;
  const searchTerm = testSearch.trim().toLowerCase();
  const visibleTests = searchTerm ? testOptions.filter((test) => test.title.toLowerCase().includes(searchTerm)) : testOptions;

  const blockedReason = useMemo(() => {
    if (selectedType.requires === "student" && !hasStudent) return "Select a student first (Student tab) to generate this report.";
    if (selectedType.requires === "test" && selectedTestIds.length === 0) return "Select at least one test for a test report.";
    return "";
  }, [selectedType, hasStudent, selectedTestIds.length]);

  const toggleTest = (id) => {
    setSelectedTestIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= MAX_REPORT_TESTS) return current;
      return [...current, id];
    });
  };

  const formatHint = format === "pdf"
    ? selectedTestIds.length > 1
      ? "PDF with a test-wise results page: each student's score in each selected test."
      : "Formatted PDF, generated in the background."
    : selectedTestIds.length > 0
      ? "One row per student per selected test."
      : "Rows for the data on the current tab.";

  const handleGenerate = () => {
    if (blockedReason) return;
    onGenerate({
      type,
      format,
      filters: {
        testIds: selectedTestIds,
        remarks: remarks.trim() || undefined,
      },
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Report</DialogTitle>
          <DialogDescription>
            Choose the report type, the tests to include, and a format. The report also uses the filters active on the page.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <label className="block space-y-1 text-xs text-text-secondary">
            <span>Report type</span>
            <select value={type} onChange={(event) => setType(event.target.value)} className="ui-select w-full">
              {REPORT_TYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <span className="block text-[11px] text-text-secondary">{selectedType.hint}</span>
          </label>

          <fieldset className="min-w-0 space-y-1.5 text-xs text-text-secondary">
            <div className="flex items-center justify-between gap-2">
              <legend>
                Tests{" "}
                <span className="font-semibold text-text-primary">
                  {selectedTestIds.length ? `${selectedTestIds.length} selected` : "All tests in scope"}
                </span>
              </legend>
              {selectedTestIds.length ? (
                <button type="button" onClick={() => setSelectedTestIds([])} className="text-[11px] font-semibold text-primary hover:opacity-70">
                  Clear
                </button>
              ) : null}
            </div>
            {testOptions.length > 6 ? (
              <input
                value={testSearch}
                onChange={(event) => setTestSearch(event.target.value)}
                placeholder="Search tests…"
                aria-label="Search tests to include"
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
              />
            ) : null}
            <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-background" role="group" aria-label="Tests to include">
              {testOptions.length === 0 ? (
                <p className="px-3 py-3 text-xs">No tests in this scope yet.</p>
              ) : visibleTests.length === 0 ? (
                <p className="px-3 py-3 text-xs">No tests match “{testSearch.trim()}”.</p>
              ) : (
                visibleTests.map((test) => {
                  const checked = selectedSet.has(test.id);
                  const disabled = !checked && atLimit;
                  return (
                    <label
                      key={test.id}
                      className={`flex items-center gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0 ${disabled ? "opacity-50" : "cursor-pointer hover:bg-muted"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleTest(test.id)}
                        className="ui-checkbox shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-text-primary" title={test.title}>{test.title}</span>
                      {test.date ? <span className="shrink-0 text-[11px] tabular-nums">{formatShortDate(test.date)}</span> : null}
                    </label>
                  );
                })
              )}
            </div>
            <span className="block text-[11px]">
              {atLimit ? `Up to ${MAX_REPORT_TESTS} tests per report.` : `Leave empty to include every test. Up to ${MAX_REPORT_TESTS} tests.`}
            </span>
          </fieldset>

          <div className="space-y-1 text-xs text-text-secondary">
            <span>Format</span>
            <div role="group" aria-label="Report format" className="flex overflow-hidden rounded-lg border border-border">
              {FORMATS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={format === item.value}
                  onClick={() => setFormat(item.value)}
                  className={`flex-1 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${format === item.value ? "bg-primary text-primary-foreground" : "bg-background text-text-primary hover:bg-muted"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <span className="block text-[11px] text-text-secondary">{formatHint}</span>
          </div>

          <label className="block space-y-1 text-xs text-text-secondary">
            <span>Remarks (optional)</span>
            <textarea
              value={remarks}
              onChange={(event) => setRemarks(event.target.value.slice(0, 2000))}
              placeholder="Notes to print on the report cover."
              className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </label>

          {scopeSummary ? (
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-text-secondary">
              <span className="font-semibold text-text-primary">Scope: </span>
              {scopeSummary}
            </div>
          ) : null}

          {blockedReason ? (
            <Callout tone="warning">{blockedReason}</Callout>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-10 rounded-lg px-4" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-10 rounded-lg px-4" onClick={handleGenerate} disabled={Boolean(blockedReason)}>
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
