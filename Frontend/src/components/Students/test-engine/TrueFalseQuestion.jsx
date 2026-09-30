import { OptionCard } from "@/components/Students/test-engine/OptionCard";

export function TrueFalseQuestion({ answer, onChange, disabled }) {
  const choices = [
    { label: "True", value: true },
    { label: "False", value: false },
  ];

  return (
    <div role="radiogroup" aria-label="Answer choices" className="grid gap-2.5 sm:grid-cols-2">
      {choices.map((choice, index) => (
        <OptionCard
          key={choice.label}
          type="radio"
          name="true-false"
          index={index}
          label={choice.label}
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
      ))}
    </div>
  );
}
