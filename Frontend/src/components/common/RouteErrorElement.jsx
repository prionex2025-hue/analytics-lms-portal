import { useRouteError } from "react-router-dom";

const isChunkLoadError = (message) =>
  message.includes("Failed to fetch dynamically imported module") ||
  message.includes("Importing a module script failed") ||
  message.includes("error loading dynamically imported module");

export default function RouteErrorElement() {
  const error = useRouteError();
  const message = error?.message || "Something went wrong while loading this page.";
  const chunkLoadError = isChunkLoadError(String(message));

  return (
    <section className="grid min-h-screen place-items-center bg-muted p-6">
      <article className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-text-primary">
          {chunkLoadError ? "Update required" : "Unable to load this page"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          {chunkLoadError
            ? "A newer version of the portal is available. Reload the page to continue with the latest files."
            : message}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-muted"
            onClick={() => window.history.back()}
          >
            Go Back
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </article>
    </section>
  );
}
