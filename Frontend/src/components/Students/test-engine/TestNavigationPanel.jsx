import { Button } from "@/components/ui/button";

const hasAnswer = (answer) => {
  if (!answer) return false;
  if (answer.selected_option != null && String(answer.selected_option).trim()) return true;
  if (Array.isArray(answer.selected_options) && answer.selected_options.length > 0) return true;
  if (typeof answer.answer_boolean === "boolean") return true;
  return Boolean(String(answer.answer_text || "").trim());
};

export function TestNavigationPanel({
  questionOrder,
  answers,
  markedForReview,
  currentIndex,
  onJump,
  onPrev,
  onNext,
  disableNext,
}) {
  const markedSet = new Set(markedForReview || []);

  const answeredCount = questionOrder.filter((questionId) => hasAnswer(answers[questionId])).length;

  return (
    <aside className="border-l border-border bg-background p-4">
      <p className="mb-3 text-xs font-semibold tracking-[0.12em] text-text-secondary uppercase">Question Palette</p>

      <div className="mb-4 rounded-xl border border-border bg-card p-3 text-xs text-text-secondary">
        <p>Answered: <span className="font-semibold text-success">{answeredCount}</span></p>
        <p>Unanswered: <span className="font-semibold text-rose-700">{questionOrder.length - answeredCount}</span></p>
        <p>Marked: <span className="font-semibold text-warning">{markedSet.size}</span></p>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {questionOrder.map((questionId, index) => {
          const marked = markedSet.has(questionId);
          const answered = hasAnswer(answers[questionId]);

          return (
            <button
              key={questionId}
              type="button"
              onClick={() => onJump(index)}
              className={`grid h-9 place-items-center rounded-lg border text-xs font-semibold transition ${
                index === currentIndex
                  ? "border-primary bg-primary text-primary-foreground"
                  : marked
                    ? "border-warning/50 bg-warning/10 text-warning"
                    : answered
                      ? "border-success/50 bg-success/10 text-success"
                      : "border-border bg-card text-text-secondary"
              }`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={onPrev} disabled={currentIndex <= 0}>Prev</Button>
        <Button type="button" onClick={onNext} disabled={disableNext}>Next</Button>
      </div>
    </aside>
  );
}
