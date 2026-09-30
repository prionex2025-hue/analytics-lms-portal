import { AlertTriangle, ArrowLeft, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export const isChunkLoadError = (message) => {
  const text = String(message || "");
  return (
    text.includes("Failed to fetch dynamically imported module") ||
    text.includes("Importing a module script failed") ||
    text.includes("error loading dynamically imported module")
  );
};

/**
 * Full-page error state shared by the route error element and the app-level
 * error boundary. A chunk-load failure means this tab is holding references to
 * files from an older build (or a dev server that restarted) — reloading fetches
 * the current ones.
 */
export default function ErrorScreen({ chunkLoadError = false, message, onRetry, onBack }) {
  const Icon = chunkLoadError ? RefreshCw : AlertTriangle;

  return (
    <section className="grid min-h-screen place-items-center bg-background p-6">
      <article role="alert" className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <span
          className={`mx-auto grid size-12 place-items-center rounded-full ${chunkLoadError ? "bg-primary/10 text-primary" : "bg-danger/10 text-danger"}`}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-text-primary">
          {chunkLoadError ? "Update required" : "Unable to load this page"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          {chunkLoadError
            ? "A newer version of the portal is available. Reload the page to continue with the latest files."
            : message || "Something went wrong while loading this page."}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          {onBack ? (
            <Button type="button" variant="outline" className="h-10 rounded-lg px-4" onClick={onBack}>
              <ArrowLeft className="size-4" />
              Go Back
            </Button>
          ) : null}
          {onRetry && !chunkLoadError ? (
            <Button type="button" variant="outline" className="h-10 rounded-lg px-4" onClick={onRetry}>
              <RotateCcw className="size-4" />
              Retry
            </Button>
          ) : null}
          <Button type="button" className="h-10 rounded-lg px-4" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" />
            Reload
          </Button>
        </div>
      </article>
    </section>
  );
}
