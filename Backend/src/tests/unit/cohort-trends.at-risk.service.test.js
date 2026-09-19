const { computeCohortTrends, linearSlope, classifyTrend } = require("../../services/cohort-trends.service");
const { computeAtRisk } = require("../../services/at-risk.service");

describe("cohort trends", () => {
  const entities = [
    { id: "d1", name: "CSE" },
    { id: "d2", name: "ECE" },
  ];

  const points = [
    { entityId: "d1", period: "2026-01", scorePercent: 70 },
    { entityId: "d1", period: "2026-01", scorePercent: 74 },
    { entityId: "d1", period: "2026-02", scorePercent: 78 },
    { entityId: "d1", period: "2026-03", scorePercent: 84 },
    { entityId: "d2", period: "2026-01", scorePercent: 72 },
    { entityId: "d2", period: "2026-02", scorePercent: 66 },
    { entityId: "d2", period: "2026-03", scorePercent: 60 },
  ];

  it("averages scores per period and orders the periods", () => {
    const { periods, series } = computeCohortTrends({ entities, points });
    expect(periods).toEqual(["2026-01", "2026-02", "2026-03"]);

    const cse = series.find((row) => row.entityId === "d1");
    // 70 and 74 in the first period -> 72
    expect(cse.series[0]).toMatchObject({ period: "2026-01", score: 72, attempts: 2 });
    expect(cse.series[2].score).toBe(84);
  });

  it("classifies improving and declining cohorts", () => {
    const { series, summary } = computeCohortTrends({ entities, points });
    expect(series.find((row) => row.entityId === "d1").trend).toBe("IMPROVING");
    expect(series.find((row) => row.entityId === "d2").trend).toBe("DECLINING");
    expect(summary.improving).toBe(1);
    expect(summary.declining).toBe(1);
  });

  it("reports the first-to-last delta", () => {
    const { series } = computeCohortTrends({ entities, points });
    expect(series.find((row) => row.entityId === "d1").delta).toBe(12);
    expect(series.find((row) => row.entityId === "d2").delta).toBe(-12);
  });

  it("indexes to a common base so different scales share one axis", () => {
    const { series } = computeCohortTrends({ entities, points, indexToBase: true });
    const cse = series.find((row) => row.entityId === "d1");
    expect(cse.series[0].score).toBe(100);
    // 84 / 72 * 100 = 116.67
    expect(cse.series[2].score).toBeCloseTo(116.67, 1);
  });

  it("marks a single data point as insufficient rather than guessing a trend", () => {
    const { series } = computeCohortTrends({
      entities: [{ id: "d1", name: "CSE" }],
      points: [{ entityId: "d1", period: "2026-01", scorePercent: 70 }],
    });
    expect(series[0].trend).toBe("INSUFFICIENT_DATA");
  });

  it("computes slope in points per period", () => {
    expect(linearSlope([10, 20, 30])).toBeCloseTo(10, 4);
    expect(linearSlope([30, 20, 10])).toBeCloseTo(-10, 4);
    expect(classifyTrend(0, 5)).toBe("STABLE");
  });
});

describe("at-risk detection", () => {
  const strongStudent = {
    id: "s1",
    name: "Strong",
    attempts: [
      { scorePercent: 82, date: "2026-01-01" },
      { scorePercent: 85, date: "2026-02-01" },
      { scorePercent: 88, date: "2026-03-01" },
    ],
    assignedTests: 3,
    violations: 0,
  };

  it("does not flag a healthy student", () => {
    const { students } = computeAtRisk({ students: [strongStudent] });
    expect(students).toHaveLength(0);
  });

  it("flags a failing average with an explaining reason", () => {
    const { students } = computeAtRisk({
      students: [{ id: "s2", name: "Weak", attempts: [{ scorePercent: 30, date: "2026-01-01" }], assignedTests: 1, violations: 0 }],
    });

    expect(students).toHaveLength(1);
    expect(students[0].reasons.map((reason) => reason.code)).toContain("FAILING_AVERAGE");
    expect(students[0].reasons[0].detail).toMatch(/30\.0%/);
  });

  it("flags a declining trend across enough attempts", () => {
    const { students } = computeAtRisk({
      students: [{
        id: "s3",
        name: "Slipping",
        attempts: [
          { scorePercent: 75, date: "2026-01-01" },
          { scorePercent: 62, date: "2026-02-01" },
          { scorePercent: 48, date: "2026-03-01" },
        ],
        assignedTests: 3,
        violations: 0,
      }],
    });

    expect(students[0].reasons.map((reason) => reason.code)).toContain("DECLINING");
    expect(students[0].trendSlope).toBeLessThan(0);
  });

  it("flags low participation and repeated violations", () => {
    const { students } = computeAtRisk({
      students: [{
        id: "s4",
        name: "Absent",
        attempts: [{ scorePercent: 80, date: "2026-01-01" }],
        assignedTests: 5,
        violations: 4,
      }],
    });

    const codes = students[0].reasons.map((reason) => reason.code);
    expect(codes).toContain("LOW_PARTICIPATION");
    expect(codes).toContain("VIOLATIONS");
    expect(students[0].participation).toBeCloseTo(20, 1);
  });

  it("ranks by risk score and escalates when signals corroborate", () => {
    const { students, summary } = computeAtRisk({
      students: [
        strongStudent,
        {
          id: "s5",
          name: "Critical",
          attempts: [
            { scorePercent: 35, date: "2026-01-01" },
            { scorePercent: 28, date: "2026-02-01" },
            { scorePercent: 20, date: "2026-03-01" },
          ],
          assignedTests: 6,
          violations: 5,
        },
        { id: "s6", name: "Borderline", attempts: [{ scorePercent: 50, date: "2026-01-01" }], assignedTests: 1, violations: 0 },
      ],
    });

    expect(students[0].studentId).toBe("s5");
    expect(students[0].riskLevel).toBe("CRITICAL");
    expect(summary.critical).toBe(1);
    // A weak signal on its own (average merely near the pass mark) stays below
    // the surfacing bar, so it never becomes noise in the admin's list.
    expect(students.find((student) => student.studentId === "s6")).toBeUndefined();
  });

  it("surfaces a single strong signal as MODERATE without escalating to CRITICAL", () => {
    const { students } = computeAtRisk({
      students: [{
        id: "s7",
        name: "Only declining",
        attempts: [
          { scorePercent: 75, date: "2026-01-01" },
          { scorePercent: 62, date: "2026-02-01" },
          { scorePercent: 48, date: "2026-03-01" },
        ],
        assignedTests: 3,
        violations: 0,
      }],
    });

    expect(students).toHaveLength(1);
    expect(students[0].riskLevel).toBe("MODERATE");
    expect(students[0].reasons.map((reason) => reason.code)).toEqual(["DECLINING"]);
  });
});
