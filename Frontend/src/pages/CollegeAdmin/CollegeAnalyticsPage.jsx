import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { Building2, FileCheck2, GraduationCap, ShieldUser, TrendingUp, Trophy, Users } from "lucide-react";
import { adminApi } from "@/services/api";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { EmptyState, ErrorState, PageHeader, SectionCard, StatTile } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";

const statCards = [
  { key: "totalStudents", label: "Students", icon: Users },
  { key: "totalAdmins", label: "Admins", icon: ShieldUser },
  { key: "totalDepartments", label: "Departments", icon: Building2 },
  { key: "totalTests", label: "Tests", icon: FileCheck2 },
  { key: "totalSubmissions", label: "Submissions", icon: TrendingUp },
];

const AXIS_TICK = { fontSize: 12, fill: "var(--text-secondary)" };
const trendConfig = {
  averageScore: { label: "Avg score %", color: "var(--chart-1)" },
  submissions: { label: "Submissions", color: "var(--chart-5)" },
};

const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function PercentBar({ value, tone = "bg-primary" }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${clamp(value)}%` }} />
      </div>
      <span className="w-12 text-right tabular-nums">{value}%</span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <SkeletonBlock key={index} className="h-10 rounded-lg" />
      ))}
    </div>
  );
}

export default function CollegeAnalyticsPage() {
  const isCollegeScope = useLocation().pathname.startsWith("/college-admin");
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["college-admin-analytics"],
    queryFn: adminApi.getCollegeAnalytics,
    staleTime: 120000,
  });

  const departmentPerformance = data?.departmentPerformance || [];
  const readiness = data?.placementReadiness || [];
  const topPerformers = data?.topPerformers || [];
  const participation = data?.testParticipation || [];
  const trend = data?.scoreTrend || [];

  const overviewCards = useMemo(
    () => {
      const overview = data?.overview || {};
      return statCards.map((card) => ({
        ...card,
        value: Number(overview?.[card.key] || 0),
      }));
    },
    [data?.overview]
  );

  const readinessTotal = Math.max(1, readiness.reduce((sum, item) => sum + (Number(item.count) || 0), 0));
  const maxParticipants = Math.max(1, ...participation.map((item) => Number(item.participants) || 0));

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description={`Department performance, placement readiness, and participation across your ${isCollegeScope ? "college" : "department"}.`} />

      {isError ? (
        <ErrorState title="Unable to load analytics" description={error?.message || "Please try again."} onRetry={() => refetch()} />
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {overviewCards.map((item, index) =>
          isLoading ? (
            <SkeletonBlock key={item.key} className="h-[88px]" />
          ) : (
            <StatTile
              key={item.key}
              icon={item.icon}
              label={item.label}
              value={item.value.toLocaleString()}
              tone={index === 0 ? "primary" : "neutral"}
              className={index === overviewCards.length - 1 ? "col-span-2 lg:col-span-1" : ""}
            />
          )
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <SectionCard flush title="Department performance" description="Average score, pass rate, and participation per department.">
          {isLoading ? (
            <div className="p-4"><ListSkeleton /></div>
          ) : departmentPerformance.length === 0 ? (
            <EmptyState icon={Building2} title="No department analytics available" description="Results appear after students submit tests." className="border-0" />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium tracking-wide text-text-secondary uppercase">
                    <th className="h-10 px-4 first:pl-5">Department</th>
                    <th className="h-10 px-4">Avg score</th>
                    <th className="h-10 px-4">Pass rate</th>
                    <th className="h-10 px-4 text-right last:pr-5">Participants</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {departmentPerformance.map((item) => (
                    <tr key={`${item.departmentId || item.departmentName}`} className="hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium text-text-primary first:pl-5">{item.departmentName}</td>
                      <td className="px-4 py-3"><PercentBar value={item.avgScore} /></td>
                      <td className="px-4 py-3"><PercentBar value={item.passRate} tone="bg-success" /></td>
                      <td className="px-4 py-3 text-right tabular-nums last:pr-5">{item.participants}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Placement readiness" description="Students grouped by readiness band.">
          {isLoading ? (
            <ListSkeleton />
          ) : readiness.length === 0 ? (
            <EmptyState icon={GraduationCap} title="No readiness snapshot yet" description="Bands appear once enough results are available." className="border-0 py-8" />
          ) : (
            <ul className="space-y-4">
              {readiness.map((item) => {
                const share = Math.round(((Number(item.count) || 0) / readinessTotal) * 100);
                return (
                  <li key={item.band}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium text-text-primary">{item.band}</span>
                      <span className="tabular-nums text-text-secondary">
                        <span className="font-semibold text-text-primary">{item.count}</span> students · {share}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, share)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Top performers" description={`Highest average scores in your ${isCollegeScope ? "college" : "department"}.`}>
          {isLoading ? (
            <ListSkeleton />
          ) : topPerformers.length === 0 ? (
            <EmptyState icon={Trophy} title="No submissions yet" description="Top students appear after tests are submitted." className="border-0 py-8" />
          ) : (
            <ol className="divide-y divide-border">
              {topPerformers.map((item, index) => (
                <li key={item.studentId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
                      index === 0 ? "bg-amber-100 text-amber-700" : "bg-muted text-text-secondary"
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{item.fullName}</p>
                    <p className="truncate text-xs text-text-secondary">{item.departmentName} · {item.attempts} attempts</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-text-primary">{item.averageScore}%</span>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>

        <SectionCard title="Test participation" description="Participants and average score per test.">
          {isLoading ? (
            <ListSkeleton />
          ) : participation.length === 0 ? (
            <EmptyState icon={FileCheck2} title="No participation data yet" description="Tests appear here once students attempt them." className="border-0 py-8" />
          ) : (
            <ul className="space-y-3">
              {participation.map((item) => (
                <li key={item.testId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium text-text-primary">{item.title}</p>
                    <p className="shrink-0 text-xs tabular-nums text-text-secondary">
                      <span className="font-semibold text-text-primary">{item.participants}</span> participants · avg {item.averageScore}%
                    </p>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className="h-full rounded-full bg-chart-5" style={{ width: `${Math.max(3, ((Number(item.participants) || 0) / maxParticipants) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Score trend" description="Monthly average score (line) and submission volume (bars).">
        {isLoading ? (
          <SkeletonBlock className="h-72 rounded-lg" />
        ) : trend.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No historical submissions yet" description="The trend fills in month by month." className="border-0 py-10" />
        ) : (
          <ChartContainer config={trendConfig} className="h-72 w-full">
            <ComposedChart data={trend} margin={{ left: -12, right: 0, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis yAxisId="score" domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis yAxisId="count" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar yAxisId="count" dataKey="submissions" fill="var(--color-submissions)" fillOpacity={0.35} radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Line yAxisId="score" type="monotone" dataKey="averageScore" stroke="var(--color-averageScore)" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ChartContainer>
        )}
      </SectionCard>
    </div>
  );
}
