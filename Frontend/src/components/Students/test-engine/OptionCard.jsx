import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Shared answer-choice row for single/multi/true-false questions. The native
// input stays in the DOM (visually hidden) so keyboard and screen-reader
// behaviour is the browser's own.
export function OptionCard({ type = "radio", name, index, label, checked, disabled, onChange }) {
  const isMulti = type === "checkbox";

  return (
    <label
      className={cn(
        "group flex min-h-12 items-center gap-3 rounded-lg border px-4 py-3 transition-colors focus-within:ring-3 focus-within:ring-ring/50",
        checked ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
        disabled ? "cursor-not-allowed opacity-60 hover:border-border hover:bg-card" : "cursor-pointer"
      )}
    >
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center text-xs font-semibold transition-colors",
          isMulti ? "rounded-md" : "rounded-full",
          checked ? "bg-primary text-primary-foreground" : "bg-muted text-text-secondary group-hover:text-text-primary"
        )}
      >
        {checked && isMulti ? <Check className="size-4" /> : LETTERS[index] || index + 1}
      </span>
      <span className="text-sm leading-6 text-text-primary sm:text-base">{label}</span>
    </label>
  );
}
