import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({
  className,
  ...props
}) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-xl border border-input bg-card px-3 py-2 text-base text-text-primary transition-colors outline-none placeholder:text-text-secondary focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props} />
  );
}

export { Textarea }
