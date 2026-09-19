// Shared attributes for every portal's refresh-token cookie.
//
// Why this matters for "keep me logged in":
// The SPA stores its access token only in sessionStorage, which the browser
// wipes when the tab/window is closed. So on every fresh app open the session
// is restored *solely* from this refresh cookie via POST /auth/refresh.
//
// When the SPA and the API are served from different sites (e.g. a Netlify
// frontend calling an api.* backend on another domain), a `SameSite=Lax`
// cookie is NOT sent on that refresh XHR. The refresh then fails silently and
// the user is asked to log in every time — even with "keep me logged in"
// checked. `SameSite=None` is required for cross-site delivery, but browsers
// only accept it together with `Secure` (HTTPS). Local/same-site HTTP dev
// therefore falls back to `Lax`, which is valid same-site.
//
// Defaults: production -> `None` + `Secure`; otherwise -> `Lax`. Both can be
// overridden with AUTH_COOKIE_SAMESITE (none|lax|strict) and AUTH_COOKIE_SECURE
// for same-origin deployments that prefer stricter settings.

const REFRESH_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const isProduction = () => process.env.NODE_ENV === "production";

const normalizeSameSite = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return ["none", "lax", "strict"].includes(normalized) ? normalized : null;
};

const resolveSameSite = () =>
  normalizeSameSite(process.env.AUTH_COOKIE_SAMESITE) || (isProduction() ? "none" : "lax");

const resolveSecure = (sameSite) => {
  // Browsers reject `SameSite=None` unless the cookie is also `Secure`.
  if (sameSite === "none") return true;

  const override = String(process.env.AUTH_COOKIE_SECURE || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(override)) return true;
  if (["0", "false", "no", "off"].includes(override)) return false;

  return isProduction();
};

const buildRefreshCookieOptions = ({ path, keepLoggedIn = false } = {}) => {
  const sameSite = resolveSameSite();

  return {
    httpOnly: true,
    secure: resolveSecure(sameSite),
    sameSite,
    path,
    ...(keepLoggedIn ? { maxAge: REFRESH_COOKIE_MAX_AGE_MS } : {}),
  };
};

module.exports = { buildRefreshCookieOptions, REFRESH_COOKIE_MAX_AGE_MS };
