import { EmptyState } from "@/components/Reports/components";
import { scoreColorClass } from "@/components/Reports/stats";
import { clampPercent, formatPercent } from "@/components/Reports/utils";

// Compact, text-first building blocks for the admin-level report pages. They
// replace stacks of stat cards and charts with the few numbers a reader needs,
// and are shared by the Admin/College-Admin and Super-Admin pages.

const STRIP_COLUMNS = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

const METRIC_TONE = {
  default: "text-text-primary",
  danger: "text-red-500",
};

/** One card holding the headline numbers, separated by hairlines instead of separate cards. */
export function MetricStrip({ items = [] }) {
  if (!items.length) return null;
  return (
    <article className={`grid gap-px overflow-hidden rounded-2xl border border-border bg-border ${STRIP_COLUMNS[items.length] || STRIP_COLUMNS[4]}`}>
      {items.map((item) => (
        <div key={item.key || item.label} className="min-w-0 bg-card px-4 py-4 sm:px-5">
          <p className="text-xs font-medium text-text-secondary">{item.label}</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${METRIC_TONE[item.tone] || METRIC_TONE.default}`}>{item.value}</p>
          {item.hint ? <p className="mt-0.5 truncate text-xs text-text-secondary" title={item.hint}>{item.hint}</p> : null}
        </div>
      ))}
    </article>
  );
}

// A topic at or above this average is a strength; below it, it needs work.
const STRENGTH_THRESHOLD = 60;

function TopicList({ title, topics, emptyText }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">{title}</p>
      {topics.length ? (
        <ul className="space-y-1.5">
          {topics.map((topic) => (
            <li key={topic.name} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 break-words text-text-primary">{topic.name}</span>
              <span className={`shrink-0 font-semibold tabular-nums ${scoreColorClass(topic.score)}`}>{formatPercent(topic.score)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-secondary">{emptyText}</p>
      )}
    </div>
  );
}

/** Strong areas vs areas needing improvement, instead of a bar + radar chart of the same topics. */
export function TopicStrengths({ topics = [], limit = 3 }) {
  const normalized = (Array.isArray(topics) ? topics : [])
    .map((item) => ({ name: item.subject || item.topic || item.name || "General", score: clampPercent(item.score ?? item.avgScore) }))
    .sort((a, b) => b.score - a.score);

  if (!normalized.length) {
    return <EmptyState title="No topic data yet" description="Topic results appear once students submit tests." />;
  }

  const strong = normalized.filter((topic) => topic.score >= STRENGTH_THRESHOLD).slice(0, limit);
  const weak = normalized.filter((topic) => topic.score < STRENGTH_THRESHOLD).reverse().slice(0, limit);

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <TopicList title="Strong areas" topics={strong} emptyText={`No topic averages ${STRENGTH_THRESHOLD}% or more yet.`} />
      <TopicList title="Needs improvement" topics={weak} emptyText={`Every topic averages ${STRENGTH_THRESHOLD}% or more.`} />
    </div>
  );
}

/** Ranked groups (departments or batches) by average score, with pass rate alongside. */
export function GroupPerformanceList({ rows = [], labelKey = "department", onSelect, emptyText = "No results in this scope yet." }) {
  const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => clampPercent(b.avgScore) - clampPercent(a.avgScore));
  if (!sorted.length) {
    return <EmptyState title="Nothing to compare yet" description={emptyText} />;
  }

  return (
    <ul className="space-y-3">
      {sorted.map((row) => {
        const name = row[labelKey] || "-";
        const avg = clampPercent(row.avgScore);
        return (
          <li key={row.departmentId || row.batchId || name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)_auto]">
            {onSelect ? (
              <button type="button" onClick={() => onSelect(row)} className="truncate text-left text-sm font-medium text-text-primary hover:text-primary" title={`Show ${name}`}>
                {name}
              </button>
            ) : (
              <span className="truncate text-sm font-medium text-text-primary" title={name}>{name}</span>
            )}
            <div className="order-last col-span-2 h-2 rounded-full bg-muted sm:order-none sm:col-span-1">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${avg}%` }} />
            </div>
            <span className="text-right text-sm tabular-nums">
              <span className={`font-semibold ${scoreColorClass(avg)}`}>{formatPercent(avg)}</span>
              <span className="ml-2 text-xs text-text-secondary">pass {formatPercent(row.passRate)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** "Score" cell: percentage first, raw marks as secondary text (one column instead of two). */
export function ScoreWithMarks({ percent, obtained, total }) {
  const hasMarks = Number(total) > 0;
  return (
    <span className="whitespace-nowrap">
      <span className={`font-semibold tabular-nums ${scoreColorClass(percent)}`}>{percent == null ? "-" : formatPercent(percent)}</span>
      {hasMarks ? <span className="ml-1.5 text-xs tabular-nums text-text-secondary">{Number(obtained || 0)}/{Number(total)}</span> : null}
    </span>
  );
}
