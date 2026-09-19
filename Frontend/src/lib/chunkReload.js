const RELOAD_STORAGE_KEY = "lms_dynamic_import_reload";

const isDynamicImportFailure = (error) => {
  const message = String(error?.message || error || "");
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("error loading dynamically imported module")
  );
};

const reloadOnceForFreshAssets = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const lastReload = Number(window.sessionStorage.getItem(RELOAD_STORAGE_KEY) || 0);
    const now = Date.now();

    if (now - lastReload < 30000) {
      return;
    }

    window.sessionStorage.setItem(RELOAD_STORAGE_KEY, String(now));
  } catch {
    // Reload even if sessionStorage is blocked.
  }

  window.location.reload();
};

export const registerChunkReloadHandler = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceForFreshAssets();
  });

  window.addEventListener("error", (event) => {
    if (isDynamicImportFailure(event.error)) {
      reloadOnceForFreshAssets();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isDynamicImportFailure(event.reason)) {
      event.preventDefault();
      reloadOnceForFreshAssets();
    }
  });

  // A failed <link rel="stylesheet"> or <script> (e.g. a hashed asset that a
  // deploy already deleted) fires an "error" event that does NOT bubble, so the
  // window-level listeners above never see it. Capture-phase catches it. This is
  // what recovers a student left on an UNSTYLED page after a deploy.
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (!target || target === window) {
        return;
      }
      const tag = target.tagName;
      const url = String(target.href || target.src || "");
      if ((tag === "LINK" || tag === "SCRIPT") && /\/assets\/.+\.(css|js)(\?|$)/.test(url)) {
        reloadOnceForFreshAssets();
      }
    },
    true
  );
};
