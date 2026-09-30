import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

  const unansweredCount = questionOrder.length - answeredCount;
  const legend = [
    { label: "Answered", value: answeredCount, swatch: "bg-success" },
    { label: "Unanswered", value: unansweredCount, swatch: "bg-muted ring-1 ring-inset ring-border" },
    { label: "Marked", value: markedSet.size, swatch: "bg-warning" },
  ];

  return (
    <aside
      aria-label="Question palette"
      className="border-t border-border bg-card p-4 sm:p-6 lg:sticky lg:top-17 lg:h-[calc(100vh-4.25rem)] lg:overflow-y-auto lg:border-t-0 lg:border-l lg:p-5"
    >
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-text-primary">Question palette</p>
        <p className="text-xs tabular-nums text-text-secondary">
          {answeredCount}/{questionOrder.length} done
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {legend.map((item) => (
          <div key={item.label} className="rounded-lg bg-muted/50 px-2.5 py-2">
            <dt className="flex items-center gap-1.5 text-[11px] text-text-secondary">
              <span className={cn("size-2.5 rounded-sm", item.swatch)} aria-hidden="true" />
              {item.label}
            </dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-text-primary">{item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-6 gap-2 sm:grid-cols-10 lg:grid-cols-5">
        {questionOrder.map((questionId, index) => {
          const marked = markedSet.has(questionId);
          const answered = hasAnswer(answers[questionId]);
          const isCurrent = index === currentIndex;
          const stateLabel = [answered ? "answered" : "unanswered", marked ? "marked for review" : null].filter(Boolean).join(", ");

          return (
            <button
              key={questionId}
              type="button"
              onClick={() => onJump(index)}
              aria-current={isCurrent ? "true" : undefined}
              aria-label={`Question ${index + 1}, ${stateLabel}`}
              className={cn(
                "relative grid h-10 place-items-center rounded-lg text-sm font-medium tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                marked
                  ? "bg-warning/15 text-amber-800 ring-1 ring-inset ring-warning/50 dark:text-warning"
                  : answered
                    ? "bg-success/12 text-success ring-1 ring-inset ring-success/35"
                    : "bg-card text-text-secondary ring-1 ring-inset ring-border hover:bg-muted",
                isCurrent ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""
              )}
            >
              {index + 1}
              {marked && answered ? (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-success" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-5 hidden grid-cols-2 gap-2 lg:grid">
        <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={onPrev} disabled={currentIndex <= 0}>
          <ChevronLeft className="size-4" />
          Prev
        </Button>
        <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={onNext} disabled={disableNext}>
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
