import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  clampPercent,
  createSeriesColorScale,
  formatDateLabel,
  formatPercent,
  NO_DATA_LABEL,
  ordinalColor,
  percentOrNull,
} from "@/components/Reports/utils";
import { scoreColorClassOrNoData } from "@/components/Reports/stats";

const AXIS_TICK = { fontSize: 11, fill: "var(--text-secondary)" };
const GRID_STROKE = "var(--chart-grid)";
// Solid hairline grid — dashed gridlines read as "threshold"/"projection".
const gridProps = { stroke: GRID_STROKE, strokeOpacity: 1 };
// Hover target larger than the mark itself.
const CROSSHAIR = { stroke: "var(--chart-axis)", strokeWidth: 1 };

export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
      {label ? <p className="mb-1 font-semibold text-text-primary">{label}</p> : null}
      {payload.map((point, index) => (
        <div key={`${point.name}-${index}`} className="flex items-center gap-2 text-text-secondary">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: point.color }} />
          <span>{point.name}:</span>
          <span className="font-semibold text-text-primary">
            {point.value == null ? NO_DATA_LABEL : typeof point.value === "number" ? clampPercent(point.value).toFixed(1) : point.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ChartCard({ title, action, height = "h-[220px]", children, footer }) {
  return (
    <article className="min-w-0 rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {action ? (
          <button type="button" onClick={action.onClick} className="text-xs font-medium text-chart-1 transition-opacity hover:opacity-70">
            {action.label}
          </button>
        ) : null}
      </div>
      <div className={`${height} min-h-0 w-full min-w-0`}>{children}</div>
      {footer ? <p className="mt-2 text-xs text-text-secondary">{footer}</p> : null}
    </article>
  );
}

export function AbsentStudentsCard({ title, subtitle, students = [], count }) {
  const rows = Array.isArray(students) ? students : [];
  const total = Number.isFinite(Number(count)) ? Number(count) : rows.length;

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">
          {title} <span className="font-normal text-text-secondary">({total})</span>
        </h3>
        {subtitle ? <p className="text-xs text-text-secondary">{subtitle}</p> : null}
      </div>

      {rows.length ? (
        <div className="mt-4 max-h-60 space-y-2 overflow-y-auto pr-1">
          {rows.map((student, index) => (
            <div
              key={student.studentId || student.id || `${student.name || "student"}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-text-primary">{student.name || "-"}</p>
                <p className="text-xs text-text-secondary">{student.rollNo || student.studentId || "-"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {student.department ? <StatusBadge label={student.department} variant="info" /> : null}
                {student.batch ? <StatusBadge label={student.batch} variant="default" /> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-text-secondary">All students attended this test in the current scope.</p>
      )}
    </article>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="flex h-full min-h-45 flex-col items-center justify-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-background">
        <svg className="h-5 w-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      {description ? <p className="max-w-xs text-xs text-text-secondary">{description}</p> : null}
      {action ? (
        <button type="button" onClick={action.onClick} className="mt-1 rounded-lg border border-border bg-background px-4 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-card">
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} aria-hidden="true" />;
}

export function ChartCardSkeleton({ height = "h-[240px]" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Skeleton className="h-4 w-40" />
      <div className={`mt-4 ${height}`}>
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}

// Placeholder shaped like the report layout (metric strip + two panels) so the
// page doesn't jump when data arrives.
export function AnalyticsSkeleton() {
  return (
    <section className="space-y-4" role="status" aria-label="Loading report analytics">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="bg-card p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCardSkeleton height="h-[200px]" />
        <ChartCardSkeleton height="h-[200px]" />
      </div>
    </section>
  );
}

export function ScoreBadge({ score, noDataLabel = NO_DATA_LABEL }) {
  return (
    <span className={`font-semibold tabular-nums ${scoreColorClassOrNoData(score)}`}>
      {score == null ? noDataLabel : formatPercent(score)}
    </span>
  );
}

export function StatusBadge({ label, variant = "default" }) {
  const variants = {
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-danger/10 text-danger",
    info: "bg-chart-1/10 text-chart-1",
    default: "bg-muted text-text-secondary",
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${variants[variant] || variants.default}`}>{label}</span>;
}

export function Th({ children, sortKey, sortState, onSort }) {
  const active = sortState?.key === sortKey;
  const asc = sortState?.dir === "asc";
  return (
    <th
      scope="col"
      onClick={() => onSort?.(sortKey)}
      className={`select-none whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-widest text-text-secondary ${onSort ? "cursor-pointer hover:text-text-primary" : ""}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {onSort ? <span className={`transition-opacity ${active ? "opacity-100" : "opacity-30"}`}>{active && !asc ? "↑" : "↓"}</span> : null}
      </span>
    </th>
  );
}

export function ViolationBadge({ count }) {
  const value = Number(count || 0);
  if (value === 0) return <StatusBadge label="Clean" variant="success" />;
  return <StatusBadge label={`${value} ${value === 1 ? "violation" : "violations"}`} variant={value <= 2 ? "warning" : "danger"} />;
}

/**
 * Score-band distribution. The bands are an ORDERED sequence, so they wear the
 * one-hue ordinal ramp (light -> dark), not categorical identity hues, and read
 * as a column histogram rather than a donut.
 */
export function ScoreDistributionChart({ data, height = "h-[220px]" }) {
  if (!data?.length) return <EmptyState title="No distribution data" />;
  const rows = data.map((item, index) => ({
    range: item.range,
    count: Number(item.count || 0),
    fill: ordinalColor(index, data.length),
  }));

  return (
    <div className="flex h-full w-full flex-col">
      <div className={`${height} w-full`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 200 }}>
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 4 }} barCategoryGap="18%">
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="range" axisLine={false} tickLine={false} tick={AXIS_TICK} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={AXIS_TICK} />
            <Tooltip
              cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
                    <strong className="text-text-primary">{payload[0].payload.range}%</strong>
                    <span className="ml-2 text-text-secondary">{payload[0].payload.count} students</span>
                  </div>
                ) : null
              }
            />
            <Bar dataKey="count" name="Students" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={row.range} fill={row.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Average score per subject as horizontal bars. Each subject is a distinct
 * entity, not a step in an ordered sequence, so colour is keyed to the subject
 * name instead of its position. Subjects the API answered with `null` are
 * dropped rather than drawn as a 0% bar.
 */
export function SubjectPerformanceChart({ topics, height = "h-[240px]" }) {
  const rows = (Array.isArray(topics) ? topics : [])
    .filter((topic) => topic?.score != null)
    .map((topic) => ({ subject: String(topic.subject || "General"), score: percentOrNull(topic.score) }))
    .sort((a, b) => b.score - a.score);

  if (!rows.length) {
    return <EmptyState title="No subject scores" description="Subject averages appear once students submit tests." />;
  }

  const colorFor = createSeriesColorScale(rows.map((row) => row.subject));

  return (
    <div className={`${height} w-full`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 220 }}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 44, left: 8, bottom: 4 }} barCategoryGap="22%">
          <CartesianGrid {...gridProps} horizontal={false} />
          <XAxis type="number" domain={[0, 100]} unit="%" axisLine={false} tickLine={false} tick={AXIS_TICK} />
          <YAxis type="category" dataKey="subject" width={110} interval={0} axisLine={false} tickLine={false} tick={AXIS_TICK} />
          <Tooltip cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }} content={ChartTooltip} />
          <Bar
            dataKey="score"
            name="Average score"
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            label={{ position: "right", fontSize: 11, fill: "var(--text-secondary)", formatter: (value) => `${Number(value).toFixed(1)}%` }}
          >
            {rows.map((row) => (
              <Cell key={row.subject} fill={colorFor(row.subject)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExportButton({ exportState, onExport, onDownload, disabled, disabledReason }) {
  const { status, progress, downloadUrl, expiresAt, errorMessage } = exportState || {};

  const isExpired = expiresAt && new Date(expiresAt) < new Date();
  const nearExpiry = expiresAt && !isExpired && new Date(expiresAt).getTime() - Date.now() < 60 * 1000;

  if (status === "complete" && downloadUrl && !isExpired) {
    return (
      <div className="flex items-center gap-2">
        {nearExpiry ? <span className="text-xs text-warning">Link expires soon</span> : null}
        <button
          type="button"
          onClick={onDownload}
          disabled={disabled}
          title={disabledReason || ""}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-success/10 px-4 py-2 text-sm font-semibold text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Download
        </button>
      </div>
    );
  }

  if (status === "loading" || status === "polling") {
    return (
      <button
        type="button"
        disabled
        className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-text-secondary"
      >
        <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        {progress ? `Generating ${Math.round(progress)}%` : "Generating..."}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {status === "failed" && errorMessage ? (
        <span className="max-w-xs text-right text-xs font-medium text-danger">{errorMessage}</span>
      ) : null}
      <button
        type="button"
        onClick={onExport}
        disabled={disabled}
        title={disabledReason || ""}
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "failed" ? "Retry Export" : "Export Report"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Redesign kit: KPI row, pagination, test-list item, deep-dive header,
// department comparison. All presentational and prop-driven so Admin,
// College-Admin, and Super-Admin pages share one implementation.
// ---------------------------------------------------------------------------

const buildPageNumbers = (page, totalPages) => {
  const pages = [];
  const add = (value) => {
    if (!pages.includes(value) && value >= 1 && value <= totalPages) pages.push(value);
  };
  add(1);
  for (let offset = -1; offset <= 1; offset += 1) add(page + offset);
  add(totalPages);
  const sorted = [...pages].sort((a, b) => a - b);
  const withGaps = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) withGaps.push("gap");
    withGaps.push(value);
  });
  return withGaps;
};

export function Pagination({ page = 1, totalPages = 1, total, onPageChange, className = "" }) {
  if (totalPages <= 1) {
    return total != null ? (
      <p className={`text-xs text-text-secondary ${className}`}>{total} result{total === 1 ? "" : "s"}</p>
    ) : null;
  }
  const numbers = buildPageNumbers(page, totalPages);
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      {total != null ? <p className="text-xs text-text-secondary">{total} result{total === 1 ? "" : "s"}</p> : <span />}
      <div className="flex items-center gap-1">
        <button type="button" className={`${btn} border-border bg-card text-text-primary hover:bg-muted`} disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>‹</button>
        {numbers.map((value, index) =>
          value === "gap" ? (
            <span key={`gap-${index}`} className="px-1 text-text-secondary">…</span>
          ) : (
            <button
              key={value}
              type="button"
              onClick={() => onPageChange?.(value)}
              className={`${btn} ${value === page ? "border-chart-1 bg-chart-1/10 text-chart-1" : "border-border bg-card text-text-primary hover:bg-muted"}`}
            >
              {value}
            </button>
          )
        )}
        <button type="button" className={`${btn} border-border bg-card text-text-primary hover:bg-muted`} disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>›</button>
      </div>
    </div>
  );
}

const TEST_STATUS_VARIANT = {
  LIVE: "info",
  COMPLETED: "success",
  SCHEDULED: "warning",
  DRAFT: "default",
  ARCHIVED: "default",
};

// ---------------------------------------------------------------------------
// Dashboard redesign kit — polished, prop-driven primitives that mirror the
// reporting-dashboard mockups (stat cards with icons + trend pills, avatars,
// result/category badges, tab nav, insight card, weekly bar chart). Shared so
// Admin / College-Admin / Super-Admin report pages render one consistent UI.
// ---------------------------------------------------------------------------

const STAT_ICON_PATHS = {
  students:
    "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
  score:
    "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  submissions:
    "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
  alert:
    "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z",
  participation:
    "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  target:
    "M12 21a9 9 0 100-18 9 9 0 000 18zm0-4a5 5 0 100-10 5 5 0 000 10zm0-3a2 2 0 100-4 2 2 0 000 4z",
};

export function StatIcon({ name, className = "h-5 w-5" }) {
  const d = STAT_ICON_PATHS[name] || STAT_ICON_PATHS.score;
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export function TrendPill({ value, dir }) {
  if (value == null) return null;
  const direction = dir || (Number(value) < 0 ? "down" : "up");
  const up = direction === "up";
  const label = typeof value === "number" ? `${value > 0 ? "+" : ""}${value}%` : value;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${up ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
      <span className="text-[9px]">{up ? "▲" : "▼"}</span>
      {label}
    </span>
  );
}

const STAT_TONES = {
  navy: "bg-primary-dark text-white",
  primary: "bg-primary text-primary-foreground",
  success: "bg-success text-white",
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/10 text-warning",
};

export function StatCard({ icon, iconName, label, value, sub, trend, trendDir, badge, badgeTone = "muted", iconTone = "navy", flag }) {
  const badgeClasses = {
    success: "bg-success/10 text-success",
    danger: "bg-danger/10 text-danger",
    warning: "bg-warning/10 text-warning",
    info: "bg-primary/10 text-primary",
    muted: "bg-muted text-text-secondary",
  };
  return (
    <article className={`relative overflow-hidden rounded-xl border bg-card p-5 shadow-xs ${flag ? "border-danger/50" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${STAT_TONES[iconTone] || STAT_TONES.navy}`}>
          {icon || <StatIcon name={iconName} />}
        </div>
        {badge ? (
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badgeClasses[badgeTone] || badgeClasses.muted}`}>{badge}</span>
        ) : trend != null ? (
          <TrendPill value={trend} dir={trendDir} />
        ) : null}
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-widest text-text-secondary">{label}</p>
      <p className={`mt-1 text-3xl leading-none font-bold tabular-nums ${flag ? "text-danger" : "text-text-primary"}`}>{value ?? "-"}</p>
      {sub ? <p className={`mt-1.5 text-xs ${flag ? "text-danger" : "text-text-secondary"}`}>{sub}</p> : null}
    </article>
  );
}

const AVATAR_TONES = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];

export function Avatar({ name, seed, size = "h-9 w-9" }) {
  const initials = String(name || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const key = String(seed ?? name ?? "");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash + key.charCodeAt(i)) % AVATAR_TONES.length;
  return (
    <span className={`inline-flex ${size} shrink-0 items-center justify-center rounded-full text-xs font-bold ${AVATAR_TONES[hash]}`}>
      {initials}
    </span>
  );
}

const RESULT_META = {
  pass: { label: "PASS", dot: "bg-success", text: "text-success" },
  fail: { label: "FAIL", dot: "bg-danger", text: "text-danger" },
  graded: { label: "GRADED", dot: "bg-primary", text: "text-primary" },
  pending: { label: "PENDING", dot: "bg-warning", text: "text-warning" },
};

export function ResultBadge({ status, score, passMark = 40 }) {
  let key = String(status || "").toLowerCase();
  if (!RESULT_META[key]) {
    if (score != null) key = clampPercent(score) >= passMark ? "pass" : "fail";
    else key = "pending";
  }
  const meta = RESULT_META[key] || RESULT_META.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export function SectionCard({ title, subtitle, icon, right, className = "", bodyClassName = "", children }) {
  return (
    <article className={`rounded-xl border border-border bg-card ${className}`}>
      {title || right ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div className="flex items-center gap-3">
            {icon ? <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div> : null}
            <div>
              <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
              {subtitle ? <p className="text-xs text-text-secondary">{subtitle}</p> : null}
            </div>
          </div>
          {right ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{right}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName || "p-5"}>{children}</div>
    </article>
  );
}

export function TabNav({ tabs = [], active, onChange, className = "" }) {
  return (
    <div className={`flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange?.(tab.key)}
            className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-semibold transition-colors ${isActive ? "text-primary" : "text-text-secondary hover:text-text-primary"}`}
          >
            {tab.label}
            {isActive ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Multiple cohorts over time on ONE value axis.
 * Colour is keyed to the series name (a stable entity), never its index, and
 * the legend is always present because there are >= 2 series. Past the 8-slot
 * cap the tail greys out rather than inventing a 9th hue.
 */
export function MultiSeriesTrendChart({ rows = [], seriesNames = [], xKey = "period" }) {
  if (!rows.length || !seriesNames.length) {
    return <EmptyState title="No trend data" description="Trends appear once there are at least two periods of results." />;
  }
  const colorFor = createSeriesColorScale(seriesNames);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {seriesNames.map((name) => (
          <span key={name} className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colorFor(name) }} />
            {name}
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 200 }}>
          <LineChart data={rows} margin={{ top: 4, right: 12, left: -22, bottom: 4 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey={xKey} axisLine={false} tickLine={false} tick={AXIS_TICK} />
            <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} />
            <Tooltip content={<ChartTooltip />} cursor={CROSSHAIR} />
            {seriesNames.map((name) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                name={name}
                stroke={colorFor(name)}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: colorFor(name) }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Recent report-job exports with per-job download. Shared by all admin portals. */
export function RecentExports({ reports, onDownload, subtitle = "Generated PDFs for this workspace." }) {
  const rows = Array.isArray(reports) ? reports.slice(0, 4) : [];

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-text-primary">Recent Exports</h3>
        <p className="text-xs text-text-secondary">{subtitle}</p>
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((job) => {
            const status = String(job.status || "QUEUED").toLowerCase();
            return (
              <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">{String(job.type || "REPORT").replace(/_/g, " ")}</p>
                  <p className="text-xs text-text-secondary">{formatDateLabel(job.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge label={status} variant={status === "completed" ? "success" : status === "failed" ? "danger" : "warning"} />
                  {status === "completed" ? (
                    <button
                      type="button"
                      onClick={() => onDownload(job.id)}
                      className="rounded-lg border border-border px-3 py-1 text-xs font-semibold hover:bg-muted"
                    >
                      Download
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No exports yet" description="Generated report PDFs will appear here." />
      )}
    </article>
  );
}

/** Selected-student identity banner with headline metrics. Shared by all admin portals. */
export function StudentSummary({ student, metrics }) {
  if (!student) return null;
  const toCount = (value) => {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  };

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-chart-1/10 text-xl font-bold text-chart-1">
          {String(student.name || "?")
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-text-primary">{student.name}</p>
          <p className="text-xs text-text-secondary">
            {student.studentId || "-"} - {student.college ? `${student.college} - ` : ""}{student.department || "-"} - {student.batch || "-"}
          </p>
          <p className="text-xs text-text-secondary">Year: {student.year ? `${student.year} YEAR` : "-"}</p>
        </div>
        <div className="grid min-w-60 grid-cols-2 gap-4 text-center sm:grid-cols-4">
          <div>
            <p className="text-2xl font-bold text-text-primary">{formatPercent(metrics?.avgScore)}</p>
            <p className="text-[11px] text-text-secondary">avg score</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-text-primary">#{student.rank || "-"}</p>
            <p className="text-[11px] text-text-secondary">rank</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-text-primary">{toCount(metrics?.totalSubmissions)}</p>
            <p className="text-[11px] text-text-secondary">attempts</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${toCount(metrics?.violations) > 0 ? "text-danger" : "text-success"}`}>
              {toCount(metrics?.violations)}
            </p>
            <p className="text-[11px] text-text-secondary">violations</p>
          </div>
        </div>
      </div>
    </article>
  );
}
