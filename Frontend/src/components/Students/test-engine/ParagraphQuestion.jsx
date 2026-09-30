import { useMemo } from "react";

export function ParagraphQuestion({ answer, onChange, disabled, wordLimit = 250 }) {
  const words = useMemo(() => {
    const text = answer?.answer_text || "";
    const clean = text.trim();
    return clean ? clean.split(/\s+/).length : 0;
  }, [answer?.answer_text]);

  const handleChange = (value) => {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    const capped = parts.slice(0, wordLimit).join(" ");

    onChange({
      selected_option: null,
      selected_options: [],
      answer_boolean: null,
      answer_text: capped,
    });
  };

  return (
    <div className="space-y-2">
      <textarea
        disabled={disabled}
        rows={7}
        value={answer?.answer_text || ""}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="Write your answer"
        aria-label="Your answer"
        className="min-h-44 resize-y py-3 leading-7 w-full rounded-lg border border-input bg-card px-3.5 text-base text-text-primary outline-none transition-colors placeholder:text-text-secondary/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <p aria-live="polite" className={`text-right text-xs tabular-nums ${words >= wordLimit ? "font-medium text-danger" : "text-text-secondary"}`}>
        {words}/{wordLimit} words
      </p>
    </div>
  );
}
