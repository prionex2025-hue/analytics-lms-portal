const { buildAggregateReportResponse } = require("../src/services/report-analytics-aggregation.service");

const students = [
  { id: "s1", fullName: "Alice", enrollNumber: "R1", collegeId: "c1", college: { name: "CollA" }, departmentId: "d1", department: { name: "CSE" }, batch: { name: "B1" }, year: 2 },
  { id: "s2", fullName: "Bob", enrollNumber: "R2", collegeId: "c1", college: { name: "CollA" }, departmentId: "d1", department: { name: "CSE" }, batch: { name: "B1" }, year: 2 },
  { id: "s3", fullName: "Cara", enrollNumber: "R3", collegeId: "c1", college: { name: "CollA" }, departmentId: "d2", department: { name: "ECE" }, batch: { name: "B2" }, year: 3 },
];
const tests = [{ id: "t1" }, { id: "t2" }];
const departments = [
  { id: "d1", name: "CSE", collegeId: "c1", college: { name: "CollA" } },
  { id: "d2", name: "ECE", collegeId: "c1", college: { name: "CollA" } },
];
const facet = {
  overall: [{ totalSubmissions: 5, avgScore: 70, passing: 4, violations: 2, attemptedCount: 2 }],
  byMonth: [{ month: "2026-01", score: 65 }, { month: "2026-02", score: 75 }],
  bySubject: [{ subject: "General", score: 60 }, { subject: "Math", score: 80 }],
  byDepartment: [{ _id: "d1", submissions: 4, avgScore: 72.5, passing: 3, violations: 2, attemptedCount: 2 }],
  byStudent: [
    { _id: "s1", attempts: 2, avgScore: 80, violations: 1 },
    { _id: "s2", attempts: 2, avgScore: 60, violations: 1 },
  ],
};

describe("buildAggregateReportResponse", () => {
  const result = buildAggregateReportResponse({ facet, students, tests, departments, filters: { collegeId: "c1" } });

  it("maps overall metrics", () => {
    expect(result.metrics).toMatchObject({
      totalStudents: 3,
      attemptedStudents: 2,
      totalTests: 2,
      totalSubmissions: 5,
      avgScore: 70,
      passRate: 80, // 4/5
      violations: 2,
    });
    expect(result.metrics.participationRate).toBeCloseTo(66.67, 1); // 2/3
  });

  it("ranks attempted students and appends non-attempters with null rank", () => {
    expect(result.tableRows.map((r) => [r.name, r.rank])).toEqual([
      ["Alice", 1],
      ["Bob", 2],
      ["Cara", null],
    ]);
  });

  it("builds score-band distribution and five-number summary", () => {
    const bands = Object.fromEntries(result.distribution.map((b) => [b.range, b.count]));
    expect(bands["61-80"]).toBe(1); // Alice 80
    expect(bands["41-60"]).toBe(1); // Bob 60
    expect(result.distributionStats).toMatchObject({ count: 2, median: 70, min: 60, max: 80, stdDev: 10 });
  });

  it("joins department comparatives and zero-fills departments with no submissions", () => {
    const cse = result.departmentRows.find((d) => d.department === "CSE");
    const ece = result.departmentRows.find((d) => d.department === "ECE");
    expect(cse).toMatchObject({ students: 2, submissions: 4, passRate: 75, participation: 100, violations: 2 });
    expect(ece).toMatchObject({ students: 1, submissions: 0, avgScore: 0, passRate: 0, violations: 0 });
  });

  it("passes through trend and sorts subjects by score desc", () => {
    expect(result.scoreTrend).toEqual([
      { month: "2026-01", score: 65 },
      { month: "2026-02", score: 75 },
    ]);
    expect(result.subjectPerformance.map((s) => s.subject)).toEqual(["Math", "General"]);
  });
});
