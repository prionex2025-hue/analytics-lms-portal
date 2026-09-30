import { OptionCard } from "@/components/Students/test-engine/OptionCard";

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
    <div className="space-y-2.5">
      <p className="text-xs text-text-secondary">Select all that apply.</p>
      <div role="group" aria-label="Answer choices" className="space-y-2.5">
        {(question?.options || []).map((option, index) => (
          <OptionCard
            key={String(option)}
            type="checkbox"
            index={index}
            label={option}
            checked={selected.includes(option)}
            disabled={disabled}
            onChange={() => toggleOption(option)}
          />
        ))}
      </div>
    </div>
  );
}
