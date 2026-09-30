import { OptionCard } from "@/components/Students/test-engine/OptionCard";

export function MCQSingleQuestion({ question, answer, onChange, disabled }) {
  return (
    <div role="radiogroup" aria-label="Answer choices" className="space-y-2.5">
      {(question?.options || []).map((option, index) => (
        <OptionCard
          key={String(option)}
          type="radio"
          name={`single-${question?.id}`}
          index={index}
          label={option}
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
      ))}
    </div>
  );
}
