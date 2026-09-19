import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
      <Card className="p-5">
        <Empty className="border border-border">
          <EmptyHeader>
            <EmptyTitle>No Topic Data</EmptyTitle>
            <EmptyDescription>At least one completed test is needed for topic bars.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 p-5">
      <h3 className="text-base font-semibold text-text-primary">Topic-wise Performance</h3>
      <div className="mt-4 h-64 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={normalized} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <XAxis dataKey="topic" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={48} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => [`${value}%`, "Score"]} />
            <Bar dataKey="value" fill="var(--primary-dark)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
