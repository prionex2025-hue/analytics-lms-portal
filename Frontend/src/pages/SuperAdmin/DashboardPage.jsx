import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { CartesianGrid, Line, LineChart, XAxis, YAxis, BarChart, Bar } from "recharts";
import { fetchSuperAdminDashboard, fetchSuperAdminHealth } from "@/features/SuperAdmin/superAdminDashboardSlice";
import StatCard from "@/components/common/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const healthTone = {
  ok: "text-success bg-success/10 border-success/30",
  degraded: "text-warning bg-warning/10 border-warning/30",
  down: "text-danger bg-danger/10 border-danger/30",
  disabled: "text-text-secondary bg-muted border-border",
};

export default function SuperAdminDashboardPage() {
  const dispatch = useDispatch();
  const { data, loading, health, healthError } = useSelector((state) => state.superAdminDashboard);

  useEffect(() => {
    dispatch(fetchSuperAdminDashboard());
    dispatch(fetchSuperAdminHealth());

    // Poll health every 60s — frequent enough for monitoring,
    // light enough to avoid unnecessary server load.
    const timer = setInterval(() => {
      dispatch(fetchSuperAdminHealth());
    }, 60_000);

    return () => clearInterval(timer);
  }, [dispatch]);

  const cards = data?.cards || {};
  const daily = data?.charts?.dailyActiveUsers || [];
  const participation = data?.charts?.testParticipationTrend || [];
  const performance = data?.charts?.collegeWisePerformance || [];
  const healthCards = [
    {
      label: "MongoDB",
      status: health?.mongodb?.status || "down",
      detail: `Avg ${health?.mongodb?.avg_response_ms ?? "-"} ms`,
    },
    {
      label: "Redis",
      status: health?.redis?.status || "down",
      detail: health?.redis?.configured === false
        ? "Not configured"
        : `Hit rate ${(Number(health?.redis?.hit_rate || 0) * 100).toFixed(0)}%`,
    },
    {
      label: "Job Queue",
      status: health?.job_queue?.status || "down",
      detail: `Pending ${health?.job_queue?.pending || 0}, Failed/hr ${health?.job_queue?.failed_last_hour || 0}`,
    },
    {
      label: "Socket",
      status: "ok",
      detail: `Clients ${health?.socket_server?.connected_clients || 0}`,
    },
    {
      label: "Storage",
      status: "ok",
      detail: `${health?.storage?.percent_used || 0}% used`,
    },
    {
      label: "API",
      status: Number(health?.api?.error_rate_percent || 0) > 1 ? "degraded" : "ok",
      detail: `${health?.api?.requests_per_minute || 0} rpm, ${health?.api?.avg_response_ms || 0} ms avg`,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="-mx-1 overflow-x-auto pb-1 sm:mx-0">
        <div className="grid min-w-[620px] grid-cols-5 gap-3 px-1 sm:min-w-0 sm:gap-4 sm:px-0">
          <StatCard title="Total Colleges" value={cards.totalColleges || 0} />
          <StatCard title="Total Admins" value={cards.totalAdmins || 0} />
          <StatCard title="Total Students" value={cards.totalStudents || 0} />
          <StatCard title="Total Tests" value={cards.totalTests || 0} />
          <StatCard title="Active Users" value={cards.activeUsers || 0} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0 rounded-2xl">
          <CardHeader><CardTitle>Daily Active Users</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={{ users: { label: "Users", color: "var(--warning)" } }} className="h-64 w-full sm:h-72">
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" hide />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="users" stroke="var(--color-users)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="min-w-0 rounded-2xl">
          <CardHeader><CardTitle>Test Participation Trends</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={{ count: { label: "Count", color: "var(--warning)" } }} className="h-64 w-full sm:h-72">
              <LineChart data={participation}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" hide />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 rounded-2xl">
        <CardHeader><CardTitle>College-wise Performance</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-text-secondary">Loading dashboard...</p> : null}
          <ChartContainer config={{ avgScore: { label: "Avg Score", color: "var(--warning)" } }} className="h-64 w-full sm:h-72">
            <BarChart data={performance}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="collegeName" hide />
              <YAxis />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="avgScore" fill="var(--color-avgScore)" radius={8} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>System Health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {healthError ? <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">Health check unavailable. This may indicate a server connectivity issue.</p> : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {healthCards.map((item) => (
              <div key={item.label} className="rounded-xl border border-border px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-sm font-semibold text-text-primary">{item.label}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${healthTone[item.status] || healthTone.down}`}>
                    {item.status}
                  </span>
                </div>
                <p className="text-xs text-text-secondary">{item.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-secondary">Last checked: {health?.checked_at ? new Date(health.checked_at).toLocaleString() : "-"}</p>
        </CardContent>
      </Card>

    </div>
  );
}
