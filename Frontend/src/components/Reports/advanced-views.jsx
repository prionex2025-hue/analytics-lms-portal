import { useState } from "react";
import {
  Avatar,
  ChartCard,
  EmptyState,
  MultiSeriesTrendChart,
  ScoreBadge,
  StatusBadge,
  Th,
  ViolationBadge,
} from "@/components/Reports/components";
import { MetricStrip } from "@/components/Reports/summary-blocks";
import { formatPercent, NO_DATA_LABEL } from "@/components/Reports/utils";

// Shared advanced-report views used by both the Admin/College-Admin and
// Super-Admin report pages. They are purely presentational: pass a react-query
// result ({ isLoading, isError, data }) plus a few callbacks. Keeping them here
// guarantees the two portals render identical analytics.

const RISK_VARIANT = { CRITICAL: "danger", HIGH: "danger", MODERATE: "warning", LOW: "default" };
const formatViolationType = (type) => String(type || "UNKNOWN").replace(/_/g, " ").toLowerCase();

// Plain-language versions of the item-analysis flags (item-analysis.service).
const QUESTION_FLAG_TEXT = {
  VERY_HARD: "Most students got this wrong",
  TOO_EASY: "Almost everyone got this right",
  DISTRACTOR_BEATS_KEY: "A wrong option was chosen more than the answer",
  LOW_DISCRIMINATION: "Doesn't separate strong and weak students",
  NEGATIVE_DISCRIMINATION: "Weaker students did better — check the answer key",
};

const LoadingCard = ({ children }) => (
  <div className="rounded-xl border border-border bg-card p-6 text-sm text-text-secondary">{children}</div>
);
const ErrorCard = ({ children }) => (
  <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">{children}</div>
);

export function ItemAnalysisView({ query }) {
  const [itemSort, setItemSort] = useState({ key: "order", dir: "asc" });
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const payload = query?.data || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const summary = payload.summary || {};

  if (query?.isLoading) return <LoadingCard>Analysing questions…</LoadingCard>;
  if (query?.isError) return <ErrorCard>Unable to load question analysis.</ErrorCard>;
  if (!items.length) {
    return <EmptyState title="No question data" description="Question analysis appears once this test has submissions." />;
  }

  const flaggedCount = items.filter((item) => item.flagged).length;
  const visible = (onlyFlagged ? items.filter((item) => item.flagged) : items).slice().sort((a, b) => {
    const dir = itemSort.dir === "asc" ? 1 : -1;
    return ((a[itemSort.key] ?? 0) - (b[itemSort.key] ?? 0)) * dir;
  });
  const toggleItemSort = (key) =>
    setItemSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <article className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
        <p className="text-sm text-text-secondary">
          <strong className="text-text-primary">{summary.totalQuestions ?? items.length}</strong> questions ·{" "}
          <strong className={flaggedCount ? "text-danger" : "text-text-primary"}>{flaggedCount}</strong> need review · students answered{" "}
          <strong className="text-text-primary">{Math.round((summary.averageDifficulty || 0) * 100)}%</strong> correctly on average
        </p>
        <div className="flex overflow-hidden rounded-lg border border-border text-xs font-medium">
          {[
            { value: false, label: "All questions" },
            { value: true, label: "Needs review" },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setOnlyFlagged(option.value)}
              className={`px-3 py-1.5 ${onlyFlagged === option.value ? "bg-primary text-primary-foreground" : "bg-background text-text-primary hover:bg-muted"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No questions need review" description="Every question in this test behaved as expected." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <Th sortKey="order" sortState={itemSort} onSort={toggleItemSort}>Q</Th>
                <Th>Question</Th>
                <Th sortKey="difficulty" sortState={itemSort} onSort={toggleItemSort}>Answered correctly</Th>
                <Th>Most chosen wrong answer</Th>
                <Th>Review note</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.questionId} className="border-t border-border/70 align-top hover:bg-muted/40">
                  <td className="px-4 py-3 tabular-nums text-text-secondary">{item.order}</td>
                  <td className="max-w-md px-4 py-3 text-text-primary">
                    <p className="line-clamp-2" title={item.prompt}>{item.prompt || "-"}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <ScoreBadge score={Math.round((item.difficulty || 0) * 100)} />
                    <span className="ml-1.5 text-xs tabular-nums text-text-secondary">{item.correct}/{item.attempts}</span>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-text-secondary">
                    <p className="line-clamp-2">{item.topDistractor || "—"}</p>
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    {item.flagged ? (
                      <ul className="space-y-0.5 text-xs text-danger">
                        {(item.flagReasons || []).map((reason) => (
                          <li key={reason}>{QUESTION_FLAG_TEXT[reason] || formatViolationType(reason)}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-text-secondary">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export function IntegrityView({ query }) {
  const payload = query?.data || {};
  const summary = payload.summary || {};
  const byType = (Array.isArray(payload.byType) ? payload.byType : []).slice().sort((a, b) => (b.count || 0) - (a.count || 0));
  const repeatOffenders = Array.isArray(payload.repeatOffenders) ? payload.repeatOffenders : [];

  if (query?.isLoading) return <LoadingCard>Loading integrity analytics…</LoadingCard>;
  if (query?.isError) return <ErrorCard>Unable to load integrity analytics.</ErrorCard>;

  return (
    <div className="space-y-4">
      <MetricStrip
        items={[
          { key: "violations", label: "Violations", value: summary.totalViolations ?? 0, hint: "Across all attempts" },
          {
            key: "flagged",
            label: "Flagged attempts",
            value: summary.flaggedAttempts ?? 0,
            hint: `${summary.flaggedRate ?? 0}% of ${summary.attempts ?? 0} attempts`,
          },
          {
            key: "repeat",
            label: "Repeat offenders",
            value: summary.repeatOffenders ?? 0,
            hint: "3 or more violations",
            tone: (summary.repeatOffenders ?? 0) > 0 ? "danger" : "default",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <article className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Violations by type</h3>
          {byType.length ? (
            <ul className="space-y-1.5">
              {byType.map((row) => (
                <li key={row.type} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="capitalize text-text-primary">{formatViolationType(row.type)}</span>
                  <span className="font-semibold tabular-nums text-text-primary">{row.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">No violations recorded for this test.</p>
          )}
        </article>

        <article className="rounded-xl border border-border bg-card">
          <h3 className="border-b border-border/70 p-4 text-sm font-semibold text-text-primary">Repeat offenders</h3>
          {repeatOffenders.length === 0 ? (
            <EmptyState title="No repeat offenders" description="No student reached 3 violations in this test." />
          ) : (
            <div className="overflow-x-auto">
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
                      <td className="px-4 py-3 text-xs capitalize text-text-secondary">{row.types.map(formatViolationType).join(", ")}</td>
                      <td className="px-4 py-3"><ScoreBadge score={row.scorePercent} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

const formatChange = (value) => {
  if (value == null || !Number.isFinite(value)) return { text: "—", tone: "text-text-secondary" };
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) return { text: `▲ ${rounded} pts`, tone: "text-success" };
  if (rounded < 0) return { text: `▼ ${Math.abs(rounded)} pts`, tone: "text-danger" };
  return { text: "No change", tone: "text-text-secondary" };
};

export function TrendsView({ query, groupBy, onGroupByChange, showGroupBy = true }) {
  const payload = query?.data || {};
  const series = Array.isArray(payload.series) ? payload.series : [];
  const periods = Array.isArray(payload.periods) ? payload.periods : [];
  const summary = payload.summary || {};

  if (query?.isLoading) return <LoadingCard>Loading trends…</LoadingCard>;
  if (query?.isError) return <ErrorCard>Unable to load trends.</ErrorCard>;

  const chartRows = periods.map((period) => {
    const row = { period };
    series.forEach((entity) => {
      const point = entity.series.find((item) => item.period === period);
      row[entity.name] = point?.score ?? null;
    });
    return row;
  });

  // Biggest declines first: those are the cohorts that need attention.
  const changeRows = series
    .map((entity) => ({
      id: entity.entityId,
      name: entity.name,
      first: entity.firstScore,
      last: entity.lastScore,
      change: entity.firstScore != null && entity.lastScore != null ? entity.lastScore - entity.firstScore : null,
    }))
    .sort((a, b) => (a.change ?? 0) - (b.change ?? 0));

  return (
    <section className="space-y-4">
      <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-text-secondary">
          <strong className="text-success">{summary.improving ?? 0}</strong> improving ·{" "}
          <strong className="text-text-primary">{summary.stable ?? 0}</strong> stable ·{" "}
          <strong className={(summary.declining ?? 0) > 0 ? "text-danger" : "text-text-primary"}>{summary.declining ?? 0}</strong> declining
          <span> across {summary.periods ?? periods.length} months</span>
        </p>
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
      </article>

      {series.length === 0 ? (
        <article className="rounded-xl border border-border bg-card">
          <EmptyState title="No trend data yet" description="Trends appear once tests have been submitted across more than one month." />
        </article>
      ) : (
        <>
          <ChartCard title="Average score by month" height="h-[280px]">
            <MultiSeriesTrendChart rows={chartRows} seriesNames={series.map((entity) => entity.name)} xKey="period" />
          </ChartCard>

          <article className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <Th>{groupBy === "batch" ? "Batch" : "Department"}</Th>
                  <Th>First month</Th>
                  <Th>Latest month</Th>
                  <Th>Change</Th>
                </tr>
              </thead>
              <tbody>
                {changeRows.map((row) => {
                  const change = formatChange(row.change);
                  return (
                    <tr key={row.id || row.name} className="border-t border-border/70 hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium text-text-primary">{row.name}</td>
                      <td className="px-4 py-3 tabular-nums text-text-secondary">{row.first == null ? "—" : formatPercent(row.first)}</td>
                      <td className="px-4 py-3 tabular-nums text-text-secondary">{row.last == null ? "—" : formatPercent(row.last)}</td>
                      <td className={`px-4 py-3 font-semibold tabular-nums ${change.tone}`}>{change.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </article>
        </>
      )}
    </section>
  );
}

export function AtRiskView({ query, canViewStudent = false, onViewStudent, showParticipation = false, noDataLabel = NO_DATA_LABEL }) {
  const payload = query?.data || {};
  const students = Array.isArray(payload.students) ? payload.students : [];
  const summary = payload.summary || {};

  if (query?.isLoading) return <LoadingCard>Assessing students…</LoadingCard>;
  if (query?.isError) return <ErrorCard>Unable to load at-risk analysis.</ErrorCard>;

  return (
    <article className="rounded-xl border border-border bg-card">
      <div className="border-b border-border/70 p-4">
        <p className="text-sm text-text-secondary">
          <strong className={(summary.atRisk ?? 0) > 0 ? "text-danger" : "text-text-primary"}>{summary.atRisk ?? 0}</strong> of{" "}
          <strong className="text-text-primary">{summary.assessed ?? 0}</strong> students need attention
          {(summary.atRisk ?? 0) > 0 ? (
            <span> — {summary.critical ?? 0} critical, {summary.high ?? 0} high, {summary.moderate ?? 0} moderate</span>
          ) : null}
        </p>
      </div>

      {students.length === 0 ? (
        <EmptyState title="No students at risk" description="No student in this scope crossed the risk threshold." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Risk</Th>
                <Th>Why</Th>
                <Th>Avg score</Th>
                {showParticipation ? <Th>Participation</Th> : null}
                {canViewStudent ? <Th>Action</Th> : null}
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.studentId} className="border-t border-border/70 align-top hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary">{student.name}</p>
                    <p className="text-xs text-text-secondary">{student.rollNo} · {student.department} · {student.batch}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge label={String(student.riskLevel || "").toLowerCase()} variant={RISK_VARIANT[student.riskLevel] || "default"} />
                  </td>
                  <td className="px-4 py-3">
                    <ul className="space-y-0.5 text-xs">
                      {student.reasons.map((reason) => (
                        <li key={reason.code}>
                          <span className="font-medium text-text-primary">{reason.label}</span>
                          <span className="text-text-secondary"> — {reason.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-3"><ScoreBadge score={student.averageScore} noDataLabel={noDataLabel} /></td>
                  {showParticipation ? (
                    // Participation can be null (no tests assigned); it must never
                    // read or sort like a real 0%.
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">
                      {student.participation == null ? noDataLabel : formatPercent(student.participation)}
                    </td>
                  ) : null}
                  {canViewStudent ? (
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onViewStudent?.(student.studentId)}
                        className="whitespace-nowrap text-xs font-semibold text-primary hover:opacity-70"
                      >
                        View report
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
