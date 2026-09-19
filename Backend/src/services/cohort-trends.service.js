/**
 * Longitudinal / cohort trend analysis.
 *
 * Pure functions over plain rows. Series are reported on a single value scale
 * (percent) and optionally indexed to a common base, so two cohorts of very
 * different size never need a second y-axis.
 */

const toFinite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/**
 * Least-squares slope of score against position in the series.
 * Units: percentage points gained (or lost) per period.
 */
const linearSlope = (values = []) => {
  const points = values.filter((value) => Number.isFinite(value));
  const n = points.length;
  if (n < 2) return 0;

  const meanX = (n - 1) / 2;
  const meanY = points.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let denominator = 0;
  points.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });

  return denominator === 0 ? 0 : numerator / denominator;
};

const IMPROVING_THRESHOLD = 1.5; // percentage points per period
const DECLINING_THRESHOLD = -1.5;

const classifyTrend = (slope, pointCount) => {
  if (pointCount < 2) return "INSUFFICIENT_DATA";
  if (slope >= IMPROVING_THRESHOLD) return "IMPROVING";
  if (slope <= DECLINING_THRESHOLD) return "DECLINING";
  return "STABLE";
};

/**
 * Build one series per entity (department / batch / cohort) across ordered
 * periods.
 *
 * @param entities [{ id, name }]
 * @param points   [{ entityId, period, scorePercent }] — many rows per period
 * @param periods  ordered period labels; inferred from points when omitted
 */
const computeCohortTrends = ({ entities = [], points = [], periods = null, indexToBase = false } = {}) => {
  const orderedPeriods = periods && periods.length
    ? [...periods]
    : [...new Set(points.map((point) => String(point.period)))].sort();

  const byEntity = new Map();
  for (const point of points) {
    const key = String(point.entityId);
    if (!byEntity.has(key)) byEntity.set(key, new Map());
    const periodMap = byEntity.get(key);
    const period = String(point.period);
    if (!periodMap.has(period)) periodMap.set(period, []);
    periodMap.get(period).push(toFinite(point.scorePercent));
  }

  const series = entities.map((entity) => {
    const periodMap = byEntity.get(String(entity.id)) || new Map();
    const rawSeries = orderedPeriods.map((period) => {
      const values = periodMap.get(period) || [];
      const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      return { period, score: average == null ? null : Number(average.toFixed(2)), attempts: values.length };
    });

    const observed = rawSeries.filter((point) => point.score != null);
    const slope = linearSlope(observed.map((point) => point.score));
    const first = observed[0]?.score ?? null;
    const last = observed[observed.length - 1]?.score ?? null;

    // Indexing to 100 at the first observed period puts differently-scaled
    // cohorts on one axis instead of reaching for a second one.
    const indexed = indexToBase && first
      ? rawSeries.map((point) => ({
          ...point,
          score: point.score == null ? null : Number(((point.score / first) * 100).toFixed(2)),
        }))
      : rawSeries;

    return {
      entityId: entity.id,
      name: entity.name,
      series: indexed,
      periodsObserved: observed.length,
      firstScore: first,
      lastScore: last,
      delta: first != null && last != null ? Number((last - first).toFixed(2)) : null,
      slope: Number(slope.toFixed(3)),
      trend: classifyTrend(slope, observed.length),
    };
  });

  const improving = series.filter((row) => row.trend === "IMPROVING").length;
  const declining = series.filter((row) => row.trend === "DECLINING").length;

  return {
    periods: orderedPeriods,
    series,
    summary: {
      entities: series.length,
      periods: orderedPeriods.length,
      improving,
      declining,
      stable: series.filter((row) => row.trend === "STABLE").length,
      indexed: Boolean(indexToBase),
    },
  };
};

module.exports = {
  computeCohortTrends,
  linearSlope,
  classifyTrend,
  IMPROVING_THRESHOLD,
  DECLINING_THRESHOLD,
};
