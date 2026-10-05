const { ApiError } = require("../utils/http");
const models = require("../models");
const mongoose = require("mongoose");

const SIMILARITY_THRESHOLDS = {
  EXACT: 1.0,
  HIGH_CONFIDENCE: 0.92,
  POTENTIAL: 0.85,
};

const FINGERPRINT_WEIGHTS = {
  prompt: 0.6,
  options: 0.3,
  correctAnswer: 0.1,
};

function normalizeText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s\u00A0\u2000-\u200B\u3000]+/g, " ")
    .replace(/[.,;:!?+\-*/=()\[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt) => normalizeText(opt))
    .filter((opt) => opt.length > 0)
    .sort();
}

function normalizeCorrectAnswer(answer, type) {
  if (answer === null || answer === undefined) return "";
  const normalized = normalizeText(String(answer));
  if (type === "true_false" || type === "boolean") {
    return normalized === "true" ? "true" : "false";
  }
  return normalized;
}

function generateQuestionFingerprint(question) {
  const normalizedPrompt = normalizeText(question.prompt || question.question);
  const normalizedOpts = normalizeOptions(question.options);
  const normalizedCorrect = normalizeCorrectAnswer(
    question.correctOption || question.correctText || question.correctBoolean || question.correctAnswer,
    question.type
  );

  const promptHash = hashString(normalizedPrompt);
  const optionsHash = hashString(normalizedOpts.join("|"));
  const correctHash = hashString(normalizedCorrect);

  return `${promptHash}:${optionsHash}:${correctHash}`;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function calculateOptionSimilarity(options1, options2) {
  const set1 = new Set(normalizeOptions(options1));
  const set2 = new Set(normalizeOptions(options2));

  if (set1.size === 0 && set2.size === 0) return 1.0;
  if (set1.size === 0 || set2.size === 0) return 0.0;

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

function calculatePromptSimilarity(prompt1, prompt2) {
  const norm1 = normalizeText(prompt1);
  const norm2 = normalizeText(prompt2);

  if (norm1 === norm2) return 1.0;

  const words1 = new Set(norm1.split(" ").filter((w) => w.length > 2));
  const words2 = new Set(norm2.split(" ").filter((w) => w.length > 2));

  if (words1.size === 0 && words2.size === 0) return 1.0;
  if (words1.size === 0 || words2.size === 0) return 0.0;

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

function extractNumericalValues(text) {
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  return numbers ? numbers.map(Number).sort((a, b) => a - b) : [];
}

function calculateNumericalSimilarity(prompt1, prompt2) {
  const nums1 = extractNumericalValues(prompt1);
  const nums2 = extractNumericalValues(prompt2);

  if (nums1.length === 0 && nums2.length === 0) return 1.0;
  if (nums1.length === 0 || nums2.length === 0) return 0.0;

  const set1 = new Set(nums1);
  const set2 = new Set(nums2);
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

function calculateSemanticSimilarity(question1, question2) {
  if (question1.type !== question2.type) {
    return {
      overall: 0.0,
      prompt: 0.0,
      options: 0.0,
      numerical: 0.0,
      correctAnswer: 0.0,
    };
  }

  const promptSim = calculatePromptSimilarity(question1.prompt || question1.question, question2.prompt || question2.question);
  const optionSim = calculateOptionSimilarity(question1.options, question2.options);
  const numericalSim = calculateNumericalSimilarity(question1.prompt || question1.question, question2.prompt || question2.question);

  const correct1 = question1.correctOption || question1.correctText || question1.correctBoolean || question1.correctAnswer;
  const correct2 = question2.correctOption || question2.correctText || question2.correctBoolean || question2.correctAnswer;
  const correctSim = normalizeCorrectAnswer(correct1, question1.type) === normalizeCorrectAnswer(correct2, question2.type) ? 1.0 : 0.0;

  const weights = FINGERPRINT_WEIGHTS;
  const score = promptSim * weights.prompt + optionSim * weights.options + correctSim * weights.correctAnswer;

  const boostedScore = numericalSim > 0.5 ? Math.min(1.0, score + 0.1) : score;

  return {
    overall: boostedScore,
    prompt: promptSim,
    options: optionSim,
    numerical: numericalSim,
    correctAnswer: correctSim,
  };
}

function classifySimilarity(score) {
  if (score >= SIMILARITY_THRESHOLDS.EXACT) return "exact";
  if (score >= SIMILARITY_THRESHOLDS.HIGH_CONFIDENCE) return "high_confidence";
  if (score >= SIMILARITY_THRESHOLDS.POTENTIAL) return "potential";
  return "distinct";
}

async function findExactDuplicates(db, collegeId, questions, excludeQuestionIds = []) {
  if (!questions.length) return [];

  const fingerprints = questions.map((q) => generateQuestionFingerprint(q));
  const normalizedPrompts = questions.map((q) => normalizeText(q.prompt || q.question));

  const existingQuestions = await db.question.findMany({
    where: {
      collegeId,
      id: { notIn: excludeQuestionIds },
      OR: [
        { fingerprint: { in: fingerprints } },
        { normalizedPrompt: { in: normalizedPrompts } },
      ],
    },
    select: {
      id: true,
      prompt: true,
      type: true,
      options: true,
      correctOption: true,
      correctText: true,
      correctBoolean: true,
      marks: true,
      fingerprint: true,
      normalizedPrompt: true,
    },
  });

  const duplicates = [];
  const existingByFingerprint = new Map(existingQuestions.map((q) => [q.fingerprint, q]));
  const existingByPrompt = new Map(existingQuestions.map((q) => [q.normalizedPrompt, q]));

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const fingerprint = fingerprints[i];
    const normPrompt = normalizedPrompts[i];

    const exactMatch = existingByFingerprint.get(fingerprint) || existingByPrompt.get(normPrompt);
    if (exactMatch) {
      duplicates.push({
        index: i,
        type: "exact",
        existingQuestion: {
          id: exactMatch.id,
          prompt: exactMatch.prompt,
          type: exactMatch.type,
          options: exactMatch.options,
          correctOption: exactMatch.correctOption,
          correctText: exactMatch.correctText,
          correctBoolean: exactMatch.correctBoolean,
          marks: exactMatch.marks,
        },
        similarity: { overall: 1.0, prompt: 1.0, options: 1.0, correctAnswer: 1.0 },
      });
    }
  }

  return duplicates;
}

async function findSemanticDuplicates(db, collegeId, questions, excludeQuestionIds = [], scope = "questionBank", testId = null) {
  if (!questions.length) return [];

  const normalizedPrompts = questions.map((q) => normalizeText(q.prompt || q.question));
  const uniquePrompts = [...new Set(normalizedPrompts)];

  const whereClause = {
    collegeId,
    id: { notIn: excludeQuestionIds },
    normalizedPrompt: { notIn: uniquePrompts },
    isActive: true,
  };

  if (scope === "test" && testId) {
    whereClause.testId = testId;
  }

  const candidateQuestions = await db.question.findMany({
    where: whereClause,
    select: {
      id: true,
      prompt: true,
      type: true,
      options: true,
      correctOption: true,
      correctText: true,
      correctBoolean: true,
      marks: true,
      category: true,
      difficulty: true,
      normalizedPrompt: true,
    },
    take: 500,
  });

  const duplicates = [];

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const inputPrompt = normalizeText(question.prompt || question.question);

    for (const existing of candidateQuestions) {
      if (existing.normalizedPrompt === inputPrompt) continue;

      const similarity = calculateSemanticSimilarity(question, existing);
      const classification = classifySimilarity(similarity.overall);

      if (classification === "high_confidence" || classification === "potential") {
        duplicates.push({
          index: i,
          type: classification === "high_confidence" ? "high_confidence_semantic" : "potential_semantic",
          existingQuestion: {
            id: existing.id,
            prompt: existing.prompt,
            type: existing.type,
            options: existing.options,
            correctOption: existing.correctOption,
            correctText: existing.correctText,
            correctBoolean: existing.correctBoolean,
            marks: existing.marks,
            category: existing.category,
            difficulty: existing.difficulty,
          },
          similarity,
        });
      }
    }
  }

  return duplicates;
}

function validateOptionsWithinQuestion(question) {
  const errors = [];
  const normalizedOpts = normalizeOptions(question.options);
  const seen = new Map();

  for (let i = 0; i < question.options.length; i++) {
    const norm = normalizeText(question.options[i]);
    if (!norm) continue;
    if (seen.has(norm)) {
      errors.push({
        type: "duplicate_option",
        message: `Duplicate option detected: "${question.options[i]}" (matches option ${seen.get(norm) + 1})`,
        optionIndex: i,
        duplicateOfIndex: seen.get(norm),
      });
    } else {
      seen.set(norm, i);
    }
  }

  if (question.type === "mcq" || question.type === "mcq_multi" || question.type === "single_select" || question.type === "multi_select") {
    const correctAnswer = question.correctOption || question.correctAnswer;
    if (correctAnswer !== null && correctAnswer !== undefined && correctAnswer !== "") {
      const normCorrect = normalizeText(String(correctAnswer));
      const hasMatchingOption = normalizedOpts.some((opt) => opt === normCorrect);
      if (!hasMatchingOption) {
        errors.push({
          type: "correct_answer_mismatch",
          message: `Correct answer "${correctAnswer}" does not match any option`,
          correctAnswer,
        });
      }
    }

    const minOptions = question.type === "mcq_multi" || question.type === "multi_select" ? 3 : 2;
    if (normalizedOpts.length < minOptions) {
      errors.push({
        type: "insufficient_options",
        message: `${question.type.toUpperCase()} requires at least ${minOptions} unique options`,
        currentCount: normalizedOpts.length,
        required: minOptions,
      });
    }
  }

  return errors;
}

async function detectDuplicates(questions, options = {}) {
  const {
    collegeId,
    scope = "questionBank",
    testId = null,
    excludeQuestionIds = [],
    checkSemantic = true,
    checkExact = true,
    checkOptions = true,
  } = options;

  if (!Array.isArray(questions) || questions.length === 0) {
    return {
      valid: true,
      results: [],
      summary: { total: 0, valid: 0, exactDuplicates: 0, semanticDuplicates: 0, optionErrors: 0 },
    };
  }

  const m = await models.init();
  const db = m.dbClient;

  const results = questions.map((_, index) => ({
    index,
    valid: true,
    exactDuplicate: null,
    semanticDuplicates: [],
    optionErrors: [],
  }));

  if (checkExact) {
    const exactDuplicates = await findExactDuplicates(db, collegeId, questions, excludeQuestionIds);
    for (const dup of exactDuplicates) {
      results[dup.index].valid = false;
      results[dup.index].exactDuplicate = dup;
    }
  }

  if (checkSemantic) {
    const semanticDuplicates = await findSemanticDuplicates(db, collegeId, questions, excludeQuestionIds, scope, testId);
    for (const dup of semanticDuplicates) {
      results[dup.index].valid = results[dup.index].valid && dup.type !== "high_confidence_semantic";
      results[dup.index].semanticDuplicates.push(dup);
    }
  }

  if (checkOptions) {
    for (let i = 0; i < questions.length; i++) {
      const optionErrors = validateOptionsWithinQuestion(questions[i]);
      if (optionErrors.length > 0) {
        results[i].valid = false;
        results[i].optionErrors = optionErrors;
      }
    }
  }

  const summary = {
    total: questions.length,
    valid: results.filter((r) => r.valid).length,
    exactDuplicates: results.filter((r) => r.exactDuplicate).length,
    semanticDuplicates: results.filter((r) => r.semanticDuplicates.length > 0).length,
    optionErrors: results.filter((r) => r.optionErrors.length > 0).length,
  };

  return { valid: summary.valid === summary.total, results, summary };
}

async function detectDuplicatesInQuestionBank(collegeId, questions, options = {}) {
  return detectDuplicates(questions, { ...options, collegeId, scope: "questionBank" });
}

async function detectDuplicatesInTest(collegeId, testId, questions, options = {}) {
  return detectDuplicates(questions, { ...options, collegeId, scope: "test", testId });
}

async function detectDuplicatesAcrossQuestionBank(collegeId, questions, options = {}) {
  const m = await models.init();
  const db = m.dbClient;

  const existingQuestions = await db.questionBank.findMany({
    where: { collegeId, isActive: true },
    select: {
      id: true,
      prompt: true,
      type: true,
      options: true,
      correctOption: true,
      correctText: true,
      correctBoolean: true,
      marks: true,
      category: true,
      difficulty: true,
      normalizedPrompt: true,
    },
    take: 1000,
  });

  const results = questions.map((_, index) => ({
    index,
    valid: true,
    exactDuplicate: null,
    semanticDuplicates: [],
    optionErrors: [],
  }));

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const inputPrompt = normalizeText(question.prompt || question.question);
    const inputFingerprint = generateQuestionFingerprint(question);

    for (const existing of existingQuestions) {
      if (existing.normalizedPrompt === inputPrompt) continue;

      const existingFingerprint = existing.fingerprint || generateQuestionFingerprint(existing);
      if (existingFingerprint === inputFingerprint) {
        results[i].valid = false;
        results[i].exactDuplicate = {
          index: i,
          type: "exact",
          existingQuestion: {
            id: existing.id,
            prompt: existing.prompt,
            type: existing.type,
            options: existing.options,
            correctOption: existing.correctOption,
            correctText: existing.correctText,
            correctBoolean: existing.correctBoolean,
            marks: existing.marks,
            category: existing.category,
            difficulty: existing.difficulty,
          },
          similarity: { overall: 1.0, prompt: 1.0, options: 1.0, correctAnswer: 1.0 },
        };
        break;
      }

      const similarity = calculateSemanticSimilarity(question, existing);
      const classification = classifySimilarity(similarity.overall);

      if (classification === "high_confidence" || classification === "potential") {
        results[i].valid = results[i].valid && classification !== "high_confidence";
        results[i].semanticDuplicates.push({
          index: i,
          type: classification === "high_confidence" ? "high_confidence_semantic" : "potential_semantic",
          existingQuestion: {
            id: existing.id,
            prompt: existing.prompt,
            type: existing.type,
            options: existing.options,
            correctOption: existing.correctOption,
            correctText: existing.correctText,
            correctBoolean: existing.correctBoolean,
            marks: existing.marks,
            category: existing.category,
            difficulty: existing.difficulty,
          },
          similarity,
        });
      }
    }

    const optionErrors = validateOptionsWithinQuestion(question);
    if (optionErrors.length > 0) {
      results[i].valid = false;
      results[i].optionErrors = optionErrors;
    }
  }

  const summary = {
    total: questions.length,
    valid: results.filter((r) => r.valid).length,
    exactDuplicates: results.filter((r) => r.exactDuplicate).length,
    semanticDuplicates: results.filter((r) => r.semanticDuplicates.length > 0).length,
    optionErrors: results.filter((r) => r.optionErrors.length > 0).length,
  };

  return { valid: summary.valid === summary.total, results, summary };
}

module.exports = {
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
};