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
        className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-text-primary outline-none ring-blue-400 focus:ring"
      />
      <p className={`text-xs ${words >= wordLimit ? "text-danger" : "text-text-secondary"}`}>
        {words}/{wordLimit} words
      </p>
    </div>
  );
}
