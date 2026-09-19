const { scoreSubmissionData } = require("../../services/test.service");

const MODULE_TEST = {
  assessmentFormat: "MODULE_TEST",
  negativeMarkingEnabled: false,
  modules: [
    { key: "QUANT", name: "Quantitative Aptitude", order: 1, category: "Quantitative Aptitude", durationMins: 30 },
    { key: "REASONING", name: "Logical Reasoning", order: 2, category: "Logical Reasoning", durationMins: 25 },
    { key: "VERBAL", name: "Verbal", order: 3, category: "Verbal", durationMins: 20 },
  ],
  questions: [
    { id: "q1", type: "MCQ", correctOption: "A", marks: 2, category: "Quantitative Aptitude" },
    { id: "q2", type: "MCQ", correctOption: "B", marks: 3, category: "Quantitative Aptitude" },
    { id: "q3", type: "TRUE_FALSE", correctBoolean: true, marks: 5, category: "Logical Reasoning" },
    { id: "q4", type: "FILL_BLANK", correctText: "cat", marks: 4, category: "Verbal" },
  ],
};

describe("MODULE_TEST scoring", () => {
  it("scores each question against its own module and aggregates overall", () => {
    const answers = [
      { questionId: "q1", selectedOption: "A" }, // correct  +2
      { questionId: "q2", selectedOption: "A" }, // wrong     0
      { questionId: "q3", answerBoolean: true }, // correct  +5
      { questionId: "q4", answerText: "dog" }, // wrong       0
    ];

    const result = scoreSubmissionData(MODULE_TEST, answers);

    expect(result.sections).toHaveLength(3);
    const [quant, reasoning, verbal] = result.sections;

    expect(quant).toMatchObject({ key: "QUANT", score: 2, maxScore: 5, percentage: 40, questionCount: 2, answeredCount: 2 });
    expect(reasoning).toMatchObject({ key: "REASONING", score: 5, maxScore: 5, percentage: 100 });
    expect(verbal).toMatchObject({ key: "VERBAL", score: 0, maxScore: 4, percentage: 0 });

    expect(result.overallScore).toBe(7);
    expect(result.overallMaxScore).toBe(14);
    expect(result.overallPercentage).toBe(50);
    expect(result.score).toBe(7);
    expect(result.accuracy).toBe(50);
  });

  it("preserves module order regardless of question ordering", () => {
    const shuffled = {
      ...MODULE_TEST,
      questions: [MODULE_TEST.questions[3], MODULE_TEST.questions[0], MODULE_TEST.questions[2], MODULE_TEST.questions[1]],
    };
    const result = scoreSubmissionData(shuffled, []);
    expect(result.sections.map((s) => s.key)).toEqual(["QUANT", "REASONING", "VERBAL"]);
    expect(result.overallScore).toBe(0);
    expect(result.overallMaxScore).toBe(14);
  });

  it("applies negative marking per module without dropping a module below zero", () => {
    const test = {
      ...MODULE_TEST,
      negativeMarkingEnabled: true,
      negativeMarks: 10,
    };
    const answers = [
      { questionId: "q1", selectedOption: "Z" }, // wrong -> -10, module clamps to 0
      { questionId: "q2", selectedOption: "Z" }, // wrong -> -10
    ];
    const result = scoreSubmissionData(test, answers);
    const quant = result.sections.find((s) => s.key === "QUANT");
    expect(quant.score).toBe(0);
    expect(result.overallScore).toBe(0);
  });

  it("keeps the legacy OPEN_TEST shape when not a module test", () => {
    const openTest = {
      assessmentFormat: "OPEN_TEST",
      questions: [
        { id: "q1", type: "MCQ", correctOption: "A", marks: 5 },
        { id: "q2", type: "MCQ", correctOption: "B", marks: 5 },
      ],
    };
    const result = scoreSubmissionData(openTest, [{ questionId: "q1", selectedOption: "A" }]);
    expect(result).toEqual({ score: 5, accuracy: 50, completion: 50, totalQuestions: 2 });
    expect(result.sections).toBeUndefined();
  });
});
