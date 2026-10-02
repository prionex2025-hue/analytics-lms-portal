const {
  averageOf,
  passRateOf,
  participationRateOf,
  scoreStatsOf,
  resolveAttemptScore,
  normalizeEvaluationRule,
  classifyScoreBand,
  EVALUATION_RULE,
} = require("../../services/report-metrics.service");

describe("report metrics — no-data semantics", () => {
  it("returns null, not 0, when there are no observations", () => {
    expect(averageOf([])).toBeNull();
    expect(averageOf(null)).toBeNull();
    expect(passRateOf([])).toBeNull();
    expect(scoreStatsOf([])).toMatchObject({
      sampleSize: 0,
      average: null,
      passRate: null,
      median: null,
      highest: null,
      lowest: null,
      distribution: null,
    });
  });

  it("distinguishes a real zero from no data", () => {
    expect(averageOf([0])).toBe(0);
    expect(passRateOf([0])).toBe(0);
    expect(scoreStatsOf([0]).sampleSize).toBe(1);
  });

  it("computes average and pass rate over real observations", () => {
    expect(averageOf([40, 60, 80])).toBe(60);
    expect(passRateOf([40, 60, 80])).toBe(100);
    expect(passRateOf([20, 40, 60], 50)).toBeCloseTo(33.33, 1);
  });

  it("treats participation with no assigned tests as no data", () => {
    expect(participationRateOf({ attempted: 0, assigned: 0 })).toBeNull();
    expect(participationRateOf({ attempted: 0, assigned: null })).toBeNull();
    expect(participationRateOf({ attempted: 2, assigned: 4 })).toBe(50);
    expect(participationRateOf({ attempted: 0, assigned: 4 })).toBe(0);
  });

  it("summarizes a scored distribution", () => {
    const stats = scoreStatsOf([10, 20, 30, 40, 50]);
    expect(stats.sampleSize).toBe(5);
    expect(stats.average).toBe(30);
    expect(stats.median).toBe(30);
    expect(stats.lowest).toBe(10);
    expect(stats.highest).toBe(50);
    expect(stats.passRate).toBe(40);
  });
});

describe("report metrics — evaluation rule", () => {
  const attempts = [
    { scorePercent: 40, date: "2026-01-01" },
    { scorePercent: 80, date: "2026-02-01" },
    { scorePercent: 60, date: "2026-03-01" },
  ];

  it("normalizes unknown rules to BEST_ATTEMPT", () => {
    expect(normalizeEvaluationRule("nonsense")).toBe(EVALUATION_RULE.BEST_ATTEMPT);
    expect(normalizeEvaluationRule("latest-attempt")).toBe(EVALUATION_RULE.LATEST_ATTEMPT);
  });

  it("selects the representative score per rule", () => {
    expect(resolveAttemptScore(attempts, "BEST_ATTEMPT")).toBe(80);
    expect(resolveAttemptScore(attempts, "LATEST_ATTEMPT")).toBe(60);
    expect(resolveAttemptScore(attempts, "FIRST_ATTEMPT")).toBe(40);
    expect(resolveAttemptScore(attempts, "AVERAGE")).toBe(60);
  });

  it("is order-independent because it sorts by date", () => {
    const shuffled = [attempts[2], attempts[0], attempts[1]];
    expect(resolveAttemptScore(shuffled, "LATEST_ATTEMPT")).toBe(60);
  });

  it("returns null when no attempt has a score", () => {
    expect(resolveAttemptScore([], "BEST_ATTEMPT")).toBeNull();
    expect(resolveAttemptScore([{ date: "2026-01-01" }], "BEST_ATTEMPT")).toBeNull();
  });
});

describe("report metrics — score bands", () => {
  it("classifies by the shared thresholds", () => {
    expect(classifyScoreBand(null)).toBe("NO_DATA");
    expect(classifyScoreBand(undefined)).toBe("NO_DATA");
    expect(classifyScoreBand(39.9)).toBe("FAIL");
    expect(classifyScoreBand(40)).toBe("PASS");
    expect(classifyScoreBand(50)).toBe("HEALTHY");
    expect(classifyScoreBand(75)).toBe("DISTINCTION");
  });
});
