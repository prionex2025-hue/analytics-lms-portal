import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const statCards = [
  { key: "totalStudents", label: "Students" },
  { key: "totalAdmins", label: "Admins" },
  { key: "totalDepartments", label: "Departments" },
  { key: "totalTests", label: "Tests" },
  { key: "totalSubmissions", label: "Submissions" },
];

export default function CollegeAnalyticsPage() {
  const { data, isLoading } = useQuery({
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {overviewCards.map((item) => (
          <Card key={item.key} className="rounded-2xl border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-text-secondary">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-text-primary">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border-border">
          <CardHeader><CardTitle>Department Performance</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? <p className="text-sm text-text-secondary">Loading analytics...</p> : null}
            {!isLoading && departmentPerformance.length === 0 ? <p className="text-sm text-text-secondary">No department analytics available.</p> : null}
            {departmentPerformance.map((item) => (
              <div key={`${item.departmentId || item.departmentName}`} className="rounded-xl border border-border px-3 py-2">
                <p className="font-medium text-text-primary">{item.departmentName}</p>
                <p className="text-xs text-text-secondary">
                  Avg Score: {item.avgScore}% | Pass Rate: {item.passRate}% | Participants: {item.participants}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border">
          <CardHeader><CardTitle>Placement Readiness</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {readiness.length === 0 ? <p className="text-sm text-text-secondary">No readiness snapshot yet.</p> : null}
            {readiness.map((item) => (
              <div key={item.band} className="rounded-xl border border-border px-3 py-2">
                <p className="font-medium text-text-primary">{item.band}</p>
                <p className="text-xs text-text-secondary">Students: {item.count}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border-border">
          <CardHeader><CardTitle>Top Performers</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {topPerformers.length === 0 ? <p className="text-sm text-text-secondary">No submissions yet.</p> : null}
            {topPerformers.map((item) => (
              <div key={item.studentId} className="rounded-xl border border-border px-3 py-2">
                <p className="font-medium text-text-primary">{item.fullName}</p>
                <p className="text-xs text-text-secondary">{item.departmentName} | Avg Score: {item.averageScore}% | Attempts: {item.attempts}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border">
          <CardHeader><CardTitle>Test Participation</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {participation.length === 0 ? <p className="text-sm text-text-secondary">No participation data yet.</p> : null}
            {participation.map((item) => (
              <div key={item.testId} className="rounded-xl border border-border px-3 py-2">
                <p className="font-medium text-text-primary">{item.title}</p>
                <p className="text-xs text-text-secondary">Participants: {item.participants} | Avg Score: {item.averageScore}%</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Score Trend</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {trend.length === 0 ? <p className="text-sm text-text-secondary">No historical submissions yet.</p> : null}
          {trend.map((item) => (
            <div key={item.month} className="rounded-xl border border-border px-3 py-2">
              <p className="text-sm font-medium text-text-primary">{item.month}</p>
              <p className="text-xs text-text-secondary">Avg Score: {item.averageScore}%</p>
              <p className="text-xs text-text-secondary">Submissions: {item.submissions}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
