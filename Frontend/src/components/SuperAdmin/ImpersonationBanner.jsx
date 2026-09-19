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
    <div className="border-b border-warning/30 bg-warning/15 px-4 py-2 text-sm text-warning">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <strong>Impersonation mode</strong> Viewing as: {session.targetName || "Unknown"} ({session.targetRole || "user"}) - All writes are disabled.
        </p>
        <button
          type="button"
          className="rounded-md border border-warning/40 px-2 py-1 text-xs font-semibold hover:bg-warning/20"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            setSession(null);
          }}
        >
          Exit
        </button>
      </div>
    </div>
  );
}
