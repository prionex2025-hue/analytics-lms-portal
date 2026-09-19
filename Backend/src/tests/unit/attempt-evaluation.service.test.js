const {
  normalizeEvaluationRule,
  prefersAttempt,
  evaluationOrderBy,
  dedupeByEvaluationRule,
} = require("../../services/attempt-evaluation.service");

describe("attempt-evaluation service", () => {
  it("normalizes evaluation rules (BEST_ATTEMPT default)", () => {
    expect(normalizeEvaluationRule("LAST_ATTEMPT")).toBe("LAST_ATTEMPT");
    expect(normalizeEvaluationRule("last_attempt")).toBe("LAST_ATTEMPT");
    expect(normalizeEvaluationRule("BEST_ATTEMPT")).toBe("BEST_ATTEMPT");
    expect(normalizeEvaluationRule("")).toBe("BEST_ATTEMPT");
    expect(normalizeEvaluationRule(undefined)).toBe("BEST_ATTEMPT");
  });

  it("orders by score for BEST_ATTEMPT and by time for LAST_ATTEMPT", () => {
    expect(evaluationOrderBy("BEST_ATTEMPT")).toEqual([{ score: "desc" }, { submittedAt: "desc" }]);
    expect(evaluationOrderBy("LAST_ATTEMPT")).toEqual([{ submittedAt: "desc" }]);
  });

  it("prefers the highest score under BEST_ATTEMPT, later attempt under LAST_ATTEMPT", () => {
    const early = { score: 9, submittedAt: "2026-01-01T10:00:00Z", attemptNumber: 1 };
    const late = { score: 5, submittedAt: "2026-01-02T10:00:00Z", attemptNumber: 2 };
    expect(prefersAttempt(early, late, "BEST_ATTEMPT")).toBe(true); // 9 > 5
    expect(prefersAttempt(early, late, "LAST_ATTEMPT")).toBe(false); // late is newer
  });

  it("dedupes to one attempt per (user,test) using each test's rule", () => {
    const submissions = [
      { userId: "u1", testId: "tBest", score: 4, submittedAt: "2026-01-01T10:00:00Z", attemptNumber: 1, test: { evaluationRule: "BEST_ATTEMPT" } },
      { userId: "u1", testId: "tBest", score: 8, submittedAt: "2026-01-02T10:00:00Z", attemptNumber: 2, test: { evaluationRule: "BEST_ATTEMPT" } },
      { userId: "u1", testId: "tBest", score: 6, submittedAt: "2026-01-03T10:00:00Z", attemptNumber: 3, test: { evaluationRule: "BEST_ATTEMPT" } },
      { userId: "u1", testId: "tLast", score: 9, submittedAt: "2026-01-01T10:00:00Z", attemptNumber: 1, test: { evaluationRule: "LAST_ATTEMPT" } },
      { userId: "u1", testId: "tLast", score: 3, submittedAt: "2026-01-04T10:00:00Z", attemptNumber: 2, test: { evaluationRule: "LAST_ATTEMPT" } },
      { userId: "u2", testId: "tBest", score: 7, submittedAt: "2026-01-01T10:00:00Z", attemptNumber: 1, test: { evaluationRule: "BEST_ATTEMPT" } },
    ];

    const result = dedupeByEvaluationRule(submissions);
    expect(result).toHaveLength(3); // (u1,tBest), (u1,tLast), (u2,tBest)

    const u1Best = result.find((s) => s.userId === "u1" && s.testId === "tBest");
    expect(u1Best.score).toBe(8); // highest score wins

    const u1Last = result.find((s) => s.userId === "u1" && s.testId === "tLast");
    expect(u1Last.score).toBe(3); // most recent wins even though score is lower
  });

  it("accepts a custom rule resolver", () => {
    const submissions = [
      { userId: "u1", testId: "t1", score: 4, submittedAt: "2026-01-02T10:00:00Z", attemptNumber: 2 },
      { userId: "u1", testId: "t1", score: 9, submittedAt: "2026-01-01T10:00:00Z", attemptNumber: 1 },
    ];
    const best = dedupeByEvaluationRule(submissions, () => "BEST_ATTEMPT");
    expect(best).toHaveLength(1);
    expect(best[0].score).toBe(9);
  });
});
