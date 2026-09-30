/**
 * Shared sign-in layout: brand panel (desktop only) + form column.
 * Used by the Student and Super Admin login pages.
 */
export default function AuthSplitLayout({ headline, subline, highlights = [], footnote, badgeIcon: BadgeIcon, badgeLabel, title, description, children, footer }) {
  return (
    <section className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="relative hidden overflow-hidden bg-primary-dark p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16 dark:bg-sidebar">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(59,130,246,0.45),transparent_45%)]" aria-hidden="true" />
        <img
          src="/analytics-logo-final.webp"
          alt="Analytics Logo"
          width="1976"
          height="630"
          decoding="async"
          className="relative h-9 w-auto max-w-56 object-contain object-left brightness-0 invert"
        />

        <div className="relative max-w-md">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight xl:text-5xl">{headline}</h1>
          {subline ? <p className="mt-4 text-base leading-7 text-white/75">{subline}</p> : null}
          {highlights.length ? (
            <ul className="mt-10 space-y-5">
              {highlights.map((item) => (
                <li key={item.title} className="flex gap-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                    <item.icon className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-0.5 text-sm text-white/65">{item.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <p className="relative text-xs text-white/50">{footnote}</p>
      </div>

      <div className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <img
            src="/analytics-logo-final.webp"
            alt="Analytics Logo"
            width="1976"
            height="630"
            decoding="async"
            className="mb-10 h-8 w-auto max-w-44 object-contain object-left lg:hidden dark:brightness-0 dark:invert"
          />

          {badgeLabel ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {BadgeIcon ? <BadgeIcon className="size-3.5" aria-hidden="true" /> : null}
              {badgeLabel}
            </span>
          ) : null}
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-text-primary">{title}</h2>
          {description ? <p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p> : null}

          {children}

          {footer}
        </div>
      </div>
    </section>
  );
}
