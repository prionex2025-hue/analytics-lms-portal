import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";

const toPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.min(100, num));
};

export function ReportsRadarChart({ data = [] }) {
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
            <EmptyTitle>No Topic Performance Data</EmptyTitle>
            <EmptyDescription>Topic-level analysis will appear once enough data is available.</EmptyDescription>
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
          <RadarChart data={normalized}>
            <PolarGrid />
            <PolarAngleAxis dataKey="topic" tick={{ fontSize: 11 }} />
            <Radar dataKey="value" stroke="var(--primary-dark)" fill="var(--primary-dark)" fillOpacity={0.3} />
            <Tooltip formatter={(value) => [`${value}%`, "Score"]} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
