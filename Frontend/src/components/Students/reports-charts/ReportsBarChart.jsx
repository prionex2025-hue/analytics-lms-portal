import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const toPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.min(100, num));
};

export function ReportsBarChart({ data = [] }) {
  const normalized = Array.isArray(data)
    ? data.map((item) => ({
        topic: item?.topic || item?.metric || "Topic",
        value: toPercent(item?.value ?? item?.score_percent ?? item?.scorePercentage),
      }))
    : [];

  if (normalized.length === 0) {
    return (
      <Card className="gap-0 py-0 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
        <Empty className="min-h-64 border border-dashed border-border">
          <EmptyHeader>
            <EmptyTitle>No Topic Data</EmptyTitle>
            <EmptyDescription>At least one completed test is needed for topic bars.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 gap-0 py-0 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
      <div><h3 className="text-base font-semibold text-text-primary">Topic performance</h3><p className="mt-0.5 text-sm text-text-secondary">Average score by topic.</p></div>
      <div className="mt-4 h-64 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
          <BarChart data={normalized} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
            <XAxis dataKey="topic" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={0} angle={-15} textAnchor="end" height={48} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "var(--text-secondary)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", fontSize: 12 }} formatter={(value) => [`${value}%`, "Score"]} />
            <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
