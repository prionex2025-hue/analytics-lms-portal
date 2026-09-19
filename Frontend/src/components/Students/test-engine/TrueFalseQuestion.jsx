export function TrueFalseQuestion({ answer, onChange, disabled }) {
  const choices = [
    { label: "True", value: true },
    { label: "False", value: false },
  ];

  return (
    <div className="space-y-3">
      {choices.map((choice) => (
        <label
          key={choice.label}
          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
            answer?.answer_boolean === choice.value ? "border-primary bg-primary/10" : "border-border bg-card"
          } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
        >
          <input
            type="radio"
            name="true-false"
            checked={answer?.answer_boolean === choice.value}
            disabled={disabled}
            onChange={() =>
              onChange({
                selected_option: null,
                selected_options: [],
                answer_boolean: choice.value,
                answer_text: "",
              })
            }
          />
          <span className="text-text-primary">{choice.label}</span>
        </label>
      ))}
    </div>
  );
}
