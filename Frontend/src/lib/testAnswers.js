// Shared helpers for reasoning about a student's in-progress answers.
// The question palette and the submit-confirmation dialog must agree on what
// counts as "answered", otherwise a student is told they skipped a question
// they actually filled in (or vice versa).

export const hasAnswer = (answer) => {
  if (!answer) return false;
  if (answer.selected_option != null && String(answer.selected_option).trim()) return true;
  if (Array.isArray(answer.selected_options) && answer.selected_options.length > 0) return true;
  if (typeof answer.answer_boolean === "boolean") return true;
  return Boolean(String(answer.answer_text || "").trim());
};

// Summarise the current attempt (or current MODULE_TEST section, since the
// store only ever holds the live section's questions) for the submit dialog.
export const summarizeAttemptAnswers = (questionOrder = [], answers = {}, markedForReview = []) => {
  const order = Array.isArray(questionOrder) ? questionOrder : [];
  const marked = new Set(Array.isArray(markedForReview) ? markedForReview : []);

  const answeredIds = order.filter((questionId) => hasAnswer(answers?.[questionId]));
  const markedIds = order.filter((questionId) => marked.has(questionId));
  const markedAndAnsweredIds = markedIds.filter((questionId) => hasAnswer(answers?.[questionId]));
  const unansweredIds = order.filter((questionId) => !hasAnswer(answers?.[questionId]));

  return {
    total: order.length,
    answered: answeredIds.length,
    unanswered: unansweredIds.length,
    marked: markedIds.length,
    markedAndAnswered: markedAndAnsweredIds.length,
    unansweredIds,
    markedIds,
  };
};

export const formatQuestionCount = (count) => {
  const safe = Number(count) || 0;
  return `${safe} ${safe === 1 ? "question" : "questions"}`;
};