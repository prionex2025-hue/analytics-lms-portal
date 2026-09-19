import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function StudentDetailModal({ open, onClose, detail, loading }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-border bg-card p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Student Detail View</h3>
            <p className="text-sm text-text-secondary">Full test breakdown and question-wise analysis</p>
          </div>
          <button type="button" className="rounded-md border border-border px-3 py-1 text-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? <p className="text-sm text-text-secondary">Loading student details...</p> : null}

        {!loading && !detail ? <p className="text-sm text-text-secondary">No student data found.</p> : null}

        {!loading && detail ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-3">
              <p className="text-base font-semibold text-text-primary">{detail.student?.name || "Student"}</p>
              <p className="text-sm text-text-secondary">
                {detail.student?.studentId || "-"} • {detail.student?.department || "-"} • {detail.student?.batch || "-"}
              </p>
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-border p-3">
                <h4 className="mb-2 text-sm font-semibold text-text-primary">Accuracy Graph</h4>
                <div className="h-64 min-h-64 min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={detail.accuracyGraph || []}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Line type="monotone" dataKey="accuracy" stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-border p-3">
                <h4 className="mb-2 text-sm font-semibold text-text-primary">Time Spent Per Question</h4>
                <div className="h-64 min-h-64 min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={detail.timePerQuestion || []}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="question" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Bar dataKey="seconds" fill="var(--chart-2)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border p-3">
              <h4 className="mb-2 text-sm font-semibold text-text-primary">Attempt Breakdown</h4>
              <div className="space-y-2">
                {(detail.tests || []).map((item) => (
                  <div key={item.id} className="rounded-lg border border-border/70 bg-background/50 p-3">
                    <p className="text-sm font-semibold text-text-primary">{item.testName}</p>
                    <p className="text-xs text-text-secondary">
                      Score: {Number(item.scorePercent ?? item.accuracy ?? item.score ?? 0).toFixed(1)}% • Marks: {Number(item.obtainedMarks ?? 0).toFixed(2)} / {Number(item.totalMarks ?? 0).toFixed(2)} • Time: {Math.floor(Number(item.timeTaken || 0) / 60)}m
                    </p>
                    <p className="text-xs text-text-secondary">
                      Correct: {item.questionAnalysis?.correct || 0} • Incorrect: {item.questionAnalysis?.incorrect || 0}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
