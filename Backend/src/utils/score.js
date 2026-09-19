const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const roundPercent = (value) => Number(toFiniteNumber(value).toFixed(2));

const clampPercent = (value) => Math.max(0, Math.min(100, roundPercent(value)));

const getTestTotalMarks = (test = {}) => {
  if (Array.isArray(test?.questions)) {
    const questionTotal = test.questions.reduce((sum, question) => sum + toFiniteNumber(question?.marks, 0), 0);
    if (questionTotal > 0) return questionTotal;
  }

  const explicitTotal = toFiniteNumber(test?.totalMarks, 0);
  if (explicitTotal > 0) return explicitTotal;

  return 0;
};

const getSubmissionScorePercent = (submission = {}) => {
  const score = toFiniteNumber(submission?.score, 0);
  const totalMarks = getTestTotalMarks(submission?.test);

  if (totalMarks > 0) {
    return clampPercent((score / totalMarks) * 100);
  }

  return clampPercent(submission?.accuracy ?? score);
};

module.exports = {
  clampPercent,
  getSubmissionScorePercent,
  getTestTotalMarks,
  roundPercent,
  toFiniteNumber,
};
