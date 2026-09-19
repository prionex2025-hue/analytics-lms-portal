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
      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-text-primary outline-none ring-blue-400 focus:ring"
    />
  );
}
