import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FileCheck2, GraduationCap, School, ShieldAlert } from "lucide-react";
import { fetchSuperAnalytics } from "@/features/SuperAdmin/superAdminPanelSlice";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { EmptyState, PageHeader, SectionCard } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";

const formatNumber = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return value ?? "—";
  return Number.isInteger(num) ? num.toLocaleString() : num.toFixed(1);
};

/** Ranked list with a proportional bar so values compare at a glance. */
function RankedList({ rows, loading, emptyIcon, emptyTitle, tone = "bg-primary", valueLabel }) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-11 rounded-lg" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description="Data appears once there is activity on the platform." className="border-0 py-8" />;
  }

  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));

  return (
    <ol className="space-y-3">
      {rows.map((row, index) => (
        <li key={row.key} className="flex items-center gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums text-text-secondary">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-medium text-text-primary">{row.label}</p>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
                {formatNumber(row.value)}
                {valueLabel ? <span className="ml-1 text-xs font-normal text-text-secondary">{valueLabel}</span> : null}
              </p>
            </div>
            {row.sub ? <p className="truncate text-xs text-text-secondary">{row.sub}</p> : null}
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(3, ((Number(row.value) || 0) / max) * 100)}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function AnalyticsPage() {
  const dispatch = useDispatch();
  const analytics = useSelector((state) => state.superAdminPanel.analytics);
  const [settled, setSettled] = useState(false);
  const loading = analytics === null && !settled;

  useEffect(() => {
    Promise.resolve(dispatch(fetchSuperAnalytics())).finally(() => setSettled(true));
  }, [dispatch]);

  const colleges = (analytics?.topPerformingColleges || []).map((item) => ({
    key: item.collegeId,
    label: item.collegeName,
    value: item.avgScore,
  }));
  const students = (analytics?.topStudents || []).map((item) => ({
    key: item.studentId,
    label: item.studentName,
    sub: item.collegeName,
    value: item.avgScore,
  }));
  const tests = (analytics?.mostActiveTests || []).map((item) => ({
    key: item.testId,
    label: item.testName,
    value: item.submissions,
  }));
  const violations = (analytics?.violationStatistics || []).map((item) => ({
    key: item.type,
    label: String(item.type || "Unknown").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
    value: item.count,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Leaders and activity across every college on the platform." />

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Top performing colleges" description="Ranked by average score.">
          <RankedList rows={colleges} loading={loading} emptyIcon={School} emptyTitle="No college scores yet" valueLabel="avg" />
        </SectionCard>

        <SectionCard title="Top students" description="Highest average scores platform-wide.">
          <RankedList rows={students} loading={loading} emptyIcon={GraduationCap} emptyTitle="No student scores yet" tone="bg-success" valueLabel="avg" />
        </SectionCard>

        <SectionCard title="Most active tests" description="Ranked by number of submissions.">
          <RankedList rows={tests} loading={loading} emptyIcon={FileCheck2} emptyTitle="No submissions yet" tone="bg-chart-5" valueLabel="submissions" />
        </SectionCard>

        <SectionCard title="Violation statistics" description="Proctoring violations by type.">
          <RankedList rows={violations} loading={loading} emptyIcon={ShieldAlert} emptyTitle="No violations recorded" tone="bg-danger" />
        </SectionCard>
      </div>
    </div>
  );
}
