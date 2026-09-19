import { useState } from "react";
import {
  AreaTrendChart,
  Avatar,
  ChartCard,
  DumbbellChart,
  EmptyState,
  HorizontalBarChart,
  ItemQualityScatter,
  MultiSeriesTrendChart,
  ScoreBadge,
  StatCard,
  StatusBadge,
  Th,
  ViolationBadge,
} from "@/components/Reports/components";

// Shared advanced-report views used by both the Admin/College-Admin and
// Super-Admin report pages. They are purely presentational: pass a react-query
// result ({ isLoading, isError, data }) plus a few callbacks. Keeping them here
// guarantees the two portals render identical analytics.

const RISK_VARIANT = { CRITICAL: "danger", HIGH: "danger", MODERATE: "warning", LOW: "default" };
const formatViolationType = (type) => String(type || "UNKNOWN").replace(/_/g, " ").toLowerCase();

export function ItemAnalysisView({ query }) {
  const [itemSort, setItemSort] = useState({ key: "order", dir: "asc" });
  const payload = query?.data || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const summary = payload.summary || {};
  const sorted = [...items].sort((a, b) => {
    const dir = itemSort.dir === "asc" ? 1 : -1;
    const av = a[itemSort.key];
    const bv = b[itemSort.key];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
  });
  const toggleItemSort = (key) =>
    setItemSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  if (query?.isLoading) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-text-secondary">Analysing questions…</div>;
  }
  if (query?.isError) {
    return <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load question analysis.</div>;
  }
  if (!items.length) {
    return <EmptyState title="No question data" description="Question analysis appears once this test has submissions." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard iconName="score" iconTone="navy" label="Questions" value={summary.totalQuestions ?? 0} sub="In this test" />
        <StatCard iconName="target" iconTone="primary" label="Avg Difficulty" value={`${Math.round((summary.averageDifficulty || 0) * 100)}%`} sub="Higher = easier" />
        <StatCard iconName="participation" iconTone="success" label="Avg Discrimination" value={(summary.averageDiscrimination || 0).toFixed(2)} sub="0.2+ is acceptable" />
        <StatCard
          iconName="alert"
          iconTone={(summary.flaggedQuestions ?? 0) > 0 ? "danger" : "warning"}
          label="Flagged Items"
          value={summary.flaggedQuestions ?? 0}
          sub="Need review"
          flag={(summary.flaggedQuestions ?? 0) > 0}
        />
      </div>

      <ChartCard title="Item quality — difficulty vs discrimination" height="h-[260px]">
        <ItemQualityScatter items={items} />
      </ChartCard>

      <article className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <Th sortKey="order" sortState={itemSort} onSort={toggleItemSort}>Q</Th>
              <Th>Prompt</Th>
              <Th sortKey="difficulty" sortState={itemSort} onSort={toggleItemSort}>Difficulty</Th>
              <Th sortKey="discrimination" sortState={itemSort} onSort={toggleItemSort}>Discrimination</Th>
              <Th sortKey="medianTimeSeconds" sortState={itemSort} onSort={toggleItemSort}>Median Time</Th>
              <Th>Top Distractor</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr key={item.questionId} className="border-t border-border/70 hover:bg-muted/40">
                <td className="px-4 py-3 tabular-nums text-text-secondary">{item.order}</td>
                <td className="max-w-xs truncate px-4 py-3 font-medium text-text-primary" title={item.prompt}>{item.prompt}</td>
                <td className="px-4 py-3 tabular-nums">{Math.round(item.difficulty * 100)}%</td>
                <td className="px-4 py-3 tabular-nums">{item.discrimination.toFixed(2)}</td>
                <td className="px-4 py-3 tabular-nums text-text-secondary">{item.medianTimeSeconds}s</td>
                <td className="px-4 py-3 text-text-secondary">{item.topDistractor || "-"}</td>
                <td className="px-4 py-3">
                  {item.flagged ? (
                    <StatusBadge label={formatViolationType(item.flagReasons[0])} variant="danger" />
                  ) : (
                    <StatusBadge label={item.discriminationLabel.toLowerCase()} variant="success" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  );
}

export function IntegrityView({ query }) {
  const payload = query?.data || {};
  const summary = payload.summary || {};
  const byType = Array.isArray(payload.byType) ? payload.byType : [];
  const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
  const repeatOffenders = Array.isArray(payload.repeatOffenders) ? payload.repeatOffenders : [];
  const bands = Array.isArray(payload.scoreByViolationBand) ? payload.scoreByViolationBand : [];

  if (query?.isLoading) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-text-secondary">Loading integrity analytics…</div>;
  }
  if (query?.isError) {
    return <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load integrity analytics.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard iconName="alert" iconTone="warning" label="Violations" value={summary.totalViolations ?? 0} sub="Across all attempts" />
        <StatCard iconName="participation" iconTone="navy" label="Flagged Attempts" value={summary.flaggedAttempts ?? 0} sub={`${summary.flaggedRate ?? 0}% of attempts`} />
        <StatCard iconName="target" iconTone="success" label="Clean Attempts" value={summary.cleanAttempts ?? 0} sub="No flags raised" />
        <StatCard
          iconName="alert"
          iconTone={(summary.repeatOffenders ?? 0) > 0 ? "danger" : "warning"}
          label="Repeat Offenders"
          value={summary.repeatOffenders ?? 0}
          sub="3+ violations"
          flag={(summary.repeatOffenders ?? 0) > 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Violations by Type" height="h-[240px]">
          <HorizontalBarChart
            data={byType.map((row) => ({ subject: formatViolationType(row.type), score: row.count }))}
            labelKey="subject"
            dataKey="score"
            height="h-full"
          />
        </ChartCard>
        <ChartCard title="When Violations Happen" height="h-[240px]">
          <AreaTrendChart data={timeline} xKey="label" dataKey="count" name="Violations" />
        </ChartCard>
      </div>

      <ChartCard title="Score by Violation Band" height="h-[200px]">
        <HorizontalBarChart
          data={bands.map((row) => ({ subject: row.label, score: row.avgScore }))}
          labelKey="subject"
          dataKey="score"
          height="h-full"
          threshold={40}
        />
      </ChartCard>

      <article className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className="border-b border-border/70 p-4">
          <h3 className="text-lg font-semibold text-text-primary">Repeat Offenders</h3>
        </div>
        {repeatOffenders.length === 0 ? (
          <EmptyState title="No repeat offenders" description="No student exceeded the violation threshold for this test." />
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Violations</Th>
                <Th>Types</Th>
                <Th>Score</Th>
              </tr>
            </thead>
            <tbody>
              {repeatOffenders.map((row) => (
                <tr key={row.studentId} className="border-t border-border/70 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={row.studentName} seed={row.studentId} />
                      <span className="font-medium text-text-primary">{row.studentName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><ViolationBadge count={row.count} /></td>
                  <td className="px-4 py-3 text-xs text-text-secondary">{row.types.map(formatViolationType).join(", ")}</td>
                  <td className="px-4 py-3"><ScoreBadge score={row.scorePercent} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </div>
  );
}

export function TrendsView({ query, groupBy, onGroupByChange, indexed, onIndexedChange, showGroupBy = true }) {
  const payload = query?.data || {};
  const series = Array.isArray(payload.series) ? payload.series : [];
  const periods = Array.isArray(payload.periods) ? payload.periods : [];
  const summary = payload.summary || {};

  if (query?.isLoading) {
    return <section className="rounded-2xl border border-border bg-card p-6 text-sm text-text-secondary">Loading trends…</section>;
  }
  if (query?.isError) {
    return <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load trends.</section>;
  }

  const chartRows = periods.map((period) => {
    const row = { period };
    series.forEach((entity) => {
      const point = entity.series.find((item) => item.period === period);
      row[entity.name] = point?.score ?? null;
    });
    return row;
  });

  const dumbbellRows = series
    .filter((entity) => entity.firstScore != null && entity.lastScore != null)
    .map((entity) => ({ id: entity.entityId, label: entity.name, before: entity.firstScore, after: entity.lastScore }));

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard iconName="students" iconTone="navy" label="Cohorts" value={summary.entities ?? 0} sub={`Across ${summary.periods ?? 0} periods`} />
        <StatCard iconName="target" iconTone="success" label="Improving" value={summary.improving ?? 0} sub="Trending up" />
        <StatCard iconName="participation" iconTone="primary" label="Stable" value={summary.stable ?? 0} sub="No clear movement" />
        <StatCard
          iconName="alert"
          iconTone={(summary.declining ?? 0) > 0 ? "danger" : "warning"}
          label="Declining"
          value={summary.declining ?? 0}
          sub="Trending down"
          flag={(summary.declining ?? 0) > 0}
        />
      </div>

      <article className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        {showGroupBy ? (
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <span>Group by</span>
            <select
              value={groupBy}
              onChange={(event) => onGroupByChange?.(event.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
            >
              <option value="department">Department</option>
              <option value="batch">Batch</option>
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={indexed} onChange={(event) => onIndexedChange?.(event.target.checked)} />
          <span>Index to first period (=100)</span>
        </label>
      </article>

      <ChartCard title={indexed ? "Cohort Trend (indexed to 100)" : "Cohort Performance Over Time"} height="h-[300px]">
        <MultiSeriesTrendChart rows={chartRows} seriesNames={series.map((entity) => entity.name)} xKey="period" />
      </ChartCard>

      <ChartCard title="First vs Latest Period" height="h-auto">
        <DumbbellChart rows={dumbbellRows} />
      </ChartCard>
    </section>
  );
}

export function AtRiskView({ query, canViewStudent = false, onViewStudent }) {
  const payload = query?.data || {};
  const students = Array.isArray(payload.students) ? payload.students : [];
  const summary = payload.summary || {};

  if (query?.isLoading) {
    return <section className="rounded-2xl border border-border bg-card p-6 text-sm text-text-secondary">Assessing students…</section>;
  }
  if (query?.isError) {
    return <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load at-risk analysis.</section>;
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard iconName="students" iconTone="navy" label="Assessed" value={summary.assessed ?? 0} sub="Students in scope" />
        <StatCard iconName="participation" iconTone="warning" label="At Risk" value={summary.atRisk ?? 0} sub="Above the risk bar" />
        <StatCard iconName="alert" iconTone="warning" label="High" value={summary.high ?? 0} sub="Multiple signals" />
        <StatCard
          iconName="alert"
          iconTone={(summary.critical ?? 0) > 0 ? "danger" : "warning"}
          label="Critical"
          value={summary.critical ?? 0}
          sub="Immediate attention"
          flag={(summary.critical ?? 0) > 0}
        />
      </div>

      <article className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="border-b border-border/70 p-4">
          <h3 className="text-lg font-semibold text-text-primary">Ranked At-Risk Students</h3>
          <p className="text-xs text-text-secondary">Every flag lists the signals that produced it — no hidden scoring.</p>
        </div>

        {students.length === 0 ? (
          <EmptyState title="No students at risk" description="No student in this scope crossed the risk threshold." />
        ) : (
          <div className="space-y-2 p-4">
            {students.map((student) => (
              <div key={student.studentId} className="rounded-xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={student.name} seed={student.studentId} />
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary">{student.name}</p>
                      <p className="text-xs text-text-secondary">{student.rollNo} · {student.department} · {student.batch}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge label={student.riskLevel.toLowerCase()} variant={RISK_VARIANT[student.riskLevel] || "default"} />
                    <div className="text-right">
                      <p className="text-lg font-bold text-text-primary">{student.riskScore}</p>
                      <p className="text-[10px] uppercase tracking-wider text-text-secondary">risk score</p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                  <span className="text-text-secondary">Avg <strong className="tabular-nums text-text-primary">{student.averageScore}%</strong></span>
                  <span className="text-text-secondary">Attempts <strong className="tabular-nums text-text-primary">{student.attempts}/{student.assignedTests}</strong></span>
                  <span className="text-text-secondary">Participation <strong className="tabular-nums text-text-primary">{student.participation}%</strong></span>
                  <span className="text-text-secondary">Violations <strong className="tabular-nums text-text-primary">{student.violations}</strong></span>
                </div>

                <ul className="mt-3 flex flex-wrap gap-2">
                  {student.reasons.map((reason) => (
                    <li
                      key={reason.code}
                      className="rounded-full border border-border bg-card px-3 py-1 text-[11px] text-text-secondary"
                      title={`+${reason.points} risk points`}
                    >
                      <strong className="text-text-primary">{reason.label}</strong> · {reason.detail}
                    </li>
                  ))}
                </ul>

                {canViewStudent ? (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onViewStudent?.(student.studentId)}
                      className="rounded-lg border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
                    >
                      View student report
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
