import { Fragment, useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, XAxis, YAxis, BarChart, Bar } from "recharts";
import StatCard from "@/components/common/StatCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminApi } from "@/services/api";
import { connectTestSocket } from "@/services/testSocket";

const lineConfig = {
  count: {
    label: "Participation",
    color: "var(--success)",
  },
};

const barConfig = {
  averageScore: {
    label: "Avg Score",
    color: "var(--primary)",
  },
};

function mapStatusVariant(status) {
  const normalized = String(status || "pending").toLowerCase();
  if (normalized === "auto_submitted" || normalized === "submitted") {
    return "active";
  }
  if (normalized === "ended") {
    return "ended";
  }
  if (normalized === "active") {
    return "active";
  }
  return "pending";
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

  return (
    <div className="space-y-6">
      <div className="-mx-1 overflow-x-auto pb-1 sm:mx-0">
        <div className="grid min-w-[500px] grid-cols-4 gap-3 px-1 sm:min-w-0 sm:gap-4 sm:px-0">
          <StatCard title="Total Students" value={cards.totalStudents || 0} />
          <StatCard title="Total Tests Created" value={cards.totalTestsCreated || 0} />
          <StatCard title="Active Tests" value={cards.activeTests || 0} />
          <StatCard title="Upcoming Tests" value={cards.upcomingTests || 0} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0 rounded-xl">
          <CardHeader>
            <CardTitle>Exam Participation Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={lineConfig} className="h-64 w-full sm:h-72">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="min-w-0 rounded-xl">
          <CardHeader>
            <CardTitle>Average Score Per Test</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={barConfig} className="h-64 w-full sm:h-72">
              <BarChart data={avgScore}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="testName" hide />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="averageScore" fill="var(--color-averageScore)" radius={8} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 rounded-xl">
        <CardHeader>
          <CardTitle>Recent Exam Submissions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-text-secondary">Loading dashboard...</p> : null}
          {!isLoading && submissions.length === 0 ? <p className="text-sm text-text-secondary">No submissions yet.</p> : null}
          {submissions.length > 0 ? (
            <div className="-mx-2 overflow-x-auto px-2">
              <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Exam</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Malpractice</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Accuracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((item) => {
                  const status = item.status || "pending";
                  const violationCount = Number(item?._count?.violations || item?.violations?.length || 0);
                  const isExpanded = expandedSubmissionId === item.id;
                  return (
                    <Fragment key={item.id}>
                      <TableRow>
                        <TableCell>
                          <div className="font-medium text-text-primary">{item.user?.fullName || "-"}</div>
                          <div className="text-xs text-text-secondary">{item.user?.studentId || "-"}</div>
                        </TableCell>
                        <TableCell>{item.test?.title || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={mapStatusVariant(status)}>{status}</Badge>
                        </TableCell>
                        <TableCell>
                          {violationCount > 0 ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/15"
                              onClick={() => setExpandedSubmissionId((prev) => (prev === item.id ? "" : item.id))}
                            >
                              MALPRACTICE ({violationCount})
                            </button>
                          ) : (
                            <Badge variant="secondary">Clean</Badge>
                          )}
                        </TableCell>
                        <TableCell>{item.score ?? "-"}</TableCell>
                        <TableCell>{item.accuracy != null ? `${item.accuracy}%` : "-"}</TableCell>
                      </TableRow>

                      {isExpanded ? (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <div className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2">
                              <p className="text-xs font-semibold text-danger">Violation Details</p>
                              <div className="mt-1 space-y-1 text-xs text-text-secondary">
                                {(item.violations || []).map((violation) => (
                                  <p key={violation.id}>
                                    {violation.type} • {new Date(violation.createdAt).toLocaleString()}
                                  </p>
                                ))}
                                {(item.violations || []).length === 0 ? <p>No violation detail available.</p> : null}
                              </div>
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
          ) : null}
        </CardContent>
      </Card>


    </div>
  );
}
