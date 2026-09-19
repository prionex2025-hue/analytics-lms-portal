const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

const getRoleFromPath = (pathname) => {
  if (pathname.startsWith("/super-admin") || pathname.startsWith("/superadmin")) return "super-admin";
  if (pathname.startsWith("/college-admin")) return "college-admin";
  if (pathname.startsWith("/admin")) return "admin";
  return "student";
};

const sendMetric = (name, value) => {
  if (!Number.isFinite(value)) {
    return;
  }

  const payload = JSON.stringify({
    name,
    value,
    path: window.location.pathname,
    role: getRoleFromPath(window.location.pathname),
  });

  const url = `${API_BASE_URL}/rum`;
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
    return;
  }

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
};

export const registerRumMetrics = () => {
  if (typeof PerformanceObserver === "undefined") {
    return;
  }

  try {
    new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const latest = entries[entries.length - 1];
      if (latest) sendMetric("LCP", latest.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // Some browsers do not expose this observer entry type.
  }

  try {
    let cls = 0;
    new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (!entry.hadRecentInput) {
          cls += entry.value || 0;
        }
      }
      sendMetric("CLS", cls);
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // Some browsers do not expose this observer entry type.
  }

  try {
    new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        sendMetric("FID", (entry.processingStart || 0) - entry.startTime);
      }
    }).observe({ type: "first-input", buffered: true });
  } catch {
    // Some browsers do not expose this observer entry type.
  }
};
