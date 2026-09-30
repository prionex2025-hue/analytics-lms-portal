import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const toPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.min(100, num));
};

export function ReportsLineChart({ data = [] }) {
  const normalized = Array.isArray(data)
    ? data.map((item, index) => ({
        label:
          item?.label ||
          item?.testName ||
          item?.test_name ||
          item?.test ||
          item?.test_date ||
          item?.date ||
          `Test ${index + 1}`,
        value: toPercent(
          item?.value ??
            item?.percentage ??
            item?.accuracy ??
            item?.score_percent ??
            item?.scorePercentage ??
            item?.scorePercent ??
            item?.score
        ),
        sortKey:
          item?.submittedAt ||
          item?.submitted_at ||
          item?.test_date ||
          item?.date ||
          item?.createdAt ||
          item?.created_at ||
          "",
      }))
        .sort((a, b) => {
          const aTime = a.sortKey ? new Date(a.sortKey).getTime() : Number.NaN;
          const bTime = b.sortKey ? new Date(b.sortKey).getTime() : Number.NaN;

          if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
            return aTime - bTime;
          }
          if (Number.isFinite(aTime)) {
            return -1;
          }
          if (Number.isFinite(bTime)) {
            return 1;
          }
          return 0;
        })
        .map(({ sortKey: _sortKey, ...item }) => item)
    : [];

  if (normalized.length === 0) {
    return (
      <Card className="gap-0 py-0 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
        <Empty className="min-h-64 border border-dashed border-border">
          <EmptyHeader>
            <EmptyTitle>No Progress Data</EmptyTitle>
            <EmptyDescription>Take tests to see your score trend over time.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  if (normalized.length === 1) {
    return (
      <Card className="gap-0 py-0 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
        <div><h3 className="text-base font-semibold text-text-primary">Score trend</h3><p className="mt-0.5 text-sm text-text-secondary">Percentage score across your submitted tests.</p></div>
        <div className="mt-4 flex h-60 items-center justify-center rounded-lg bg-muted/50">
          <div className="text-center">
            <p className="text-xs text-text-secondary">Only one test available</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{normalized[0].value}%</p>
            <p className="mt-1 text-sm text-text-secondary">{normalized[0].label}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 gap-0 py-0 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
      <div><h3 className="text-base font-semibold text-text-primary">Score trend</h3><p className="mt-0.5 text-sm text-text-secondary">Percentage score across your submitted tests.</p></div>
      <div className="mt-4 h-64 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
          <LineChart data={normalized} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "var(--text-secondary)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", fontSize: 12 }} formatter={(value) => [`${value}%`, "Score"]} />
            <Line dataKey="value" type="monotone" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3, fill: "var(--primary)" }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
