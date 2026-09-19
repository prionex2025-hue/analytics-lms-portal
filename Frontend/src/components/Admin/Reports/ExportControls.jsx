const toCsv = (rows) => {
  if (!rows.length) return "";
  const normalizedRows = rows.map((row) => ({
    studentName: row.studentName || "-",
    department: row.department || "-",
    batch: row.batch || "-",
    testName: row.testName || "-",
    scorePercent: Number(row.scorePercent ?? row.accuracy ?? row.score ?? 0).toFixed(1),
    obtainedMarks: Number(row.obtainedMarks ?? 0).toFixed(2),
    totalMarks: Number(row.totalMarks ?? 0).toFixed(2),
    timeTakenSeconds: Number(row.timeTaken || 0),
    status: row.status || "-",
    violationCount: Number(row.violationCount || 0),
  }));
  const headers = Object.keys(normalizedRows[0]);
  const lines = [headers.join(",")].concat(normalizedRows.map((row) => headers.map((key) => JSON.stringify(row[key] ?? "")).join(",")));
  return lines.join("\n");
};

export default function ExportControls({ rows, summary, filters, disabled }) {
  const exportCsv = () => {
    if (!rows?.length) return;
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `admin-report-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const popup = window.open("", "_blank", "noopener,noreferrer,width=1200,height=800");
    if (!popup) return;

    const rowsHtml = (rows || [])
      .map(
        (row) =>
          `<tr><td>${row.studentName || "-"}</td><td>${row.department || "-"}</td><td>${row.batch || "-"}</td><td>${row.testName || "-"}</td><td>${Number(row.scorePercent ?? row.accuracy ?? row.score ?? 0).toFixed(1)}%</td><td>${Number(row.obtainedMarks ?? 0).toFixed(2)} / ${Number(row.totalMarks ?? 0).toFixed(2)}</td></tr>`
      )
      .join("");

    popup.document.write(`
      <html>
        <head>
          <title>Admin Report Export</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; text-align: left; }
            th { background: #f5f5f5; }
          </style>
        </head>
        <body>
          <h2>Reports & Analytics</h2>
          <p>Filters: ${JSON.stringify(filters || {})}</p>
          <p>Summary: ${JSON.stringify(summary || {})}</p>
          <table>
            <thead>
              <tr><th>Student</th><th>Department</th><th>Batch</th><th>Test</th><th>Score %</th><th>Marks</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={exportCsv}
        disabled={disabled || !rows?.length}
        className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        Export CSV
      </button>
      <button
        type="button"
        onClick={exportPdf}
        disabled={disabled || !rows?.length}
        className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        Export PDF
      </button>
    </div>
  );
}
