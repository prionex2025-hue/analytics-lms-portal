// Shared class recipes for the Student portal. Keep page markup on these so
// spacing, radius, and type stay consistent across screens.
export const ui = {
  pageSection: "space-y-6",
  card: "rounded-xl border border-border bg-card shadow-xs",
  cardInteractive:
    "rounded-xl border border-border bg-card shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-primary/40 hover:shadow-sm",
  cardPadding: "p-4 sm:p-5",
  cardPaddingLg: "p-5 sm:p-6",
  titleLg: "text-lg font-semibold tracking-tight text-text-primary",
  titleXl: "text-2xl font-semibold tracking-tight text-text-primary sm:text-[28px]",
  subtitle: "text-sm leading-6 text-text-secondary",
  overline: "text-xs font-medium uppercase tracking-wider text-text-secondary",
  // Touch-friendly button sizing (≥40px) layered on top of the shared Button.
  btn: "h-10 rounded-lg px-4",
  btnIcon: "size-10 rounded-lg",
  field: "h-10 rounded-lg bg-card",
};
