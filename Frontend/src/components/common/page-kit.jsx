import { useId, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Inbox, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

/**
 * Shared page kit: the layout, form and feedback primitives the Student and
 * Super Admin portals are built from, so headers, stats, badges, forms, dialogs
 * and states look and behave the same everywhere.
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

export function SectionHeader({ title, description, action, count, as = "h2", className }) {
  const Heading = as;
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
  warning: "bg-warning/12 text-amber-700 ring-warning/30",
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

export function EmptyState({ icon = Inbox, title, description, action, className }) {
  const Icon = icon;
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
    warning: "text-amber-600",
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

export function FormField({ label, htmlFor, hint, error, required, className, children }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-sm font-medium text-text-primary">
          {label}
          {required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-text-secondary">{hint}</p>
      ) : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", label, className, inputClassName, ...props }) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
      <Input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={label || placeholder}
        className={cn(ui.field, "pl-9", inputClassName)}
        {...props}
      />
    </div>
  );
}

/** Card with an optional titled header row; the standard container for a page section. */
export function SectionCard({ title, description, actions, footer, className, bodyClassName, flush = false, children }) {
  return (
    <section className={cn(ui.card, "min-w-0 overflow-hidden", className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold text-text-primary">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-text-secondary">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(flush ? "" : "p-4 sm:p-5", bodyClassName)}>{children}</div>
      {footer ? <div className="border-t border-border px-4 py-3 sm:px-5">{footer}</div> : null}
    </section>
  );
}

/** Horizontal filter/action bar placed above a list or table. */
export function Toolbar({ className, children }) {
  return <div className={cn("flex flex-wrap items-end gap-3", className)}>{children}</div>;
}

/** Label/value grid for read-only record details. */
export function DetailList({ items = [], columns = 2, className }) {
  const colMap = { 1: "grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };
  const cols = colMap[columns] ?? colMap[2];
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", cols, className)}>
      {items.filter(Boolean).map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-text-secondary">{item.label}</dt>
          <dd className={cn("mt-0.5 text-sm font-medium break-words text-text-primary", item.className)}>{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Compact numeric summary used inside cards and dialogs. */
export function MiniStat({ label, value, tone, className }) {
  return (
    <div className={cn("rounded-lg bg-muted/50 px-3 py-2.5", className)}>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums text-text-primary", tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "")}>
        {value}
      </p>
    </div>
  );
}

const MODAL_SIZE = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  "2xl": "sm:max-w-6xl",
};

/**
 * Accessible modal (focus trap, Escape, labelled) with a sticky header and
 * optional sticky footer. Replaces hand-rolled `fixed inset-0` overlays.
 */
export function Modal({ open, onOpenChange, title, description, footer, size = "lg", className, bodyClassName, children }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn("flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0", MODAL_SIZE[size] || MODAL_SIZE.lg, className)}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 border-b border-border px-5 py-4 text-left sm:px-6">
          <div className="min-w-0 space-y-1">
            <DialogTitle className="text-lg font-semibold text-text-primary">{title}</DialogTitle>
            {description ? (
              <DialogDescription className="text-sm text-text-secondary">{description}</DialogDescription>
            ) : (
              <DialogDescription className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogDescription>
            )}
          </div>
          <Button type="button" variant="ghost" size="icon-lg" className="-mr-2 shrink-0 text-text-secondary" onClick={() => onOpenChange?.(false)}>
            <X className="size-5" />
            <span className="sr-only">Close</span>
          </Button>
        </DialogHeader>
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6", bodyClassName)}>{children}</div>
        {footer ? (
          <DialogFooter className="m-0 flex-row flex-wrap justify-end gap-2 rounded-none border-t border-border bg-muted/30 px-5 py-3 sm:px-6">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Responsive data table: a real <table> from `md` up, stacked cards below.
 *
 * columns: [{ key, header, cell(row) → node, className?, headerClassName?,
 *             align?: "right" | "center", primary?: bool (card title on mobile),
 *             hideOnMobile?: bool, actions?: bool (rendered as the card footer) }]
 */
export function DataTable({
  columns,
  rows,
  getRowKey,
  loading = false,
  loadingRows = 5,
  empty,
  minWidth = 720,
  rowClassName,
  onRowClick,
  caption,
  className,
}) {
  const alignClass = (align) => (align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left");
  const primary = columns.find((column) => column.primary) || columns[0];
  const actionColumns = columns.filter((column) => column.actions);
  const detailColumns = columns.filter((column) => column !== primary && !column.actions && !column.hideOnMobile);

  if (!loading && rows.length === 0) {
    return empty || <EmptyState title="Nothing to show" description="No records match the current filters." className="border-0" />;
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm" style={{ minWidth }}>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "h-10 px-4 text-xs font-medium tracking-wide whitespace-nowrap text-text-secondary uppercase first:pl-5 last:pr-5",
                    alignClass(column.align),
                    column.headerClassName
                  )}
                >
                  {column.actions && !column.header ? <span className="sr-only">Actions</span> : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading
              ? Array.from({ length: loadingRows }).map((_, index) => (
                  <tr key={`loading-${index}`}>
                    {columns.map((column) => (
                      <td key={column.key} className="px-4 py-3.5 first:pl-5 last:pr-5">
                        <div className="h-4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, index) => (
                  <tr
                    key={getRowKey ? getRowKey(row, index) : index}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn("transition-colors hover:bg-muted/40", onRowClick ? "cursor-pointer" : "", rowClassName?.(row))}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn("px-4 py-3 align-middle text-text-primary first:pl-5 last:pr-5", alignClass(column.align), column.className)}
                      >
                        {column.cell(row, index)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border md:hidden">
        {loading
          ? Array.from({ length: Math.min(loadingRows, 3) }).map((_, index) => (
              <li key={`loading-${index}`} className="space-y-2 p-4">
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              </li>
            ))
          : rows.map((row, index) => (
              <li key={getRowKey ? getRowKey(row, index) : index} className={cn("p-4", rowClassName?.(row))}>
                <div className="min-w-0 text-sm text-text-primary">{primary.cell(row, index)}</div>
                {detailColumns.length ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                    {detailColumns.map((column) => (
                      <div key={column.key} className="min-w-0">
                        <dt className="text-xs text-text-secondary">{column.mobileLabel || column.header}</dt>
                        <dd className="mt-0.5 min-w-0 text-sm break-words text-text-primary">{column.cell(row, index)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {actionColumns.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {actionColumns.map((column) => (
                      <div key={column.key} className="contents">{column.cell(row, index)}</div>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
      </ul>
    </div>
  );
}

/** Section whose body is collapsed until requested — for secondary tools such as bulk import. */
export function DisclosureSection({ icon: Icon, title, description, defaultOpen = false, className, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className={cn(ui.card, "min-w-0 overflow-hidden", className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
      >
        {Icon ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-text-secondary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-text-primary">{title}</span>
          {description ? <span className="mt-0.5 block text-sm text-text-secondary">{description}</span> : null}
        </span>
        <ChevronDown className={cn("size-5 shrink-0 text-text-secondary transition-transform motion-reduce:transition-none", open ? "rotate-180" : "")} aria-hidden="true" />
      </button>
      {open ? (
        <div id={bodyId} className="border-t border-border p-4 sm:p-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Previous/next pager with a page summary; place in a SectionCard footer. */
export function PaginationBar({ page = 1, pages = 1, total, onPageChange, disabled = false, className }) {
  const safePages = Math.max(1, Number(pages) || 1);
  const safePage = Math.min(Math.max(1, Number(page) || 1), safePages);
  return (
    <nav aria-label="Pagination" className={cn("flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary", className)}>
      <p className="tabular-nums">
        Page <span className="font-medium text-text-primary">{safePage}</span> of {safePages}
        {typeof total === "number" ? <span> · {total.toLocaleString()} total</span> : null}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" className="h-9 rounded-lg px-3" disabled={disabled || safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <Button variant="outline" className="h-9 rounded-lg px-3" disabled={disabled || safePage >= safePages} onClick={() => onPageChange(safePage + 1)}>
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

/** Two-column settings row: title/description on the left, controls on the right. */
export function SettingsSection({ icon, title, description, children, className }) {
  const Icon = icon;
  return (
    <section className={cn(ui.card, "grid gap-6 p-5 sm:p-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10", className)}>
      <div>
        <div className="flex items-center gap-2.5">
          {Icon ? (
            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </span>
          ) : null}
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        </div>
        {description ? <p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(String(text ?? ""));
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Unable to copy. Select the text and copy it manually.");
  }
};

function CredentialField({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-card px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="truncate font-mono text-sm font-medium text-text-primary select-all">{value}</p>
      </div>
      <Button type="button" variant="ghost" size="icon-lg" className="shrink-0 rounded-lg text-text-secondary" onClick={() => copyToClipboard(value)}>
        <Copy className="size-4" />
        <span className="sr-only">Copy {label}</span>
      </Button>
    </div>
  );
}

/** Newly generated login details for one account, each field copyable. */
export function CredentialPanel({ title = "Share these credentials securely", credentials, className }) {
  if (!credentials) return null;
  return (
    <div className={cn("space-y-2 rounded-lg border border-success/30 bg-success/5 p-4", className)} role="status">
      <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Check className="size-4 text-success" aria-hidden="true" />
        {title}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <CredentialField label="Email" value={credentials.identifier} />
        <CredentialField label="Student ID" value={credentials.studentId} />
        <CredentialField label="Password" value={credentials.password} />
      </div>
    </div>
  );
}

/** Credentials generated by a bulk import (shown once), with copy-all. */
export function CredentialList({ entries, className }) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return (
    <div className={cn("rounded-lg border border-success/30 bg-success/5 p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text-primary">Generated credentials (shown once)</p>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-lg"
          onClick={() => copyToClipboard(entries.map((entry) => `${entry.identifier}\t${entry.studentId}\t${entry.password}`).join("\n"))}
        >
          <Copy className="size-4" />
          Copy all
        </Button>
      </div>
      <ul className="mt-2 max-h-60 divide-y divide-border overflow-auto rounded-md bg-card font-mono text-xs">
        {entries.map((entry) => (
          <li key={`${entry.row}-${entry.studentId}`} className="px-3 py-1.5 text-text-primary">
            {entry.identifier} • {entry.studentId} • {entry.password}
          </li>
        ))}
      </ul>
    </div>
  );
}
