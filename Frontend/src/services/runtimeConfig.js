const normalizeBaseUrl = (value, fallback = "") => {
  const base = String(value || fallback || "").trim();
  if (!base) {
    return fallback;
  }

  return base.replace(/\/+$/, "");
};

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL, "/api");

export const SOCKET_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_SOCKET_URL || API_BASE_URL.replace(/\/api$/, ""),
  typeof window !== "undefined" ? window.location.origin : ""
);
