export function FillBlankQuestion({ answer, onChange, disabled }) {
  return (
    <input
      type="text"
      disabled={disabled}
      value={answer?.answer_text || ""}
      onChange={(event) =>
        onChange({
          selected_option: null,
          selected_options: [],
          answer_boolean: null,
          answer_text: event.target.value.trimStart(),
        })
      }
      placeholder="Type your answer"
      aria-label="Your answer"
      className="h-12 w-full rounded-lg border border-input bg-card px-3.5 text-base text-text-primary outline-none transition-colors placeholder:text-text-secondary/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}
