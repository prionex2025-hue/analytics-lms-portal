import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { CartesianGrid, Line, LineChart, XAxis, YAxis, BarChart, Bar } from "recharts";
import { fetchSuperAdminDashboard, fetchSuperAdminHealth } from "@/features/SuperAdmin/superAdminDashboardSlice";
import { Activity, BarChart3, FileCheck2, RefreshCw, School, ShieldUser, UserCheck, Users } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { Callout, EmptyState, PageHeader, SectionCard, StatTile, StatusBadge } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";

const HEALTH_TONE = { ok: "success", degraded: "warning", down: "danger", disabled: "neutral" };
const HEALTH_DOT = { ok: "bg-success", degraded: "bg-warning", down: "bg-danger", disabled: "bg-pending" };
const HEALTH_LABEL = { ok: "Operational", degraded: "Degraded", down: "Down", disabled: "Disabled" };

const AXIS_TICK = { fontSize: 12, fill: "var(--text-secondary)" };

function ChartBody({ loading, empty, children }) {
  if (loading) return <SkeletonBlock className="h-64 rounded-lg sm:h-72" />;
  if (empty) {
    return <EmptyState icon={BarChart3} title="No data yet" description="This chart fills in as activity is recorded." className="h-64 border-0 py-6 sm:h-72" />;
  }
  return children;
}

const shortDay = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString([], { month: "short", day: "numeric" }) : String(value ?? "");
};

export default function SuperAdminDashboardPage() {
  const dispatch = useDispatch();
  const { data, loading, health, healthError } = useSelector((state) => state.superAdminDashboard);
  const superAdmin = useSelector((state) => state.superAdminAuth.superAdmin);

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

  const firstName = superAdmin?.fullName?.split(" ")?.[0] || "Super Admin";
  const initialLoading = loading && !data;
  const degradedCount = healthCards.filter((item) => item.status !== "ok").length;
  const overallHealth = healthError ? "down" : degradedCount === 0 ? "ok" : "degraded";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Platform-wide overview of colleges, people, tests, and system health."
        actions={
          <Button
            variant="outline"
            className="h-10 rounded-lg px-4"
            onClick={() => {
              dispatch(fetchSuperAdminDashboard());
              dispatch(fetchSuperAdminHealth());
            }}
            disabled={loading}
          >
            <RefreshCw className={cn("size-4", loading ? "animate-spin motion-reduce:animate-none" : "")} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {[
          { icon: School, label: "Total Colleges", value: cards.totalColleges || 0 },
          { icon: ShieldUser, label: "Total Admins", value: cards.totalAdmins || 0 },
          { icon: Users, label: "Total Students", value: cards.totalStudents || 0 },
          { icon: FileCheck2, label: "Total Tests", value: cards.totalTests || 0 },
          { icon: UserCheck, label: "Active Users", value: cards.activeUsers || 0, tone: "success" },
        ].map((item) =>
          initialLoading ? (
            <SkeletonBlock key={item.label} className="h-[88px]" />
          ) : (
            <StatTile
              key={item.label}
              icon={item.icon}
              label={item.label}
              value={Number(item.value).toLocaleString()}
              tone={item.tone || "primary"}
              className={item.label === "Active Users" ? "col-span-2 lg:col-span-1" : ""}
            />
          )
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Daily active users" description="Unique users signing in each day.">
          <ChartBody loading={initialLoading} empty={daily.length === 0}>
            <ChartContainer config={{ users: { label: "Users", color: "var(--chart-1)" } }} className="h-64 w-full sm:h-72">
              <LineChart data={daily} margin={{ left: -12, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="users" stroke="var(--color-users)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </ChartBody>
        </SectionCard>

        <SectionCard title="Test participation" description="Test submissions per day across all colleges.">
          <ChartBody loading={initialLoading} empty={participation.length === 0}>
            <ChartContainer config={{ count: { label: "Submissions", color: "var(--chart-5)" } }} className="h-64 w-full sm:h-72">
              <LineChart data={participation} margin={{ left: -12, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </ChartBody>
        </SectionCard>
      </div>

      <SectionCard title="College-wise performance" description="Average score per college.">
        <ChartBody loading={initialLoading} empty={performance.length === 0}>
          <ChartContainer config={{ avgScore: { label: "Avg Score", color: "var(--chart-1)" } }} className="h-64 w-full sm:h-72">
            <BarChart data={performance} margin={{ left: -12, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="collegeName" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} tickFormatter={(value) => (String(value).length > 14 ? `${String(value).slice(0, 13)}…` : value)} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="avgScore" fill="var(--color-avgScore)" radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ChartContainer>
        </ChartBody>
      </SectionCard>

      <SectionCard
        title="System health"
        description={`Last checked: ${health?.checked_at ? new Date(health.checked_at).toLocaleString() : "—"} · refreshes every minute`}
        actions={
          <StatusBadge tone={HEALTH_TONE[overallHealth]} icon={Activity}>
            {overallHealth === "ok" ? "All systems operational" : overallHealth === "down" ? "Health check unavailable" : `${degradedCount} need attention`}
          </StatusBadge>
        }
      >
        {healthError ? (
          <Callout tone="warning" className="mb-4">
            Health check unavailable. This may indicate a server connectivity issue.
          </Callout>
        ) : null}
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {healthCards.map((item) => (
            <li key={item.label} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", HEALTH_DOT[item.status] || HEALTH_DOT.down)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text-primary">{item.label}</p>
                  <StatusBadge tone={HEALTH_TONE[item.status] || "danger"}>{HEALTH_LABEL[item.status] || item.status}</StatusBadge>
                </div>
                <p className="mt-0.5 text-xs text-text-secondary">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
