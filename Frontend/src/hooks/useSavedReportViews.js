import { useCallback, useEffect, useState } from "react";

/**
 * Saved report views.
 *
 * A view is just the report page's URL query string, so a preset is inherently
 * shareable — copy the URL and the recipient lands on the same filtered report.
 * Presets are stored per portal key in localStorage; nothing server-side is
 * needed and nothing sensitive is persisted (ids and filter values only).
 */
const storageKey = (scope) => `lms_report_views:${scope}`;

const readViews = (scope) => {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeViews = (scope, views) => {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(views));
  } catch {
    // Storage unavailable (private mode / quota) — presets are a convenience,
    // so fail quietly rather than breaking the report page.
  }
};

export default function useSavedReportViews(scope = "admin") {
  const [views, setViews] = useState(() => readViews(scope));

  useEffect(() => {
    setViews(readViews(scope));
  }, [scope]);

  const saveView = useCallback(
    (name, search) => {
      const trimmed = String(name || "").trim();
      if (!trimmed) return false;
      const next = [
        { id: `${Date.now()}`, name: trimmed, search: String(search || "") },
        ...readViews(scope).filter((view) => view.name.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, 20);
      writeViews(scope, next);
      setViews(next);
      return true;
    },
    [scope]
  );

  const removeView = useCallback(
    (id) => {
      const next = readViews(scope).filter((view) => view.id !== id);
      writeViews(scope, next);
      setViews(next);
    },
    [scope]
  );

  return { views, saveView, removeView };
}
