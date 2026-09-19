const models = require("../models");
const {
  isModuleTest,
  normalizeQuestionCategory,
} = require("./test-config.service");

const SubmissionStatus = {
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  AUTO_SUBMITTED: "AUTO_SUBMITTED",
};

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const normalize = (value) => (value == null ? "" : String(value)).trim().toLowerCase();

const parseOptions = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
    } catch {
      // Fall through to comma-separated parsing.
    }

    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const compareOptionSets = (actual, expected) => {
  const actualSet = new Set(parseOptions(actual).map((item) => normalize(item)));
  const expectedSet = new Set(parseOptions(expected).map((item) => normalize(item)));

  if (actualSet.size !== expectedSet.size) return false;
  return [...actualSet].every((item) => expectedSet.has(item));
};

const getAnswerQuestionId = (answer = {}) => answer.questionId ?? answer.question_id ?? answer.question?.id ?? null;

const getAnswerSelectedOption = (answer = {}) => answer.selectedOption ?? answer.selected_option ?? null;

const getAnswerSelectedOptions = (answer = {}) => {
  if (Array.isArray(answer.selectedOptions)) return answer.selectedOptions;
  if (Array.isArray(answer.selected_options)) return answer.selected_options;
  return [];
};

const getAnswerBoolean = (answer = {}) => {
  if (typeof answer.answerBoolean === "boolean") return answer.answerBoolean;
  if (typeof answer.selectedBoolean === "boolean") return answer.selectedBoolean;
  if (typeof answer.answer_boolean === "boolean") return answer.answer_boolean;
  if (typeof answer.selected_boolean === "boolean") return answer.selected_boolean;
  return null;
};

const getAnswerText = (answer = {}) =>
  answer.answerText ?? answer.selectedText ?? answer.answer_text ?? answer.selected_text ?? null;

const findAnswerForQuestion = (answers = [], question = {}) => {
  const questionIds = [question.id, question.sourceQuestionId, question.source_question_id]
    .filter(Boolean)
    .map((item) => String(item));

  return (answers || []).find((answer) => {
    const answerQuestionIds = [
      getAnswerQuestionId(answer),
      answer?.question?.sourceQuestionId,
      answer?.question?.source_question_id,
    ]
      .filter(Boolean)
      .map((item) => String(item));

    return answerQuestionIds.some((answerQuestionId) => questionIds.includes(answerQuestionId));
  }) || null;
};

const isAnswerProvided = (answer) => {
  if (!answer) return false;
  if (normalize(getAnswerSelectedOption(answer))) return true;
  if (getAnswerSelectedOptions(answer).length > 0) return true;
  if (typeof getAnswerBoolean(answer) === "boolean") return true;
  return Boolean(normalize(getAnswerText(answer)));
};

const isQuestionCorrect = (question, answer) => {
  if (!isAnswerProvided(answer)) return false;

  const type = String(question?.type || "").toUpperCase();

  if (type === "MCQ" || type === "MCQ_SINGLE" || type === "SINGLE_SELECT") {
    return normalize(getAnswerSelectedOption(answer)) === normalize(question.correctOption);
  }

  if (type === "MCQ_MULTI" || type === "MULTI_SELECT") {
    return compareOptionSets(getAnswerSelectedOptions(answer), question.correctOptions);
  }

  if (type === "TRUE_FALSE" || type === "BOOLEAN") {
    return getAnswerBoolean(answer) === question.correctBoolean;
  }

  return normalize(getAnswerText(answer)) === normalize(question.correctText);
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveNegativeMarks = (test = {}, question = {}) => {
  if (!test?.negativeMarkingEnabled) {
    return 0;
  }

  const questionPenalty = toNumber(question?.negativeMarks, NaN);
  if (Number.isFinite(questionPenalty) && questionPenalty > 0) {
    return questionPenalty;
  }

  const testPenalty = toNumber(test?.negativeMarks, 0);
  return testPenalty > 0 ? testPenalty : 0;
};

// Pure scorer over a test (+questions) and its answers. For OPEN_TEST it returns
// the legacy shape { score, accuracy, completion, totalQuestions }. For
// MODULE_TEST it additionally returns per-module `sections[]` plus overall
// score/max/percentage. Each question is scored against ITS OWN category/module.
const scoreSubmissionData = (test = {}, answers = []) => {
  const questions = Array.isArray(test?.questions) ? test.questions : [];
  const answerList = Array.isArray(answers) ? answers : [];
  const totalQuestions = questions.length;
  const providedAnswerCount = answerList.filter(isAnswerProvided).length;

  // Score each question exactly once.
  const results = questions.map((question) => {
    const answer = findAnswerForQuestion(answerList, question);
    const provided = isAnswerProvided(answer);
    const marks = Number(question?.marks || 0);
    let delta = 0;
    if (provided) {
      delta = isQuestionCorrect(question, answer) ? marks : -resolveNegativeMarks(test, question);
    }
    return { question, marks, provided, delta };
  });

  const isModule = isModuleTest(test) && Array.isArray(test?.modules) && test.modules.length > 0;

  if (!isModule) {
    const totalMarks = results.reduce((acc, r) => acc + r.marks, 0);
    const scoredMarks = results.reduce((acc, r) => acc + r.delta, 0);
    const finalScore = Math.max(0, scoredMarks);
    const accuracy = totalMarks > 0 ? (finalScore / totalMarks) * 100 : 0;
    const completion = totalQuestions > 0 ? (providedAnswerCount / totalQuestions) * 100 : 0;
    return {
      score: round2(finalScore),
      accuracy: round2(accuracy),
      completion: round2(completion),
      totalQuestions,
    };
  }

  // MODULE_TEST: aggregate per category.
  const byCategory = new Map();
  for (const r of results) {
    const category = normalizeQuestionCategory(r.question?.category) || String(r.question?.category || "UNCATEGORIZED");
    if (!byCategory.has(category)) {
      byCategory.set(category, { score: 0, maxScore: 0, questionCount: 0, answeredCount: 0 });
    }
    const agg = byCategory.get(category);
    agg.maxScore += r.marks;
    agg.score += r.delta;
    agg.questionCount += 1;
    if (r.provided) agg.answeredCount += 1;
  }

  const sections = test.modules
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((mod) => {
      const agg = byCategory.get(mod.category) || { score: 0, maxScore: 0, questionCount: 0, answeredCount: 0 };
      const score = Math.max(0, agg.score);
      const maxScore = agg.maxScore;
      return {
        key: mod.key,
        name: mod.name,
        order: mod.order,
        category: mod.category,
        configuredDurationMins: Number(mod.durationMins) || null,
        score: round2(score),
        maxScore: round2(maxScore),
        percentage: maxScore > 0 ? round2((score / maxScore) * 100) : 0,
        questionCount: agg.questionCount,
        answeredCount: agg.answeredCount,
      };
    });

  const overallScore = sections.reduce((acc, sec) => acc + sec.score, 0);
  const overallMaxScore = sections.reduce((acc, sec) => acc + sec.maxScore, 0);
  const overallPercentage = overallMaxScore > 0 ? round2((overallScore / overallMaxScore) * 100) : 0;
  const completion = totalQuestions > 0 ? round2((providedAnswerCount / totalQuestions) * 100) : 0;

  return {
    score: round2(overallScore),
    accuracy: overallPercentage,
    completion,
    totalQuestions,
    sections,
    overallScore: round2(overallScore),
    overallMaxScore: round2(overallMaxScore),
    overallPercentage,
  };
};

const calculateSubmissionScore = async (submissionId) => {
  const m = await models.init();
  const db = m.dbClient;
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: {
      test: {
        include: {
          questions: true,
        },
      },
      answers: true,
    },
  });

  if (!submission) return null;

  return scoreSubmissionData(submission.test, submission.answers);
};

const toValidTime = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : null;
};

const getCompletionTimeSpentSeconds = async (db, submission, submittedAt = new Date()) => {
  const startedAtMs = toValidTime(submission?.startedAt);
  if (!startedAtMs) {
    return 0;
  }

  const deadlineCandidates = [];
  const session = db.testSession?.findFirst
    ? await db.testSession.findFirst({
        where: { submissionId: submission.id },
        orderBy: { updatedAt: "desc" },
        select: { expiresAt: true },
      }).catch(() => null)
    : null;
  const sessionExpiresAtMs = toValidTime(session?.expiresAt);
  if (sessionExpiresAtMs) {
    deadlineCandidates.push(sessionExpiresAtMs);
  }

  const test = db.test?.findUnique
    ? await db.test.findUnique({
        where: { id: submission.testId },
        select: { durationMins: true },
      }).catch(() => null)
    : null;
  const durationMins = Number(test?.durationMins || 0);
  if (durationMins > 0) {
    deadlineCandidates.push(startedAtMs + durationMins * 60 * 1000);
  }

  const submittedAtMs = toValidTime(submittedAt) || Date.now();
  const deadlineMs = deadlineCandidates.length ? Math.min(...deadlineCandidates) : submittedAtMs;
  const effectiveEndMs = Math.min(submittedAtMs, deadlineMs);
  return Math.max(0, Math.floor((effectiveEndMs - startedAtMs) / 1000));
};

// Merge per-module scores (from scoreSubmissionData sections) into the existing
// moduleState timing set by the student runtime, finalizing any module still
// ACTIVE/NOT_STARTED, and compute overall aggregates. Returns fields to persist.
const finalizeModuleState = ({ existing = {}, sections = [], scoreData = {}, submittedAt = new Date() }) => {
  const existingModuleState = Array.isArray(existing.moduleState) ? existing.moduleState : [];
  const byKey = new Map(existingModuleState.map((ms) => [ms.key, ms]));

  const moduleState = sections.map((sec) => {
    const prev = byKey.get(sec.key) || {};
    let status = prev.status || "NOT_STARTED";
    let endedAt = prev.endedAt || null;
    const startedAt = prev.startedAt || null;

    // A module still open at overall completion is finalized now.
    if (status === "ACTIVE" || status === "NOT_STARTED") {
      status = "COMPLETED";
      endedAt = endedAt || submittedAt;
    }

    const timeTakenSeconds = Number.isFinite(Number(prev.timeTakenSeconds))
      ? Number(prev.timeTakenSeconds)
      : startedAt && endedAt
        ? Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
        : 0;

    return {
      key: sec.key,
      name: sec.name,
      order: sec.order,
      category: sec.category,
      configuredDurationMins: prev.configuredDurationMins ?? sec.configuredDurationMins ?? null,
      startedAt,
      endedAt,
      timeTakenSeconds,
      status,
      score: sec.score,
      maxScore: sec.maxScore,
      percentage: sec.percentage,
    };
  });

  const totalActualTimeSeconds = moduleState.reduce((sum, ms) => sum + (Number(ms.timeTakenSeconds) || 0), 0);

  return {
    moduleState,
    overallMaxScore: scoreData.overallMaxScore,
    overallPercentage: scoreData.overallPercentage,
    totalConfiguredDurationMins: moduleState.reduce((sum, ms) => sum + (Number(ms.configuredDurationMins) || 0), 0),
    totalActualTimeSeconds,
    currentModuleKey: null,
    moduleExpiresAt: null,
  };
};

// `withSummary: true` returns `{ submission, summary }` so callers can reuse
// the score computed here instead of re-running calculateSubmissionScore
// (a full test+questions+answers reload) right after completing. Default shape
// is unchanged for existing callers.
const completeSubmission = async ({ submissionId, autoSubmitted = false, withSummary = false }) => {
  const m = await models.init();
  const db = m.dbClient;
  const scoreData = await calculateSubmissionScore(submissionId);

  if (!scoreData) {
    return null;
  }

  const existing = await db.submission.findUnique({ where: { id: submissionId } });
  if (!existing) {
    return null;
  }

  if (existing.status !== SubmissionStatus.IN_PROGRESS) {
    return withSummary ? { submission: existing, summary: scoreData } : existing;
  }

  // Atomic completion guard to prevent duplicate submit races.
  const submitStatus = autoSubmitted ? SubmissionStatus.AUTO_SUBMITTED : SubmissionStatus.SUBMITTED;
  const submittedAt = new Date();
  const timeSpentSeconds = await getCompletionTimeSpentSeconds(db, existing, submittedAt);

  // For MODULE_TEST, finalize per-module scores into moduleState (preserving any
  // per-module timing set by the runtime) and compute overall aggregates.
  const moduleFinalization = Array.isArray(scoreData.sections)
    ? finalizeModuleState({ existing, sections: scoreData.sections, scoreData, submittedAt })
    : {};

  const updatedCount = await db.submission.updateMany({
    where: {
      id: submissionId,
      status: SubmissionStatus.IN_PROGRESS,
    },
    data: {
      score: scoreData.score,
      accuracy: scoreData.accuracy,
      timeSpentSeconds,
      status: submitStatus,
      submittedAt,
      completedReason: autoSubmitted ? "AUTO" : "MANUAL",
      completionLockAt: submittedAt,
      ...moduleFinalization,
    },
  });

  const updatedSubmission = await db.submission.findUnique({ where: { id: submissionId } });

  if (!updatedSubmission) {
    return null;
  }

  if ((updatedCount?.count || 0) > 0) {
    await db.testSession.updateMany({
      where: {
        submissionId,
        endedAt: null,
      },
      data: {
        endedAt: new Date(),
        connectionStatus: "OFFLINE",
      },
    });
  }

  return withSummary ? { submission: updatedSubmission, summary: scoreData } : updatedSubmission;
};

module.exports = {
  calculateSubmissionScore,
  scoreSubmissionData,
  completeSubmission,
  compareOptionSets,
  findAnswerForQuestion,
  getAnswerBoolean,
  getAnswerSelectedOption,
  getAnswerSelectedOptions,
  getAnswerText,
  getCompletionTimeSpentSeconds,
  isAnswerProvided,
  isQuestionCorrect,
};
