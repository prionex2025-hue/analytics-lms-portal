const { computeIntegrityAnalytics, VIOLATION_TYPES } = require("../../services/integrity-analysis.service");

const START = new Date("2026-05-10T10:00:00.000Z");
const atMinute = (minutes) => new Date(START.getTime() + minutes * 60000).toISOString();

const submissions = [
  { id: "sub1", userId: "u1", studentName: "Asha", startedAt: START.toISOString(), scorePercent: 90 },
  { id: "sub2", userId: "u2", studentName: "Bala", startedAt: START.toISOString(), scorePercent: 70 },
  { id: "sub3", userId: "u3", studentName: "Chan", startedAt: START.toISOString(), scorePercent: 50 },
];

const violation = (submissionId, userId, type, minute) => ({
  submissionId,
  userId,
  type,
  timestamp: atMinute(minute),
});

describe("integrity analytics", () => {
  it("counts every violation type, reporting zeros for types that did not fire", () => {
    const { byType } = computeIntegrityAnalytics({
      violations: [
        violation("sub1", "u1", "TAB_SWITCH", 2),
        violation("sub2", "u2", "TAB_SWITCH", 5),
        violation("sub2", "u2", "COPY_PASTE", 6),
      ],
      submissions,
    });

    expect(byType).toHaveLength(VIOLATION_TYPES.length);
    expect(byType[0]).toMatchObject({ type: "TAB_SWITCH", count: 2 });
    expect(byType.find((row) => row.type === "COPY_PASTE").count).toBe(1);
    expect(byType.find((row) => row.type === "DEVTOOLS_OPEN").count).toBe(0);
    expect(byType[0].share).toBeCloseTo(66.67, 1);
  });

  it("buckets the timeline by elapsed minutes since each attempt started", () => {
    const { timeline } = computeIntegrityAnalytics({
      violations: [
        violation("sub1", "u1", "TAB_SWITCH", 1),
        violation("sub2", "u2", "TAB_SWITCH", 3),
        violation("sub3", "u3", "WINDOW_BLUR", 42),
      ],
      submissions,
      bucketMinutes: 5,
      durationMins: 60,
    });

    expect(timeline).toHaveLength(12);
    expect(timeline[0]).toMatchObject({ label: "0-5m", count: 2 });
    // minute 42 lands in the 40-45m bucket
    expect(timeline[8]).toMatchObject({ label: "40-45m", count: 1 });
  });

  it("identifies repeat offenders above the threshold", () => {
    const { repeatOffenders, summary } = computeIntegrityAnalytics({
      violations: [
        violation("sub1", "u1", "TAB_SWITCH", 1),
        violation("sub1", "u1", "COPY_PASTE", 2),
        violation("sub1", "u1", "DEVTOOLS_OPEN", 3),
        violation("sub2", "u2", "TAB_SWITCH", 4),
      ],
      submissions,
      repeatThreshold: 3,
    });

    expect(repeatOffenders).toHaveLength(1);
    expect(repeatOffenders[0]).toMatchObject({ studentId: "u1", count: 3 });
    expect(repeatOffenders[0].types).toEqual(expect.arrayContaining(["TAB_SWITCH", "COPY_PASTE", "DEVTOOLS_OPEN"]));
    expect(summary.repeatOffenders).toBe(1);
  });

  it("groups average score by violation band", () => {
    const { scoreByViolationBand, summary } = computeIntegrityAnalytics({
      violations: [
        violation("sub2", "u2", "TAB_SWITCH", 1),
        violation("sub3", "u3", "TAB_SWITCH", 1),
        violation("sub3", "u3", "COPY_PASTE", 2),
        violation("sub3", "u3", "RIGHT_CLICK", 3),
      ],
      submissions,
    });

    const clean = scoreByViolationBand.find((row) => row.band === "CLEAN");
    const low = scoreByViolationBand.find((row) => row.band === "LOW");
    const high = scoreByViolationBand.find((row) => row.band === "HIGH");

    expect(clean).toMatchObject({ attempts: 1, avgScore: 90 });
    expect(low).toMatchObject({ attempts: 1, avgScore: 70 });
    expect(high).toMatchObject({ attempts: 1, avgScore: 50 });
    expect(summary.flaggedAttempts).toBe(2);
    expect(summary.cleanAttempts).toBe(1);
    expect(summary.flaggedRate).toBeCloseTo(66.67, 1);
  });

  it("ignores violations recorded before the attempt started", () => {
    const { timeline, summary } = computeIntegrityAnalytics({
      violations: [violation("sub1", "u1", "TAB_SWITCH", -10)],
      submissions,
    });

    expect(summary.totalViolations).toBe(1);
    expect(timeline.every((bucket) => bucket.count === 0)).toBe(true);
  });
});
