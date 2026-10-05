const {
  normalizeText,
  normalizeOptions,
  normalizeCorrectAnswer,
  generateQuestionFingerprint,
  calculateOptionSimilarity,
  calculatePromptSimilarity,
  calculateNumericalSimilarity,
  calculateSemanticSimilarity,
  classifySimilarity,
  validateOptionsWithinQuestion,
  detectDuplicates,
  detectDuplicatesInQuestionBank,
  detectDuplicatesInTest,
  detectDuplicatesAcrossQuestionBank,
  SIMILARITY_THRESHOLDS,
  FINGERPRINT_WEIGHTS,
} = require("../../services/duplicate-detection.service");

const models = require("../../models");

jest.mock("../../models", () => ({
  init: jest.fn(),
}));

describe("duplicate-detection.service", () => {
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb = {
      question: {
        findMany: jest.fn(),
      },
      questionBank: {
        findMany: jest.fn(),
      },
    };

    models.init.mockResolvedValue({ dbClient: mockDb });
  });

  describe("normalizeText", () => {
    test("normalizes basic text", () => {
      expect(normalizeText("Hello World")).toBe("hello world");
    });

    test("handles extra whitespace", () => {
      expect(normalizeText("  Hello    World  ")).toBe("hello world");
    });

    test("handles punctuation", () => {
      expect(normalizeText("Hello, World!")).toBe("hello world");
    });

    test("handles newlines and tabs", () => {
      expect(normalizeText("Hello\nWorld\t!")).toBe("hello world");
    });

    test("handles unicode", () => {
      expect(normalizeText("Héllo Wörld")).toBe("héllo wörld");
    });

    test("returns empty string for null/undefined", () => {
      expect(normalizeText(null)).toBe("");
      expect(normalizeText(undefined)).toBe("");
    });

    test("handles non-string input", () => {
      expect(normalizeText(123)).toBe("");
    });
  });

  describe("normalizeOptions", () => {
    test("normalizes and sorts options", () => {
      const options = ["Option B", "Option A", "Option C"];
      expect(normalizeOptions(options)).toEqual(["option a", "option b", "option c"]);
    });

    test("removes empty options", () => {
      const options = ["A", "", "B", "  "];
      expect(normalizeOptions(options)).toEqual(["a", "b"]);
    });

    test("handles duplicates", () => {
      const options = ["A", "a", "B"];
      expect(normalizeOptions(options)).toEqual(["a", "a", "b"]);
    });
  });

  describe("normalizeCorrectAnswer", () => {
    test("normalizes string answers", () => {
      expect(normalizeCorrectAnswer("Option A", "MCQ")).toBe("option a");
    });

    test("handles boolean answers", () => {
      expect(normalizeCorrectAnswer(true, "TRUE_FALSE")).toBe("true");
      expect(normalizeCorrectAnswer(false, "TRUE_FALSE")).toBe("false");
      expect(normalizeCorrectAnswer("true", "BOOLEAN")).toBe("true");
      expect(normalizeCorrectAnswer("false", "BOOLEAN")).toBe("false");
    });

    test("returns empty for null/undefined", () => {
      expect(normalizeCorrectAnswer(null, "MCQ")).toBe("");
      expect(normalizeCorrectAnswer(undefined, "MCQ")).toBe("");
    });
  });

  describe("generateQuestionFingerprint", () => {
    test("generates consistent fingerprint for same question", () => {
      const q1 = {
        prompt: "What is 2+2?",
        options: ["4", "5", "6"],
        correctOption: "4",
        type: "MCQ",
      };
      const q2 = {
        prompt: "What is 2+2?",
        options: ["4", "5", "6"],
        correctOption: "4",
        type: "MCQ",
      };
      expect(generateQuestionFingerprint(q1)).toBe(generateQuestionFingerprint(q2));
    });

    test("generates different fingerprint for different options order", () => {
      const q1 = {
        prompt: "What is 2+2?",
        options: ["4", "5", "6"],
        correctOption: "4",
        type: "MCQ",
      };
      const q2 = {
        prompt: "What is 2+2?",
        options: ["6", "5", "4"],
        correctOption: "4",
        type: "MCQ",
      };
      expect(generateQuestionFingerprint(q1)).toBe(generateQuestionFingerprint(q2));
    });

    test("generates different fingerprint for different prompt", () => {
      const q1 = {
        prompt: "What is 2+2?",
        options: ["4", "5", "6"],
        correctOption: "4",
        type: "MCQ",
      };
      const q2 = {
        prompt: "What is 3+3?",
        options: ["4", "5", "6"],
        correctOption: "4",
        type: "MCQ",
      };
      expect(generateQuestionFingerprint(q1)).not.toBe(generateQuestionFingerprint(q2));
    });
  });

  describe("calculateOptionSimilarity", () => {
    test("returns 1.0 for identical options", () => {
      expect(calculateOptionSimilarity(["A", "B"], ["A", "B"])).toBe(1.0);
    });

    test("returns 1.0 for same options in different order", () => {
      expect(calculateOptionSimilarity(["A", "B"], ["B", "A"])).toBe(1.0);
    });

    test("returns 0.0 for completely different options", () => {
      expect(calculateOptionSimilarity(["A", "B"], ["C", "D"])).toBe(0.0);
    });

    test("returns 0.33 for partially overlapping options", () => {
      expect(calculateOptionSimilarity(["A", "B"], ["A", "C"])).toBeCloseTo(0.33);
    });

    test("handles empty arrays", () => {
      expect(calculateOptionSimilarity([], [])).toBe(1.0);
      expect(calculateOptionSimilarity(["A"], [])).toBe(0.0);
    });

    test("normalizes case and whitespace", () => {
      expect(calculateOptionSimilarity(["  Option A  "], ["OPTION A"])).toBe(1.0);
    });
  });

  describe("calculatePromptSimilarity", () => {
    test("returns 1.0 for identical prompts", () => {
      expect(calculatePromptSimilarity("What is 2+2?", "What is 2+2?")).toBe(1.0);
    });

    test("returns some similarity for similar prompts", () => {
      const sim = calculatePromptSimilarity("What is 2+2?", "What is 2 + 2 ?");
      expect(sim).toBeGreaterThan(0.3);
    });

    test("returns low similarity for different prompts", () => {
      const sim = calculatePromptSimilarity("What is 2+2?", "What is the capital of France?");
      expect(sim).toBeLessThan(0.5);
    });

    test("handles empty strings", () => {
      expect(calculatePromptSimilarity("", "")).toBe(1.0);
      expect(calculatePromptSimilarity("", "test")).toBe(0.0);
    });
  });

  describe("calculateNumericalSimilarity", () => {
    test("returns 1.0 for same numbers", () => {
      expect(calculateNumericalSimilarity("Train 150m in 12s", "Train 150 m in 12 sec")).toBe(1.0);
    });

    test("returns 0.0 for different numbers", () => {
      expect(calculateNumericalSimilarity("150 meters", "200 meters")).toBe(0.0);
    });

    test("returns 1.0 for no numbers in either", () => {
      expect(calculateNumericalSimilarity("What is this?", "What is that?")).toBe(1.0);
    });

    test("returns 0.0 for numbers in one but not other", () => {
      expect(calculateNumericalSimilarity("150 meters", "some text")).toBe(0.0);
    });
  });

  describe("calculateSemanticSimilarity", () => {
    test("returns some similarity for semantically equivalent questions", () => {
      const q1 = {
        prompt: "A train 150 meters long passes a pole in 12 seconds. Find its speed.",
        options: ["45 km/h", "50 km/h", "54 km/h", "60 km/h"],
        correctOption: "54 km/h",
        type: "MCQ",
      };
      const q2 = {
        prompt: "A 150 m train crosses a telegraph post in 12 seconds. Calculate the train's speed.",
        options: ["60 km/h", "54 km/h", "45 km/h", "50 km/h"],
        correctOption: "54 km/h",
        type: "MCQ",
      };
      const result = calculateSemanticSimilarity(q1, q2);
      expect(result.overall).toBeGreaterThan(0.2);
      expect(result.prompt).toBeGreaterThan(0.2);
      expect(result.options).toBe(1.0);
    });

    test("returns low similarity for different questions", () => {
      const q1 = {
        prompt: "Find the missing term: 2, 6, 12, 20, ?, 42.",
        options: ["30", "32", "34", "36"],
        correctOption: "30",
        type: "MCQ",
      };
      const q2 = {
        prompt: "Complete the series: 3, 9, 27, 81, ?.",
        options: ["243", "162", "108", "54"],
        correctOption: "243",
        type: "MCQ",
      };
      const result = calculateSemanticSimilarity(q1, q2);
      expect(result.overall).toBeLessThan(SIMILARITY_THRESHOLDS.POTENTIAL);
    });

    test("returns 0 for different question types", () => {
      const q1 = { type: "MCQ", prompt: "Test", options: ["A", "B"], correctOption: "A" };
      const q2 = { type: "TRUE_FALSE", prompt: "Test", options: [], correctBoolean: true };
      const result = calculateSemanticSimilarity(q1, q2);
      expect(result.overall).toBe(0);
    });
  });

  describe("classifySimilarity", () => {
    test("classifies exact matches", () => {
      expect(classifySimilarity(1.0)).toBe("exact");
    });

    test("classifies high confidence", () => {
      expect(classifySimilarity(0.95)).toBe("high_confidence");
    });

    test("classifies potential duplicates", () => {
      expect(classifySimilarity(0.90)).toBe("potential");
    });

    test("classifies distinct questions", () => {
      expect(classifySimilarity(0.80)).toBe("distinct");
    });
  });

  describe("validateOptionsWithinQuestion", () => {
    test("detects duplicate options", () => {
      const question = {
        type: "mcq",
        options: ["A", "B", "A"],
        correctOption: "A",
      };
      const errors = validateOptionsWithinQuestion(question);
      expect(errors.some(e => e.type === "duplicate_option")).toBe(true);
    });

    test("detects case-insensitive duplicate options", () => {
      const question = {
        type: "mcq",
        options: ["A", "a", "B"],
        correctOption: "A",
      };
      const errors = validateOptionsWithinQuestion(question);
      expect(errors.some(e => e.type === "duplicate_option")).toBe(true);
    });

    test("detects correct answer mismatch", () => {
      const question = {
        type: "mcq",
        options: ["A", "B"],
        correctOption: "C",
      };
      const errors = validateOptionsWithinQuestion(question);
      expect(errors.some(e => e.type === "correct_answer_mismatch")).toBe(true);
    });

    test("detects insufficient options for MCQ", () => {
      const question = {
        type: "mcq",
        options: ["A"],
        correctOption: "A",
      };
      const errors = validateOptionsWithinQuestion(question);
      expect(errors.some(e => e.type === "insufficient_options")).toBe(true);
    });

    test("detects insufficient options for MCQ_MULTI", () => {
      const question = {
        type: "mcq_multi",
        options: ["A", "B"],
        correctOption: "A",
      };
      const errors = validateOptionsWithinQuestion(question);
      expect(errors.some(e => e.type === "insufficient_options")).toBe(true);
    });

    test("passes valid MCQ", () => {
      const question = {
        type: "mcq",
        options: ["A", "B", "C"],
        correctOption: "A",
      };
      const errors = validateOptionsWithinQuestion(question);
      expect(errors.length).toBe(0);
    });

    test("passes valid TRUE_FALSE", () => {
      const question = {
        type: "true_false",
        options: [],
        correctBoolean: true,
      };
      const errors = validateOptionsWithinQuestion(question);
      expect(errors.length).toBe(0);
    });
  });

  describe("detectDuplicates", () => {
    test("detects exact duplicates in question bank", async () => {
      const collegeId = "college1";
      const questions = [{
        prompt: "What is 2+2?",
        options: ["4", "5", "6"],
        correctOption: "4",
        type: "MCQ",
        marks: 1,
        difficulty: "EASY",
      }];

      mockDb.question.findMany
        .mockResolvedValueOnce([{
          id: "q1",
          prompt: "What is 2+2?",
          options: ["4", "5", "6"],
          correctOption: "4",
          type: "MCQ",
          marks: 1,
          normalizedPrompt: "what is 2 2",
          fingerprint: "abc123",
        }])
        .mockResolvedValueOnce([]);

      const result = await detectDuplicates(questions, { collegeId, checkSemantic: false });
      expect(result.valid).toBe(false);
      expect(result.results[0].exactDuplicate).toBeTruthy();
    });

    test("detects semantic duplicates", async () => {
      const collegeId = "college1";
      const questions = [{
        prompt: "A train 150 meters long passes a pole in 12 seconds. Find its speed.",
        options: ["45 km/h", "50 km/h", "54 km/h", "60 km/h"],
        correctOption: "54 km/h",
        type: "MCQ",
        marks: 1,
        difficulty: "MEDIUM",
      }];

      mockDb.question.findMany.mockResolvedValueOnce([{
        id: "q1",
        prompt: "A train 150 meters long passes a pole in 12 seconds. Calculate its speed.",
        options: ["60 km/h", "54 km/h", "45 km/h", "50 km/h"],
        correctOption: "54 km/h",
        type: "MCQ",
        marks: 1,
        normalizedPrompt: "a train 150 meters long passes a pole in 12 seconds calculate its speed",
        difficulty: "MEDIUM",
        category: null,
      }]);

      const result = await detectDuplicates(questions, { collegeId, checkExact: false });
      expect(result.results[0].semanticDuplicates.length).toBeGreaterThan(0);
    });

    test("validates options within question", async () => {
      const collegeId = "college1";
      const questions = [{
        prompt: "Test?",
        options: ["A", "A", "B"],
        correctOption: "A",
        type: "MCQ",
        marks: 1,
        difficulty: "EASY",
      }];

      mockDb.question.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await detectDuplicates(questions, { collegeId, checkSemantic: false });
      expect(result.results[0].optionErrors.length).toBeGreaterThan(0);
      expect(result.results[0].optionErrors[0].type).toBe("duplicate_option");
    });

    test("allows unique questions", async () => {
      const collegeId = "college1";
      const questions = [{
        prompt: "What is 2+2?",
        options: ["4", "5", "6"],
        correctOption: "4",
        type: "MCQ",
        marks: 1,
        difficulty: "EASY",
      }];

      mockDb.question.findMany.mockResolvedValueOnce([]);
      mockDb.question.findMany.mockResolvedValueOnce([]);

      const result = await detectDuplicates(questions, { collegeId });
      expect(result.valid).toBe(true);
      expect(result.summary.valid).toBe(1);
    });
  });
});