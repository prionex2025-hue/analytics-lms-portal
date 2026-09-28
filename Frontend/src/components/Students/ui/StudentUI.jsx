import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

/**
 * Student portal UI kit: the small set of layout + feedback primitives every
 * student screen is built from, so headers, stats, badges and states look
 * and behave the same everywhere.
 */

export function PageHeader({ eyebrow, title, description, actions, className }) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p> : null}
        <h1 className={ui.titleXl}>{title}</h1>
        {description ? <p className={cn(ui.subtitle, "max-w-2xl")}>{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({ title, description, action, count, as: Heading = "h2", className }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Heading className={ui.titleLg}>{title}</Heading>
          {typeof count === "number" ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-text-secondary">
              {count}
            </span>
          ) : null}
        </div>
        {description ? <p className="mt-0.5 text-sm text-text-secondary">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Panel({ className, children, ...props }) {
  return (
    <section className={cn(ui.card, ui.cardPadding, className)} {...props}>
      {children}
    </section>
  );
}

const TONE_ICON = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-muted text-text-secondary",
};

export function StatTile({ icon: Icon, label, value, hint, tone = "primary", className }) {
  return (
    <div className={cn(ui.card, "flex items-start gap-3 p-4", className)}>
      {Icon ? (
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", TONE_ICON[tone] || TONE_ICON.primary)}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-sm text-text-secondary">{label}</p>
        <p className="mt-0.5 truncate text-2xl font-semibold tabular-nums tracking-tight text-text-primary">{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-text-secondary">{hint}</p> : null}
      </div>
    </div>
  );
}

const BADGE_TONE = {
  neutral: "bg-muted text-text-secondary ring-border",
  info: "bg-primary/10 text-primary ring-primary/20",
  success: "bg-success/10 text-success ring-success/25",
  warning: "bg-warning/12 text-amber-700 ring-warning/30 dark:text-warning",
  danger: "bg-danger/10 text-danger ring-danger/25",
};

export function StatusBadge({ tone = "neutral", icon: Icon, children, className }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        BADGE_TONE[tone] || BADGE_TONE.neutral,
        className
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function MetaItem({ icon: Icon, children, className }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-text-secondary", className)}>
      {Icon ? <Icon className="size-4 shrink-0 text-text-secondary/80" aria-hidden="true" /> : null}
      <span className="min-w-0">{children}</span>
    </span>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center",
        className
      )}
    >
      <span className="grid size-12 place-items-center rounded-full bg-muted text-text-secondary">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="mt-4 text-base font-semibold text-text-primary">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-text-secondary">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, onRetry, action, className }) {
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-xl border border-danger/25 bg-danger/5 p-4", className)}>
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        {description ? <p className="mt-0.5 text-sm text-text-secondary">{description}</p> : null}
        {onRetry || action ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry ? (
              <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LoadingState({ label = "Loading…", className, fullScreen = false }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "grid place-items-center text-sm text-text-secondary",
        fullScreen ? "min-h-screen bg-background" : "min-h-[40vh]",
        className
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function Callout({ tone = "info", icon: Icon, title, children, className }) {
  const toneClass = {
    info: "border-primary/20 bg-primary/5",
    warning: "border-warning/35 bg-warning/10",
    danger: "border-danger/25 bg-danger/5",
    success: "border-success/25 bg-success/5",
  }[tone];
  const iconClass = {
    info: "text-primary",
    warning: "text-amber-600 dark:text-warning",
    danger: "text-danger",
    success: "text-success",
  }[tone];

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-4", toneClass, className)}>
      {Icon ? <Icon className={cn("mt-0.5 size-5 shrink-0", iconClass)} aria-hidden="true" /> : null}
      <div className="min-w-0 text-sm">
        {title ? <p className="font-semibold text-text-primary">{title}</p> : null}
        {children ? <div className={cn("text-text-secondary", title ? "mt-0.5" : "")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function SegmentedControl({ value, onChange, options, label, className }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex w-full flex-wrap gap-1 rounded-lg bg-muted p-1 sm:w-auto", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-none",
              active ? "bg-card text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
            )}
          >
            {option.icon ? <option.icon className="size-4" aria-hidden="true" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function FieldLabel({ htmlFor, children, hint }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-sm font-medium text-text-primary">
        {children}
      </label>
      {hint ? <span className="text-xs text-text-secondary">{hint}</span> : null}
    </div>
  );
}
