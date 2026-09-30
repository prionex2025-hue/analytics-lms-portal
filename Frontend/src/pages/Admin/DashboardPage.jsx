import { Fragment, useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, XAxis, YAxis, BarChart, Bar } from "recharts";
import { BarChart3, CalendarClock, ChevronDown, FileCheck2, PlayCircle, RefreshCw, ShieldAlert, Users } from "lucide-react";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionCard, StatTile, StatusBadge } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminApi } from "@/services/api";
import { connectTestSocket } from "@/services/testSocket";

const lineConfig = {
  count: {
    label: "Participation",
    color: "var(--chart-5)",
  },
};

const barConfig = {
  averageScore: {
    label: "Avg Score",
    color: "var(--chart-1)",
  },
};

function mapStatusTone(status) {
  const normalized = String(status || "pending").toLowerCase();
  if (normalized === "auto_submitted" || normalized === "submitted") {
    return "success";
  }
  if (normalized === "ended") {
    return "danger";
  }
  if (normalized === "active") {
    return "info";
  }
  return "neutral";
}

const AXIS_TICK = { fontSize: 12, fill: "var(--text-secondary)" };

function ChartBody({ loading, empty, children }) {
  if (loading) return <SkeletonBlock className="h-64 rounded-lg sm:h-72" />;
  if (empty) {
    return <EmptyState icon={BarChart3} title="No data yet" description="This chart fills in as students take tests." className="h-64 border-0 py-6 sm:h-72" />;
  }
  return children;
}

export default function AdminDashboardPage() {
  const [expandedSubmissionId, setExpandedSubmissionId] = useState("");
  const admin = useAdminAuthState()?.admin;
  const adminCollegeId = admin?.collegeId;

  const {
    data,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: adminApi.getDashboard,
    staleTime: 300000,
  });

  useEffect(() => {
    const socket = connectTestSocket("admin");
    const refreshDashboard = () => {
      refetch();
    };

    socket.on("test_status_change", refreshDashboard);

    return () => {
      socket.off("test_status_change", refreshDashboard);
    };
  }, [refetch]);

  const cards = data?.cards || {};
  const trend = data?.charts?.testParticipationTrend || [];
  const avgScore = data?.charts?.averageScorePerTest?.slice(0, 8) || [];

  // Filter submissions to only include those from the admin's college
  const submissions = useMemo(() => {
    const allSubmissions = data?.recentSubmissions || [];
    if (!adminCollegeId) return [];
    return allSubmissions.filter((submission) => submission.collegeId === adminCollegeId);
  }, [adminCollegeId, data?.recentSubmissions]);

  const firstName = admin?.fullName?.split(" ")?.[0] || "Admin";
  const initialLoading = isLoading && !data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={`${admin?.college?.name ? `${admin.college.name} · ` : ""}Tests, participation, and recent submissions at a glance.`}
        actions={
          <Button variant="outline" className="h-10 rounded-lg px-4" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={cn("size-4", isLoading ? "animate-spin motion-reduce:animate-none" : "")} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[
          { icon: Users, label: "Total Students", value: cards.totalStudents || 0 },
          { icon: FileCheck2, label: "Total Tests Created", value: cards.totalTestsCreated || 0 },
          { icon: PlayCircle, label: "Active Tests", value: cards.activeTests || 0, tone: "success" },
          { icon: CalendarClock, label: "Upcoming Tests", value: cards.upcomingTests || 0, tone: "neutral" },
        ].map((item) =>
          initialLoading ? (
            <SkeletonBlock key={item.label} className="h-[88px]" />
          ) : (
            <StatTile key={item.label} icon={item.icon} label={item.label} value={Number(item.value).toLocaleString()} tone={item.tone || "primary"} />
          )
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Exam participation" description="Submissions per month.">
          <ChartBody loading={initialLoading} empty={trend.length === 0}>
            <ChartContainer config={lineConfig} className="h-64 w-full sm:h-72">
              <LineChart data={trend} margin={{ left: -12, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </ChartBody>
        </SectionCard>

        <SectionCard title="Average score per test" description="Most recent tests (up to 8).">
          <ChartBody loading={initialLoading} empty={avgScore.length === 0}>
            <ChartContainer config={barConfig} className="h-64 w-full sm:h-72">
              <BarChart data={avgScore} margin={{ left: -12, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="testName"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tickFormatter={(value) => (String(value).length > 12 ? `${String(value).slice(0, 11)}…` : value)}
                />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="averageScore" fill="var(--color-averageScore)" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ChartContainer>
          </ChartBody>
        </SectionCard>
      </div>

      <SectionCard flush title="Recent exam submissions" description="Latest submissions from your college. Expand a malpractice flag to see its violations.">
        {initialLoading ? (
          <div className="space-y-2 p-4 sm:p-5" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : submissions.length === 0 ? (
          <EmptyState icon={FileCheck2} title="No submissions yet" description="Submissions appear here as students complete tests." className="border-0" />
        ) : (
          <div className="relative overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-5 text-xs font-medium tracking-wide uppercase">Student</TableHead>
                  <TableHead className="text-xs font-medium tracking-wide uppercase">Exam</TableHead>
                  <TableHead className="text-xs font-medium tracking-wide uppercase">Status</TableHead>
                  <TableHead className="text-xs font-medium tracking-wide uppercase">Malpractice</TableHead>
                  <TableHead className="text-right text-xs font-medium tracking-wide uppercase">Score</TableHead>
                  <TableHead className="pr-5 text-right text-xs font-medium tracking-wide uppercase">Accuracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((item) => {
                  const status = item.status || "pending";
                  const violationCount = Number(item?._count?.violations || item?.violations?.length || 0);
                  const isExpanded = expandedSubmissionId === item.id;
                  return (
                    <Fragment key={item.id}>
                      <TableRow className="h-14">
                        <TableCell className="pl-5">
                          <div className="font-medium text-text-primary">{item.user?.fullName || "-"}</div>
                          <div className="text-xs text-text-secondary">{item.user?.studentId || "-"}</div>
                        </TableCell>
                        <TableCell className="max-w-64 truncate">{item.test?.title || "-"}</TableCell>
                        <TableCell>
                          <StatusBadge tone={mapStatusTone(status)} className="capitalize">{String(status).replace(/_/g, " ").toLowerCase()}</StatusBadge>
                        </TableCell>
                        <TableCell>
                          {violationCount > 0 ? (
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              className="inline-flex h-7 items-center gap-1 rounded-full bg-danger/10 px-2.5 text-xs font-medium text-danger ring-1 ring-danger/25 outline-none ring-inset hover:bg-danger/15 focus-visible:ring-3 focus-visible:ring-ring/50"
                              onClick={() => setExpandedSubmissionId((prev) => (prev === item.id ? "" : item.id))}
                            >
                              <ShieldAlert className="size-3.5" aria-hidden="true" />
                              MALPRACTICE ({violationCount})
                              <ChevronDown className={cn("size-3.5 transition-transform", isExpanded ? "rotate-180" : "")} aria-hidden="true" />
                            </button>
                          ) : (
                            <StatusBadge tone="success">Clean</StatusBadge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{item.score ?? "-"}</TableCell>
                        <TableCell className="pr-5 text-right tabular-nums">{item.accuracy != null ? `${item.accuracy}%` : "-"}</TableCell>
                      </TableRow>

                      {isExpanded ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={6} className="px-5">
                            <div className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2.5">
                              <p className="text-xs font-semibold text-danger">Violation details</p>
                              <ul className="mt-1 space-y-1 text-xs text-text-secondary">
                                {(item.violations || []).map((violation) => (
                                  <li key={violation.id}>
                                    {violation.type} • {new Date(violation.createdAt).toLocaleString()}
                                  </li>
                                ))}
                                {(item.violations || []).length === 0 ? <li>No violation detail available.</li> : null}
                              </ul>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
