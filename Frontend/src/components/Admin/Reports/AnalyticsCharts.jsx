import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function ChartWrap({ title, children }) {
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-text-primary">{title}</h3>
      <div className="h-72 min-h-72 w-full min-w-0">{children}</div>
    </article>
  );
}

export default function AnalyticsCharts({ charts, loading }) {
  if (loading) {
    return <div className="rounded-2xl border border-border bg-card p-4 text-sm text-text-secondary">Loading chart analytics...</div>;
  }

  const distribution = charts?.scoreDistribution || [];
  const trend = charts?.performanceTrend || [];
  const department = charts?.departmentPerformance || [];
  const topPerformers = charts?.topPerformers || [];
  const trendByTest = trend.map((item, index) => ({
    ...item,
    testLabel: item.testTitle || item.testName || item.title || item.date || `Test ${index + 1}`,
  }));

  return (
    <section className="min-w-0 grid gap-4 lg:grid-cols-2">
      <ChartWrap title="Score Distribution">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={distribution}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="range" axisLine={false} tickLine={false} />
            <YAxis axisLine={false} tickLine={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="count" name="Students" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="Score Performance Trend">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={trendByTest}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="testLabel" axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} axisLine={false} tickLine={false} />
            <Tooltip />
            <Legend />
            <Line type="linear" dataKey="averageScore" name="Avg Score" stroke="var(--chart-2)" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="Department-wise Performance">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={department} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="department" axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} axisLine={false} tickLine={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="avgScore" name="Avg Score" radius={[6, 6, 0, 0]}>
              {department.map((entry, index) => (
                <Cell key={entry.department} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="Top Performers (Top 10)">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={topPerformers} layout="vertical" margin={{ left: 16, right: 12 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} />
            <YAxis dataKey="studentName" type="category" width={120} axisLine={false} tickLine={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="score" name="Score" fill="var(--chart-3)" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartWrap>
    </section>
  );
}
