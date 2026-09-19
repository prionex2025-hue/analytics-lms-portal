import { Fragment, useEffect, useState } from "react";
import { adminApi } from "@/services/api";

const columns = [
  { key: "studentName", label: "Student Name" },
  { key: "department", label: "Department" },
  { key: "batch", label: "Batch" },
  { key: "testName", label: "Test Name" },
  { key: "scorePercent", label: "Score %" },
  { key: "obtainedMarks", label: "Marks" },
  { key: "timeTaken", label: "Time Taken" },
  { key: "attemptCount", label: "Attempt Count" },
  { key: "status", label: "Status" },
  { key: "violationCount", label: "Malpractice" },
];

const statusTone = (status) => {
  if (status === "SUBMITTED" || status === "AUTO_SUBMITTED" || status === "COMPLETED") return "text-success";
  if (status === "ENDED") return "text-warning";
  return "text-warning";
};

export default function StudentTable({ rows, table, pagination, loading, onSort, onPageChange, onSearchChange, onSelectStudent }) {
  const [searchDraft, setSearchDraft] = useState(table.search || "");
  const [expandedSubmissionId, setExpandedSubmissionId] = useState("");
  const [flaggingId, setFlaggingId] = useState("");
  const [flaggedIds, setFlaggedIds] = useState(() => new Set());
  const [flagError, setFlagError] = useState("");

  const exportStudentPdf = (row) => {
    const popup = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!popup) return;

    popup.document.write(`
      <html>
        <head>
          <title>Student Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
            p { margin: 6px 0; }
          </style>
        </head>
        <body>
          <h2>Student Report</h2>
          <div class="card">
            <p><strong>Name:</strong> ${row.studentName || "-"}</p>
            <p><strong>Department:</strong> ${row.department || "-"}</p>
            <p><strong>Batch:</strong> ${row.batch || "-"}</p>
            <p><strong>Test:</strong> ${row.testName || "-"}</p>
            <p><strong>Score:</strong> ${Number(row.scorePercent ?? row.accuracy ?? row.score ?? 0).toFixed(1)}%</p>
            <p><strong>Marks:</strong> ${Number(row.obtainedMarks ?? 0).toFixed(2)} / ${Number(row.totalMarks ?? 0).toFixed(2)}</p>
            <p><strong>Time Taken:</strong> ${Math.floor(Number(row.timeTaken || 0) / 60)}m</p>
            <p><strong>Status:</strong> ${row.status || "INCOMPLETE"}</p>
          </div>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  useEffect(() => {
    setSearchDraft(table.search || "");
  }, [table.search]);

  useEffect(() => {
    const timer = setTimeout(() => onSearchChange(searchDraft), 350);
    return () => clearTimeout(timer);
  }, [searchDraft, onSearchChange]);

  const handleFlagForReview = async (row) => {
    const submissionId = row.submissionId || row.id;
    const firstViolation = Array.isArray(row.violations) ? row.violations[0] : null;
    const testId = firstViolation?.testId || row.testId;
    const anomalyId = firstViolation?.anomalyId || firstViolation?.id || `manual-${submissionId}`;
    const anomalyType = firstViolation?.anomalyType || firstViolation?.type || "MANUAL_REVIEW";

    if (!testId || !submissionId) {
      setFlagError("Unable to flag this row because report metadata is incomplete.");
      return;
    }

    setFlagError("");
    setFlaggingId(submissionId);
    try {
      await adminApi.reviewReportAnomaly({
        testId,
        anomalyId,
        anomalyType,
        action: "ESCALATE",
        reason: `Flagged from detailed report table for ${row.studentName || "student"}.`,
      });
      setFlaggedIds((prev) => new Set([...prev, submissionId]));
    } catch (_error) {
      setFlagError("Unable to flag this row for review. Please try again.");
    } finally {
      setFlaggingId("");
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-text-primary">Detailed Results</h2>
        <input
          type="text"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search table..."
          className="h-9 w-full max-w-sm rounded-lg border border-border bg-background px-3 text-sm"
        />
      </div>

      <div className="max-h-130 overflow-auto rounded-xl border border-border">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
                  <button type="button" className="font-semibold text-text-secondary hover:text-text-primary" onClick={() => onSort(column.key)}>
                    {column.label}
                    {table.sortBy === column.key ? (table.sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-text-secondary">
                  Loading table...
                </td>
              </tr>
            ) : null}

            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-text-secondary">
                  No Data Found
                </td>
              </tr>
            ) : null}

            {!loading
              ? rows.map((row) => {
                  const submissionId = row.submissionId || row.id;
                  const violations = Array.isArray(row.violations) ? row.violations : [];
                  const violationCount = Number(row.violationCount || violations.length || 0);
                  const isExpanded = expandedSubmissionId === submissionId;
                  const scorePercent = Number(row.scorePercent ?? row.accuracy ?? row.score ?? 0);
                  const obtainedMarks = Number(row.obtainedMarks ?? 0);
                  const totalMarks = Number(row.totalMarks ?? 0);
                  const isFlagging = flaggingId === submissionId;
                  const isFlagged = flaggedIds.has(submissionId);

                  return (
                    <Fragment key={row.id}>
                      <tr className="border-b border-border/60 hover:bg-background/40">
                        <td className="px-3 py-2 font-medium text-text-primary">{row.studentName}</td>
                        <td className="px-3 py-2">{row.department}</td>
                        <td className="px-3 py-2">{row.batch}</td>
                        <td className="px-3 py-2">{row.testName}</td>
                        <td className={`px-3 py-2 font-semibold ${scorePercent >= 75 ? "text-success" : scorePercent < 40 ? "text-danger" : "text-warning"}`}>
                          {scorePercent.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2">
                          {totalMarks > 0 ? `${obtainedMarks.toFixed(2)} / ${totalMarks.toFixed(2)}` : obtainedMarks.toFixed(2)}
                        </td>
                        <td className="px-3 py-2">{Math.floor(Number(row.timeTaken || 0) / 60)}m</td>
                        <td className="px-3 py-2">{row.attemptCount || 0}</td>
                        <td className={`px-3 py-2 font-semibold ${statusTone(row.status)}`}>{row.status || "INCOMPLETE"}</td>
                        <td className="px-3 py-2">
                          {violationCount > 0 ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/15"
                              onClick={() => setExpandedSubmissionId((prev) => (prev === submissionId ? "" : submissionId))}
                            >
                              MALPRACTICE ({violationCount})
                            </button>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">Clean</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                              onClick={() => onSelectStudent(row.studentId)}
                            >
                              View Details
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                              onClick={() => exportStudentPdf(row)}
                            >
                              Download PDF
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isFlagging || isFlagged}
                              onClick={() => handleFlagForReview(row)}
                            >
                              {isFlagging ? "Flagging..." : isFlagged ? "Flagged" : "Flag"}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr className="border-b border-border/60 bg-danger/5">
                          <td colSpan={11} className="px-3 py-3">
                            <div className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2">
                              <p className="text-xs font-semibold text-danger">Violation Details</p>
                              <div className="mt-1 space-y-1 text-xs text-text-secondary">
                                {violations.map((violation) => (
                                  <p key={violation.id}>
                                    {violation.type} • {new Date(violation.createdAt).toLocaleString()}
                                  </p>
                                ))}
                                {violations.length === 0 ? <p>No violation detail available.</p> : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              : null}
          </tbody>
        </table>
      </div>

      {flagError ? <p className="mt-2 text-xs text-danger">{flagError}</p> : null}

      <div className="mt-3 flex items-center justify-between text-sm text-text-secondary">
        <p>
          Page {pagination?.page || 1} of {pagination?.totalPages || 1}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
            disabled={(pagination?.page || 1) <= 1}
            onClick={() => onPageChange(Math.max((pagination?.page || 1) - 1, 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
            disabled={(pagination?.page || 1) >= (pagination?.totalPages || 1)}
            onClick={() => onPageChange((pagination?.page || 1) + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
