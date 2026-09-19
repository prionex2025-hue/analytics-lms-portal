const { computeItemAnalysis } = require("../../services/item-analysis.service");

const question = (id, overrides = {}) => ({
  id,
  order: Number(String(id).replace(/\D/g, "")) || 1,
  prompt: `Question ${id}`,
  type: "MCQ",
  options: ["A", "B", "C", "D"],
  correctOption: "A",
  marks: 1,
  ...overrides,
});

// 8 submissions ranked by score so the 27% split yields ~2 per group.
const submissions = [
  { id: "s1", scorePercent: 95 },
  { id: "s2", scorePercent: 88 },
  { id: "s3", scorePercent: 74 },
  { id: "s4", scorePercent: 66 },
  { id: "s5", scorePercent: 58 },
  { id: "s6", scorePercent: 44 },
  { id: "s7", scorePercent: 30 },
  { id: "s8", scorePercent: 18 },
];

const answer = (submissionId, questionId, isCorrect, overrides = {}) => ({
  submissionId,
  questionId,
  selectedOption: isCorrect ? "A" : "B",
  isCorrect,
  timeSpentSeconds: 30,
  markedForReview: false,
  ...overrides,
});

describe("item analysis", () => {
  it("computes difficulty as the proportion correct (higher = easier)", () => {
    const answers = [
      answer("s1", "q1", true),
      answer("s2", "q1", true),
      answer("s3", "q1", true),
      answer("s4", "q1", false),
    ];

    const { items } = computeItemAnalysis({ questions: [question("q1")], submissions, answers });
    expect(items[0].attempts).toBe(4);
    expect(items[0].correct).toBe(3);
    expect(items[0].difficulty).toBeCloseTo(0.75, 4);
    expect(items[0].difficultyLabel).toBe("MODERATE");
  });

  it("computes a positive discrimination when strong candidates outperform weak ones", () => {
    // Top scorers correct, bottom scorers wrong -> D should be strongly positive.
    const answers = [
      answer("s1", "q1", true),
      answer("s2", "q1", true),
      answer("s7", "q1", false),
      answer("s8", "q1", false),
    ];

    const { items } = computeItemAnalysis({ questions: [question("q1")], submissions, answers });
    expect(items[0].discrimination).toBeCloseTo(1, 4);
    expect(items[0].discriminationLabel).toBe("EXCELLENT");
    expect(items[0].flagged).toBe(false);
  });

  it("flags a negatively discriminating item (likely miskeyed)", () => {
    // Inverted: weak candidates correct, strong candidates wrong.
    const answers = [
      answer("s1", "q1", false),
      answer("s2", "q1", false),
      answer("s7", "q1", true),
      answer("s8", "q1", true),
    ];

    const { items } = computeItemAnalysis({ questions: [question("q1")], submissions, answers });
    expect(items[0].discrimination).toBeCloseTo(-1, 4);
    expect(items[0].discriminationLabel).toBe("NEGATIVE");
    expect(items[0].flagged).toBe(true);
    expect(items[0].flagReasons).toContain("NEGATIVE_DISCRIMINATION");
  });

  it("builds a distractor distribution and flags a distractor that beats the key", () => {
    const answers = [
      answer("s1", "q1", false, { selectedOption: "C" }),
      answer("s2", "q1", false, { selectedOption: "C" }),
      answer("s3", "q1", false, { selectedOption: "C" }),
      answer("s4", "q1", true, { selectedOption: "A" }),
    ];

    const { items } = computeItemAnalysis({ questions: [question("q1")], submissions, answers });
    const optionC = items[0].distractors.find((option) => option.option === "C");
    const optionA = items[0].distractors.find((option) => option.option === "A");

    expect(optionC.count).toBe(3);
    expect(optionC.share).toBeCloseTo(75, 2);
    expect(optionC.isCorrect).toBe(false);
    expect(optionA.isCorrect).toBe(true);
    expect(items[0].topDistractor).toBe("C");
    expect(items[0].flagReasons).toContain("DISTRACTOR_BEATS_KEY");
  });

  it("reports median time and marked-for-review rate", () => {
    const answers = [
      answer("s1", "q1", true, { timeSpentSeconds: 10 }),
      answer("s2", "q1", true, { timeSpentSeconds: 20, markedForReview: true }),
      answer("s3", "q1", true, { timeSpentSeconds: 90 }),
    ];

    const { items } = computeItemAnalysis({ questions: [question("q1")], submissions, answers });
    expect(items[0].medianTimeSeconds).toBe(20);
    expect(items[0].markedForReviewRate).toBeCloseTo(33.33, 1);
  });

  it("marks discrimination unusable when there are too few attempts to split", () => {
    const { items, summary } = computeItemAnalysis({
      questions: [question("q1")],
      submissions: [{ id: "s1", scorePercent: 90 }],
      answers: [answer("s1", "q1", true)],
    });

    expect(items[0].discriminationLabel).toBe("INSUFFICIENT_DATA");
    expect(summary.groupSplitUsable).toBe(false);
  });

  it("summarises across questions and returns them in order", () => {
    const answers = [
      answer("s1", "q2", true),
      answer("s2", "q2", true),
      answer("s1", "q1", false),
      answer("s2", "q1", false),
      answer("s7", "q1", false),
      answer("s8", "q1", false),
    ];

    const { items, summary } = computeItemAnalysis({
      questions: [question("q2"), question("q1")],
      submissions,
      answers,
    });

    expect(items.map((item) => item.questionId)).toEqual(["q1", "q2"]);
    expect(summary.totalQuestions).toBe(2);
    expect(summary.analysedQuestions).toBe(2);
    // q1 was answered wrong by everyone -> very hard, so it is flagged.
    expect(summary.flaggedQuestions).toBeGreaterThanOrEqual(1);
  });
});
