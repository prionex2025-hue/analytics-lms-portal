import { useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  Scatter,
  ScatterChart,
  ZAxis,
} from "recharts";
import {
  CHART_COLORS,
  DE_EMPHASIS,
  DIVERGING,
  STATUS_COLORS,
  clampPercent,
  createSeriesColorScale,
  formatDateLabel,
  formatPercent,
  ordinalColor,
} from "@/components/Reports/utils";
import { scoreColorClass } from "@/components/Reports/stats";

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
          <span className="font-semibold text-text-primary">{typeof point.value === "number" ? clampPercent(point.value).toFixed(2) : point.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartCard({ title, action, height = "h-[220px]", children, footer }) {
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card p-5">
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

export function KpiCard({ label, value, sub, flag, flagLabel }) {
  return (
    <article className={`relative overflow-hidden rounded-2xl border bg-card p-5 ${flag ? "border-red-500/50" : "border-border"}`}>
      {flag ? <div className="absolute inset-x-0 top-0 h-0.5 bg-red-500" /> : null}
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-text-secondary">{label}</p>
      <p className={`text-3xl leading-none font-bold tabular-nums ${flag ? "text-red-500" : "text-text-primary"}`}>{value ?? "-"}</p>
      {sub || (flag && flagLabel) ? <p className={`mt-1.5 text-xs ${flag ? "text-red-400" : "text-text-secondary"}`}>{flag && flagLabel ? flagLabel : sub}</p> : null}
    </article>
  );
}

export function AbsentStudentsCard({ title, subtitle, students = [], count }) {
  const rows = Array.isArray(students) ? students : [];
  const total = Number.isFinite(Number(count)) ? Number(count) : rows.length;

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {subtitle ? <p className="text-xs text-text-secondary">{subtitle}</p> : null}
        </div>
        <div className="rounded-xl border border-border bg-background px-3 py-2 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">Not Attended</p>
          <p className="text-lg font-bold text-text-primary">{total}</p>
        </div>
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

export function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <Skeleton className="h-11 w-11 rounded-xl" />
      <Skeleton className="mt-4 h-3 w-24" />
      <Skeleton className="mt-2 h-8 w-20" />
    </div>
  );
}

export function ChartCardSkeleton({ height = "h-[240px]" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <Skeleton className="h-4 w-40" />
      <div className={`mt-4 ${height}`}>
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}

// Full analytics-tab placeholder: KPI row + chart row. Used in place of a bare
// "Loading…" string so the layout doesn't jump when data arrives.
export function AnalyticsSkeleton({ charts = 3 }) {
  return (
    <section className="space-y-4" role="status" aria-label="Loading report analytics">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <div className={`grid gap-4 ${charts >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        {Array.from({ length: charts }).map((_, index) => (
          <ChartCardSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}

export function ScoreBadge({ score }) {
  return <span className={`font-semibold tabular-nums ${scoreColorClass(score)}`}>{score != null ? `${clampPercent(score).toFixed(2)}%` : "-"}</span>;
}

export function StatusBadge({ label, variant = "default" }) {
  const variants = {
    success: "bg-green-500/10 text-green-500",
    warning: "bg-yellow-500/10 text-yellow-500",
    danger: "bg-red-500/10 text-red-500",
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
  if (value <= 2) return <StatusBadge label={`${value} warnings`} variant="warning" />;
  return <StatusBadge label={`${value} violations`} variant="danger" />;
}

export function AreaTrendChart({ data, xKey = "month", dataKey = "score", name = "Avg Score", refValue, refLabel, color = "var(--chart-1)" }) {
  if (!data?.length) return <EmptyState title="No trend data" description="Scores will appear here once tests are submitted." />;
  if (data.length === 1) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-2xl font-bold text-text-primary">{clampPercent(data[0][dataKey]).toFixed(1)}%</p>
        <p className="text-xs text-text-secondary">Trend needs 2+ tests</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="10%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <Tooltip content={<ChartTooltip />} cursor={CROSSHAIR} />
        {refValue != null ? (
          <ReferenceLine
            y={clampPercent(refValue)}
            stroke="var(--text-secondary)"
            strokeDasharray="4 3"
            strokeOpacity={0.5}
            label={{ value: refLabel || `Avg ${clampPercent(refValue).toFixed(1)}%`, fontSize: 10, fill: "var(--text-secondary)", position: "right" }}
          />
        ) : null}
        <Area
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke={color}
          strokeWidth={2}
          fill={`url(#grad-${dataKey})`}
          dot={{ r: 3, fill: color }}
          connectNulls
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LineTrendChart({ data, xKey = "month", dataKey = "score", name = "Avg Score", color = "var(--chart-2)" }) {
  if (!data?.length) return <EmptyState title="No trend data" description="Scores will appear after at least one submission." />;
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <Tooltip content={<ChartTooltip />} cursor={CROSSHAIR} />
        <Line
          type="linear"
          dataKey={dataKey}
          name={name}
          stroke={color}
          strokeWidth={2.5}
          dot={{ r: 4, fill: color, strokeWidth: 0 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GroupedBarChart({ data, series = [], xKey = "department", highlightCategory, onBarClick }) {
  if (!data?.length) return <EmptyState title="No comparison data" />;

  const rows = Array.isArray(data) ? data : [];
  const s = Array.isArray(series) && series.length ? series : [{ key: "avgScore", label: "Avg Score" }, { key: "passRate", label: "Pass Rate" }];

  // Colour follows the SERIES identity (its key), never its row index, so
  // filtering a series out never repaints the survivors.
  const seriesColor = createSeriesColorScale(s.map((ser) => ser.key));

  const toPct = (v) => {
    if (v == null || Number.isNaN(Number(v))) return 0;
    const n = Number(v);
    return clampPercent(n <= 1 ? n * 100 : n);
  };

  // Pre-normalise every series to a 0-100 percentage so bars are comparable.
  const chartData = rows.map((row) => {
    const normalized = { [xKey]: row[xKey] };
    s.forEach((ser) => {
      normalized[ser.key] = toPct(row[ser.key]);
    });
    return normalized;
  });

  // Horizontal bars read better with many long category names. Give each
  // category band enough room for its grouped series so nothing is squashed.
  const bandHeight = s.length * 18 + 20;
  const chartHeight = Math.max(180, rows.length * bandHeight + 56);
  const handleClick = onBarClick ? (entry) => entry && onBarClick(entry[xKey]) : undefined;

  return (
    <div className="w-full" style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} unit="%" />
          <YAxis type="category" dataKey={xKey} axisLine={false} tickLine={false} tick={AXIS_TICK} width={130} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          {s.map((ser) => (
            <Bar
              key={ser.key}
              dataKey={ser.key}
              name={ser.label}
              fill={seriesColor(ser.key)}
              radius={[0, 3, 3, 0]}
              isAnimationActive={false}
              onClick={handleClick}
              cursor={onBarClick ? "pointer" : undefined}
            >
              {chartData.map((row) => {
                const dim = highlightCategory && String(row[xKey] || "") !== String(highlightCategory);
                return <Cell key={`${ser.key}-${row[xKey]}`} fillOpacity={dim ? 0.35 : 1} />;
              })}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Nominal categories (topics, subjects) compared by magnitude.
 * ONE hue for every bar: bar length already encodes the value, so colouring by
 * value would double-encode and spend the identity channel for nothing.
 * A pass threshold is shown as a reference line + legend, not as per-bar hue.
 */
export function HorizontalBarChart({
  data,
  dataKey = "score",
  labelKey = "subject",
  height = "h-[200px]",
  threshold = null,
  thresholdLabel = "Pass mark",
}) {
  if (!data?.length) return <EmptyState title="No topic data" />;
  return (
    <div className={`${height} w-full`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, left: 24, bottom: 4 }}>
          <CartesianGrid {...gridProps} horizontal={false} />
          <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
          <YAxis type="category" dataKey={labelKey} axisLine={false} tickLine={false} tick={AXIS_TICK} width={88} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }} />
          {threshold != null ? (
            <ReferenceLine
              x={clampPercent(threshold)}
              stroke="var(--chart-axis)"
              label={{ value: thresholdLabel, fontSize: 10, fill: "var(--text-secondary)", position: "top" }}
            />
          ) : null}
          <Bar dataKey={dataKey} name="Score" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Topic / subject scores. These are INDEPENDENT magnitudes, not parts of a
 * whole — a pie would imply a share that does not exist — so they render as
 * bars. (Replaces the former TopicPieChart.)
 */
export function TopicBarChart({ data, labelKey = "subject", dataKey = "score", height = "h-[220px]", threshold = 40 }) {
  const rows = Array.isArray(data)
    ? data.map((item, index) => ({
        ...item,
        [labelKey]: item?.[labelKey] || item?.topic || item?.subject || `Topic ${index + 1}`,
        [dataKey]: clampPercent(item?.[dataKey]),
      }))
    : [];

  if (!rows.length) return <EmptyState title="No topic data" />;

  return (
    <HorizontalBarChart
      data={rows}
      labelKey={labelKey}
      dataKey={dataKey}
      height={height}
      threshold={threshold}
    />
  );
}

/** @deprecated Use TopicBarChart — scores are not part-to-whole. Alias kept so existing imports keep working. */
export const TopicPieChart = TopicBarChart;

/**
 * Score-band distribution. The bands are an ORDERED sequence, so they wear the
 * one-hue ordinal ramp (light -> dark), not categorical identity hues, and read
 * as a column histogram rather than a donut.
 */
export function ScoreDistributionChart({ data, total, height = "h-[220px]" }) {
  if (!data?.length) return <EmptyState title="No distribution data" />;
  const rows = data.map((item, index) => ({
    range: item.range,
    count: Number(item.count || 0),
    fill: ordinalColor(index, data.length),
  }));
  const totalStudents = Number(total || rows.reduce((sum, row) => sum + row.count, 0));

  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-text-primary">{totalStudents}</span>
        <span className="text-xs text-text-secondary">students scored</span>
      </div>
      <div className={`${height} w-full`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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

/** @deprecated Use ScoreDistributionChart. Alias kept so existing imports keep working. */
export const ScoreDonutChart = ScoreDistributionChart;

// Horizontal box-plot + five-number summary over the 0-100 score domain.
// `stats` is the API's distributionStats (or a describeDistribution() object):
// { count, mean, median, q1, q3, iqr, stdDev, min, max }.
export function DistributionSummary({ stats, height = "h-[220px]" }) {
  const s = stats || {};
  if (!Number(s.count)) {
    return <EmptyState title="No distribution data" description="Spread appears once students have submitted." />;
  }
  const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));
  const min = clamp(s.min);
  const max = clamp(s.max);
  const q1 = clamp(s.q1);
  const q3 = clamp(s.q3);
  const median = clamp(s.median);
  const mean = clamp(s.mean);

  const cells = [
    { label: "Median", value: `${median.toFixed(1)}%` },
    { label: "Mean", value: `${mean.toFixed(1)}%` },
    { label: "Std Dev", value: Number(s.stdDev || 0).toFixed(1) },
    { label: "IQR", value: `${Number(s.iqr || 0).toFixed(1)}` },
  ];

  return (
    <div className={`flex ${height} w-full flex-col justify-between`}>
      <div>
        {/* Box-plot: x maps score 0-100 directly onto the 0-100 viewBox. */}
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-20 w-full" role="img" aria-label={`Score spread: min ${min}, Q1 ${q1}, median ${median}, Q3 ${q3}, max ${max}`}>
          {/* whisker line */}
          <line x1={min} y1="15" x2={max} y2="15" stroke="var(--chart-axis, var(--border))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {/* min / max caps */}
          <line x1={min} y1="8" x2={min} y2="22" stroke="var(--text-secondary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <line x1={max} y1="8" x2={max} y2="22" stroke="var(--text-secondary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          {/* IQR box */}
          <rect x={Math.min(q1, q3)} y="6" width={Math.max(0.5, Math.abs(q3 - q1))} height="18" fill="var(--chart-1)" fillOpacity="0.18" stroke="var(--chart-1)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          {/* median */}
          <line x1={median} y1="6" x2={median} y2="24" stroke="var(--chart-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {/* mean (dashed) */}
          <line x1={mean} y1="4" x2={mean} y2="26" stroke="var(--chart-2)" strokeWidth="1.5" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-text-secondary">
          <span>{min.toFixed(0)}%</span>
          <span>range {(max - min).toFixed(0)} pts</span>
          <span>{max.toFixed(0)}%</span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-[10px] text-text-secondary">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--chart-1)" }} />median</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3" style={{ background: "var(--chart-2)" }} />mean</span>
          <span>n = {Number(s.count)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-xl border border-border bg-background px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{cell.label}</p>
            <p className="text-base font-bold tabular-nums text-text-primary">{cell.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TopicRadarChart({ data, labelKey = "subject", dataKey = "score", color = "var(--chart-1)" }) {
  if (!data?.length) return <EmptyState title="No topic data" />;
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <RadarChart data={data} margin={{ top: 10, right: 30, left: 30, bottom: 10 }}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey={labelKey} tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar name="Score" dataKey={dataKey} stroke={color} fill={color} fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />
        <Tooltip content={<ChartTooltip />} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function ExportButton({ exportState, onExport, onDownload, disabled, disabledReason }) {
  const { status, progress, downloadUrl, expiresAt, errorMessage } = exportState || {};

  const isExpired = expiresAt && new Date(expiresAt) < new Date();
  const nearExpiry = expiresAt && !isExpired && new Date(expiresAt).getTime() - Date.now() < 60 * 1000;

  if (status === "complete" && downloadUrl && !isExpired) {
    return (
      <div className="flex items-center gap-2">
        {nearExpiry ? <span className="text-xs text-yellow-500">Link expires soon</span> : null}
        <button
          type="button"
          onClick={onDownload}
          disabled={disabled}
          title={disabledReason || ""}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-green-500/10 px-4 py-2 text-sm font-semibold text-green-500 transition-colors hover:bg-green-500/20 disabled:cursor-not-allowed disabled:opacity-60"
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
        <span className="max-w-xs text-right text-xs font-medium text-red-500">{errorMessage}</span>
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

export function KpiRow({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map((item, index) => (
        <KpiCard key={item.key || item.label || index} {...item} />
      ))}
    </div>
  );
}

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

function MiniStat({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${tone || "text-text-primary"}`}>{value}</p>
    </div>
  );
}

export function TestListItem({ test, active, onClick }) {
  const avg = clampPercent(test?.avgScore);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition-colors ${active ? "border-chart-1 bg-chart-1/5" : "border-border bg-card hover:bg-muted/40"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text-primary">{test?.title || "Untitled test"}</p>
          <p className="mt-0.5 truncate text-xs text-text-secondary">{test?.department || "-"} · {test?.batch || "-"}</p>
        </div>
        <StatusBadge label={test?.status || "-"} variant={TEST_STATUS_VARIANT[test?.status] || "default"} />
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-chart-1" style={{ width: `${avg}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <MiniStat label="Avg" value={`${avg.toFixed(0)}%`} tone={scoreColorClass(avg)} />
        <MiniStat label="Part." value={`${clampPercent(test?.participation).toFixed(0)}%`} />
        <MiniStat label="Pass" value={`${clampPercent(test?.passRate).toFixed(0)}%`} />
        <MiniStat label="Viol." value={Number(test?.violations || 0)} tone={Number(test?.violations || 0) > 0 ? "text-red-500" : "text-green-500"} />
      </div>
    </button>
  );
}

export function DeepDiveHeader({ title, subtitle, status, onBack, right }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {onBack ? (
          <button type="button" onClick={onBack} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-card px-3 text-sm font-medium text-text-primary transition-colors hover:bg-muted">
            ← Back
          </button>
        ) : null}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-text-primary">{title}</h2>
            {status ? <StatusBadge label={status} variant={TEST_STATUS_VARIANT[status] || "default"} /> : null}
          </div>
          {subtitle ? <p className="text-xs text-text-secondary">{subtitle}</p> : null}
        </div>
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function DepartmentComparisonPanel({ rows = [], title = "Department comparison" }) {
  if (!rows.length) {
    return <ChartCard title={title} height="h-auto"><EmptyState title="No department data" description="Comparison appears once departments have submissions." /></ChartCard>;
  }
  const maxAvg = Math.max(...rows.map((row) => clampPercent(row.avgScore)), 1);
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-text-primary">{title}</h3>
      <div className="space-y-3">
        {rows.map((row, index) => {
          const avg = clampPercent(row.avgScore);
          return (
            <div key={row.department || row.departmentName || index} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-text-primary">{row.department || row.departmentName || "-"}</p>
                  <span className={`text-xs font-bold tabular-nums ${scoreColorClass(avg)}`}>{avg.toFixed(1)}%</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-chart-1" style={{ width: `${(avg / maxAvg) * 100}%` }} />
                </div>
              </div>
              <div className="text-right text-[11px] text-text-secondary">
                <p>pass {clampPercent(row.passRate).toFixed(0)}%</p>
                <p>part {clampPercent(row.participationRate ?? row.participation).toFixed(0)}%</p>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

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
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${up ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-500"}`}>
      <span className="text-[9px]">{up ? "▲" : "▼"}</span>
      {label}
    </span>
  );
}

const STAT_TONES = {
  navy: "bg-primary-dark text-white",
  primary: "bg-primary text-white",
  success: "bg-green-500 text-white",
  danger: "bg-red-500/10 text-red-500",
  warning: "bg-yellow-500/10 text-yellow-600",
};

export function StatCard({ icon, iconName, label, value, sub, trend, trendDir, badge, badgeTone = "muted", iconTone = "navy", flag }) {
  const badgeClasses = {
    success: "bg-green-500/10 text-green-600",
    danger: "bg-red-500/10 text-red-500",
    warning: "bg-yellow-500/10 text-yellow-600",
    info: "bg-primary/10 text-primary",
    muted: "bg-muted text-text-secondary",
  };
  return (
    <article className={`relative overflow-hidden rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-shadow hover:shadow-[0_4px_16px_rgba(16,24,40,0.06)] ${flag ? "border-red-500/50" : "border-border"}`}>
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
      <p className={`mt-1 text-3xl leading-none font-bold tabular-nums ${flag ? "text-red-500" : "text-text-primary"}`}>{value ?? "-"}</p>
      {sub ? <p className={`mt-1.5 text-xs ${flag ? "text-red-400" : "text-text-secondary"}`}>{sub}</p> : null}
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
  pass: { label: "PASS", dot: "bg-green-500", text: "text-green-600" },
  fail: { label: "FAIL", dot: "bg-red-500", text: "text-red-500" },
  graded: { label: "GRADED", dot: "bg-primary", text: "text-primary" },
  pending: { label: "PENDING", dot: "bg-yellow-500", text: "text-yellow-600" },
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

export function CategoryBadge({ label }) {
  if (!label) return <span className="text-text-secondary">-</span>;
  return (
    <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
      {label}
    </span>
  );
}

export function SectionCard({ title, subtitle, icon, right, className = "", bodyClassName = "", children }) {
  return (
    <article className={`rounded-2xl border border-border bg-card ${className}`}>
      {title || right ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div className="flex items-center gap-3">
            {icon ? <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div> : null}
            <div>
              <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
              {subtitle ? <p className="text-xs text-text-secondary">{subtitle}</p> : null}
            </div>
          </div>
          {right ? <div className="flex items-center gap-2">{right}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName || "p-5"}>{children}</div>
    </article>
  );
}

export function TabNav({ tabs = [], active, onChange }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange?.(tab.key)}
            className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-semibold transition-colors ${isActive ? "text-primary" : "text-text-secondary hover:text-text-primary"}`}
          >
            {tab.label}
            {isActive ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function VerticalBarChart({ data, xKey = "label", dataKey = "value", color = "var(--chart-1)", highlightIndex }) {
  if (!data?.length) return <EmptyState title="No trend data" description="Data appears once tests are submitted." />;
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
        <Bar dataKey={dataKey} name="Score" radius={[6, 6, 0, 0]} isAnimationActive={false} maxBarSize={44}>
          {data.map((entry, index) => (
            <Cell key={`${entry[xKey]}-${index}`} fill={color} opacity={highlightIndex != null && highlightIndex !== index ? 0.35 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function InsightCard({ title, message, action, icon }) {
  return (
    <article className="flex h-full flex-col justify-between rounded-2xl bg-primary-dark p-6 text-white">
      <div>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-yellow-300">
            {icon || <StatIcon name="alert" className="h-4 w-4" />}
          </span>
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/70">{message}</p>
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-primary-dark transition-colors hover:bg-white/90"
        >
          {action.label}
        </button>
      ) : null}
    </article>
  );
}

export function StudentIdentityCard({ student, stats }) {
  if (!student) return null;

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
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
          <p className="text-xs text-text-secondary">{student.studentId || "-"} · {student.department || "-"} · {student.batch || "-"}</p>
        </div>
        <div className="flex flex-wrap gap-8">
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums text-text-primary">{stats.avg != null ? `${Number(stats.avg).toFixed(1)}%` : "-"}</p>
            <p className="text-[11px] text-text-secondary">avg score</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums text-text-primary">#{stats.rank || "-"}</p>
            <p className="text-[11px] text-text-secondary">college rank</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold tabular-nums ${stats.violations > 2 ? "text-red-500" : stats.violations > 0 ? "text-yellow-500" : "text-green-500"}`}>
              {Number(stats.violations || 0)}
            </p>
            <p className="text-[11px] text-text-secondary">violations</p>
          </div>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Chart frame with a table-view twin.
//
// Every chart must be readable without colour: the toggle renders the same data
// as a table. This is also the relief channel that makes the three sub-3:1
// light-mode categorical slots legal. `busy` holds the previous render at
// reduced opacity during a refetch instead of flashing a skeleton.
// ---------------------------------------------------------------------------
export function ChartFrame({
  title,
  subtitle,
  height = "h-[240px]",
  busy = false,
  tableColumns = [],
  tableRows = [],
  right,
  children,
}) {
  const [showTable, setShowTable] = useState(false);
  const canToggle = tableColumns.length > 0 && tableRows.length > 0;

  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {subtitle ? <p className="text-xs text-text-secondary">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {right}
          {canToggle ? (
            <button
              type="button"
              onClick={() => setShowTable((value) => !value)}
              aria-pressed={showTable}
              className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-muted hover:text-text-primary"
            >
              {showTable ? "Chart" : "Table"}
            </button>
          ) : null}
        </div>
      </div>

      <div className={busy ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {showTable && canToggle ? (
          <div className="max-h-65 overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  {tableColumns.map((column) => (
                    <th
                      key={column.key}
                      className="sticky top-0 bg-card px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-widest text-text-secondary"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, index) => (
                  <tr key={row.id || index} className="border-t border-border/70">
                    {tableColumns.map((column) => (
                      <td key={column.key} className="px-3 py-2 tabular-nums text-text-primary">
                        {column.format ? column.format(row[column.key], row) : row[column.key] ?? "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={`${height} min-h-0 w-full min-w-0`}>{children}</div>
        )}
      </div>
    </article>
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
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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

/** Compact trend for stat tiles. No axes, no legend — the tile label names it. */
export function Sparkline({ data = [], dataKey = "value", color = CHART_COLORS[0], height = 36 }) {
  if (!Array.isArray(data) || data.length < 2) return null;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Deviation from a baseline (e.g. department vs college average).
 * Diverging encoding: two opposite hues around a neutral zero line — the sign
 * is the point, so it must not wear categorical identity hues.
 */
export function DivergingBar({ rows = [], labelKey = "label", valueKey = "delta", baselineLabel = "College avg" }) {
  if (!rows.length) return <EmptyState title="No comparison data" />;
  const magnitude = Math.max(1, ...rows.map((row) => Math.abs(Number(row[valueKey] || 0))));

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-secondary">Deviation from {baselineLabel}</p>
      {rows.map((row) => {
        const value = Number(row[valueKey] || 0);
        const width = (Math.abs(value) / magnitude) * 50;
        const positive = value >= 0;
        return (
          <div key={row.id || row[labelKey]} className="flex items-center gap-3">
            <span className="w-32 truncate text-xs text-text-primary">{row[labelKey]}</span>
            <div className="relative h-4 flex-1">
              <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--chart-axis)]" />
              <span
                className="absolute inset-y-0 rounded-[4px]"
                style={{
                  width: `${width}%`,
                  left: positive ? "50%" : `${50 - width}%`,
                  background: positive ? DIVERGING.positive : DIVERGING.negative,
                }}
              />
            </div>
            <span className="w-14 text-right text-xs font-semibold tabular-nums text-text-primary">
              {positive ? "+" : ""}{value.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Topic x cohort grid. Sequential magnitude on the ordinal ramp + value labels. */
export function HeatmapGrid({ rows = [], columns = [], getValue, rowLabel = (row) => row.label }) {
  if (!rows.length || !columns.length) return <EmptyState title="No heatmap data" />;

  return (
    <div className="overflow-auto">
      <table className="min-w-full border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-widest text-text-secondary">Topic</th>
            {columns.map((column) => (
              <th key={column.key} className="px-2 py-1 text-center text-[11px] font-semibold text-text-secondary">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id || rowLabel(row)}>
              <td className="px-2 py-1 text-xs font-medium text-text-primary">{rowLabel(row)}</td>
              {columns.map((column) => {
                const value = clampPercent(getValue(row, column));
                const step = Math.min(4, Math.floor((value / 100) * 5));
                return (
                  <td key={column.key} className="p-0">
                    <div
                      className="flex h-9 min-w-14 items-center justify-center rounded-[4px] text-[11px] font-semibold tabular-nums"
                      style={{ background: ordinalColor(step, 5), color: step >= 2 ? "#ffffff" : "var(--text-primary)" }}
                      title={`${rowLabel(row)} · ${column.label}: ${value.toFixed(1)}%`}
                    >
                      {value.toFixed(0)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Before -> after per entity. One hue, two shades (not two identities). */
export function DumbbellChart({ rows = [], labelKey = "label", fromKey = "before", toKey = "after" }) {
  if (!rows.length) return <EmptyState title="No comparison data" />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-text-secondary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--ordinal-2)" }} /> Before
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--ordinal-5)" }} /> After
        </span>
      </div>
      {rows.map((row) => {
        const before = clampPercent(row[fromKey]);
        const after = clampPercent(row[toKey]);
        const left = Math.min(before, after);
        const width = Math.abs(after - before);
        return (
          <div key={row.id || row[labelKey]} className="flex items-center gap-3">
            <span className="w-32 truncate text-xs text-text-primary">{row[labelKey]}</span>
            <div className="relative h-4 flex-1">
              <span className="absolute inset-y-0 my-auto h-px w-full bg-[var(--chart-grid)]" />
              <span className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded" style={{ left: `${left}%`, width: `${width}%`, background: "var(--ordinal-3)" }} />
              <span className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ring-2 ring-card" style={{ left: `calc(${before}% - 5px)`, background: "var(--ordinal-2)" }} />
              <span className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ring-2 ring-card" style={{ left: `calc(${after}% - 5px)`, background: "var(--ordinal-5)" }} />
            </div>
            <span
              className="w-16 text-right text-xs font-semibold tabular-nums"
              style={{ color: after >= before ? STATUS_COLORS.good : STATUS_COLORS.critical }}
            >
              {after >= before ? "+" : ""}{(after - before).toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Difficulty x discrimination scatter for item analysis.
 * All-pairs CVD applies to scatter, so this stays a SINGLE series and uses
 * position plus a reserved status hue for flagged items, never many hues.
 */
export function ItemQualityScatter({ items = [], onSelect }) {
  if (!items.length) return <EmptyState title="No item data" />;
  const points = items.map((item) => ({
    ...item,
    x: clampPercent(Number(item.difficulty || 0) * 100),
    y: Number(item.discrimination || 0),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <ScatterChart margin={{ top: 8, right: 16, left: -18, bottom: 8 }}>
        <CartesianGrid {...gridProps} />
        <XAxis type="number" dataKey="x" name="Difficulty" domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <YAxis type="number" dataKey="y" name="Discrimination" domain={[-0.4, 1]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <ZAxis range={[70, 70]} />
        <ReferenceLine y={0.2} stroke="var(--chart-axis)" label={{ value: "weak", fontSize: 10, fill: "var(--text-secondary)", position: "right" }} />
        <Tooltip
          cursor={{ stroke: "var(--chart-axis)" }}
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
                <p className="font-semibold text-text-primary">Q{payload[0].payload.order}</p>
                <p className="text-text-secondary">difficulty {payload[0].payload.x.toFixed(0)}%</p>
                <p className="text-text-secondary">discrimination {payload[0].payload.y.toFixed(2)}</p>
              </div>
            ) : null
          }
        />
        <Scatter data={points} isAnimationActive={false} onClick={(point) => onSelect?.(point)}>
          {points.map((point) => (
            <Cell
              key={point.questionId || point.order}
              fill={point.y < 0.2 ? STATUS_COLORS.critical : CHART_COLORS[0]}
              fillOpacity={0.85}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** Recent report-job exports with per-job download. Shared by all admin portals. */
export function RecentExports({ reports, onDownload, subtitle = "Generated PDFs for this workspace." }) {
  const rows = Array.isArray(reports) ? reports.slice(0, 4) : [];

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
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
    <article className="rounded-2xl border border-border bg-card p-5">
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
            {student.studentId || "-"} - {student.department || "-"} - {student.batch || "-"}
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
            <p className={`text-2xl font-bold ${toCount(metrics?.violations) > 0 ? "text-red-500" : "text-green-500"}`}>
              {toCount(metrics?.violations)}
            </p>
            <p className="text-[11px] text-text-secondary">violations</p>
          </div>
        </div>
      </div>
    </article>
  );
}
