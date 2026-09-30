import { Eye, X } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "superadmin-impersonation";

const readSession = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
};

export default function ImpersonationBanner() {
  const [session, setSession] = useState(() => readSession());

  useEffect(() => {
    const onStorage = () => setSession(readSession());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!session?.active) return null;

  return (
    <div role="status" className="border-b border-warning/35 bg-warning/12 px-4 py-2.5 text-sm text-text-primary sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2">
          <Eye className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <span>
            <strong className="font-semibold">Impersonation mode</strong> · Viewing as {session.targetName || "Unknown"} ({session.targetRole || "user"}). All writes are disabled.
          </span>
        </p>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-warning/40 bg-card px-3 text-xs font-semibold outline-none transition-colors hover:bg-warning/15 focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            setSession(null);
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
          Exit
        </button>
      </div>
    </div>
  );
}
