export function MCQSingleQuestion({ question, answer, onChange, disabled }) {
  return (
    <div className="space-y-3">
      {(question?.options || []).map((option) => (
        <label
          key={String(option)}
          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
            answer?.selected_option === option ? "border-primary bg-primary/10" : "border-border bg-card"
          } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
        >
          <input
            type="radio"
            name={`single-${question?.id}`}
            checked={answer?.selected_option === option}
            disabled={disabled}
            onChange={() =>
              onChange({
                selected_option: option,
                selected_options: [],
                answer_boolean: null,
                answer_text: "",
              })
            }
          />
          <span className="text-text-primary">{option}</span>
        </label>
      ))}
    </div>
  );
}
