/**
 * Classical test theory item analysis.
 *
 * Pure functions: the caller resolves correctness (via isQuestionCorrect) and
 * passes plain rows in, so the statistics are independently unit-testable.
 */

const TOP_BOTTOM_FRACTION = 0.27; // Kelley's optimal upper/lower group split.

const toFinite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const median = (values = []) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

/**
 * Difficulty (p-value) is the proportion answering correctly, so HIGHER means
 * EASIER. Labels follow the conventional bands.
 */
const difficultyLabel = (p) => {
  if (p >= 0.8) return "EASY";
  if (p >= 0.5) return "MODERATE";
  if (p >= 0.3) return "HARD";
  return "VERY_HARD";
};

/**
 * Discrimination index D = (correct in top group / top size) - (correct in
 * bottom group / bottom size). Measures how well an item separates strong from
 * weak candidates. Below 0.2 the item is not pulling its weight; negative means
 * weaker candidates outperformed stronger ones (usually a miskeyed answer).
 */
const discriminationLabel = (d) => {
  if (d < 0) return "NEGATIVE";
  if (d < 0.2) return "WEAK";
  if (d < 0.3) return "MARGINAL";
  if (d < 0.4) return "GOOD";
  return "EXCELLENT";
};

const buildGroups = (submissions = []) => {
  const ranked = [...submissions].sort((a, b) => toFinite(b.scorePercent) - toFinite(a.scorePercent));
  // Need enough attempts for the split to mean anything.
  if (ranked.length < 4) {
    return { top: new Set(), bottom: new Set(), usable: false };
  }
  const groupSize = Math.max(1, Math.round(ranked.length * TOP_BOTTOM_FRACTION));
  return {
    top: new Set(ranked.slice(0, groupSize).map((item) => String(item.id))),
    bottom: new Set(ranked.slice(-groupSize).map((item) => String(item.id))),
    usable: true,
  };
};

const computeItemAnalysis = ({ questions = [], submissions = [], answers = [] } = {}) => {
  const groups = buildGroups(submissions);

  const answersByQuestion = new Map();
  for (const answer of answers) {
    const key = String(answer.questionId);
    if (!answersByQuestion.has(key)) answersByQuestion.set(key, []);
    answersByQuestion.get(key).push(answer);
  }

  const items = questions.map((question) => {
    const questionAnswers = answersByQuestion.get(String(question.id)) || [];
    const attempts = questionAnswers.length;
    const correct = questionAnswers.filter((answer) => answer.isCorrect === true).length;
    const difficulty = attempts > 0 ? correct / attempts : 0;

    let discrimination = 0;
    if (groups.usable) {
      const topAnswers = questionAnswers.filter((answer) => groups.top.has(String(answer.submissionId)));
      const bottomAnswers = questionAnswers.filter((answer) => groups.bottom.has(String(answer.submissionId)));
      const topRate = topAnswers.length ? topAnswers.filter((a) => a.isCorrect === true).length / topAnswers.length : 0;
      const bottomRate = bottomAnswers.length ? bottomAnswers.filter((a) => a.isCorrect === true).length / bottomAnswers.length : 0;
      discrimination = topRate - bottomRate;
    }

    // Distractor analysis: how the cohort spread across the offered options.
    const optionCounts = new Map();
    for (const answer of questionAnswers) {
      const chosen = answer.selectedOption == null ? null : String(answer.selectedOption);
      if (chosen == null || chosen === "") continue;
      optionCounts.set(chosen, (optionCounts.get(chosen) || 0) + 1);
    }
    const offered = Array.isArray(question.options) && question.options.length
      ? question.options.map((option) => String(option))
      : [...optionCounts.keys()];
    const distractors = offered.map((option) => {
      const count = optionCounts.get(option) || 0;
      return {
        option,
        count,
        share: attempts > 0 ? Number(((count / attempts) * 100).toFixed(2)) : 0,
        isCorrect: String(question.correctOption ?? "") === option,
      };
    });

    const unanswered = attempts === 0 ? 0 : questionAnswers.filter((answer) => !answer.selectedOption && answer.isCorrect !== true).length;
    const markedForReview = questionAnswers.filter((answer) => answer.markedForReview === true).length;

    const reasons = [];
    if (attempts > 0 && discrimination < 0) reasons.push("NEGATIVE_DISCRIMINATION");
    else if (groups.usable && attempts > 0 && discrimination < 0.2) reasons.push("LOW_DISCRIMINATION");
    if (attempts > 0 && difficulty < 0.3) reasons.push("VERY_HARD");
    if (attempts > 0 && difficulty >= 0.95) reasons.push("TOO_EASY");
    const topDistractor = distractors
      .filter((option) => !option.isCorrect)
      .sort((a, b) => b.count - a.count)[0] || null;
    if (topDistractor && attempts > 0 && topDistractor.count > correct) reasons.push("DISTRACTOR_BEATS_KEY");

    return {
      questionId: question.id,
      order: toFinite(question.order, 0),
      prompt: question.prompt || "",
      type: question.type || null,
      marks: toFinite(question.marks, 0),
      attempts,
      correct,
      incorrect: attempts - correct,
      unanswered,
      difficulty: Number(difficulty.toFixed(4)),
      difficultyLabel: difficultyLabel(difficulty),
      discrimination: Number(discrimination.toFixed(4)),
      discriminationLabel: groups.usable ? discriminationLabel(discrimination) : "INSUFFICIENT_DATA",
      medianTimeSeconds: Math.round(median(questionAnswers.map((answer) => toFinite(answer.timeSpentSeconds)))),
      markedForReviewRate: attempts > 0 ? Number(((markedForReview / attempts) * 100).toFixed(2)) : 0,
      distractors,
      topDistractor: topDistractor ? topDistractor.option : null,
      flagged: reasons.length > 0,
      flagReasons: reasons,
    };
  });

  const answered = items.filter((item) => item.attempts > 0);
  const summary = {
    totalQuestions: items.length,
    analysedQuestions: answered.length,
    flaggedQuestions: items.filter((item) => item.flagged).length,
    averageDifficulty: answered.length
      ? Number((answered.reduce((sum, item) => sum + item.difficulty, 0) / answered.length).toFixed(4))
      : 0,
    averageDiscrimination: answered.length
      ? Number((answered.reduce((sum, item) => sum + item.discrimination, 0) / answered.length).toFixed(4))
      : 0,
    groupSplitUsable: groups.usable,
  };

  return { items: items.sort((a, b) => a.order - b.order), summary };
};

module.exports = {
  computeItemAnalysis,
  difficultyLabel,
  discriminationLabel,
  TOP_BOTTOM_FRACTION,
};
