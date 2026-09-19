export function MCQMultiQuestion({ question, answer, onChange, disabled }) {
  const selected = Array.isArray(answer?.selected_options) ? answer.selected_options : [];

  const toggleOption = (option) => {
    const has = selected.includes(option);
    const next = has ? selected.filter((value) => value !== option) : [...selected, option];

    onChange({
      selected_option: null,
      selected_options: next,
      answer_boolean: null,
      answer_text: "",
    });
  };

  return (
    <div className="space-y-3">
      {(question?.options || []).map((option) => (
        <label
          key={String(option)}
          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
            selected.includes(option) ? "border-primary bg-primary/10" : "border-border bg-card"
          } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
        >
          <input
            type="checkbox"
            checked={selected.includes(option)}
            disabled={disabled}
            onChange={() => toggleOption(option)}
          />
          <span className="text-text-primary">{option}</span>
        </label>
      ))}
    </div>
  );
}
