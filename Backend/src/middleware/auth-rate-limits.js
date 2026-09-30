// Central rate-limit policy for authentication endpoints (all portals).
//
// Design constraints specific to this LMS:
//  - Students sit exams from college labs, so hundreds of legitimate users can
//    share ONE public (NAT) IP and all log in within a few minutes. A tight
//    "N logins per IP" limit locks a whole exam hall out. So:
//      * the per-IP ceiling on ALL login attempts is generous (flood guard),
//      * a much lower per-IP ceiling applies only to FAILED logins (401), which
//        is what password spraying across many accounts produces,
//      * per-account brute force is handled by login-attempt.service
//        (identifier+IP lockout, plus a higher cross-IP per-account ceiling).
//  - Refresh is keyed per refresh token (session), not per IP.
//  - Forgot-password is limited per IP here and per target account inside
//    password-reset.service (silently, so it cannot be used for enumeration).
//
// Limiter order on each route: flood/IP guard first, then the narrower one.

const env = require("../config/env");
const { authKeyByIp, createRateLimiter, refreshKeyBySession } = require("./rate-limit");
const { getClientIp } = require("../utils/client-ip");
const { createIpAllowlist } = require("../utils/ip-allowlist");

const trustedNetworks = createIpAllowlist(env.rateLimit.authTrustedNetworks || []);
const isTrustedNetwork = (req) => trustedNetworks.has(getClientIp(req));

// Combine an optional route-specific skip with the trusted-network exemption.
const skipWhen = (...predicates) => (req) => predicates.some((predicate) => predicate && predicate(req));

const isFailedLogin = (_req, res) => res.statusCode === 401;

const normalizeRole = (value) => String(value || "").trim().replace(/[\s-]+/g, "_").toUpperCase();
const isSuperAdminRoleRequest = (req) => normalizeRole(req.body?.role) === "SUPER_ADMIN";

const buildLoginLimiters = ({ portal, routeLabel, superAdmin = false, skip }) => {
  const cfg = env.rateLimit;
  const windowMs = superAdmin ? cfg.superAdminAuthLoginWindowMs : cfg.authLoginWindowMs;
  const effectiveSkip = superAdmin ? skip : skipWhen(skip, isTrustedNetwork);

  return [
    createRateLimiter({
      scope: `${portal}-login`,
      routeLabel,
      windowMs,
      max: superAdmin ? cfg.superAdminAuthLoginAttemptMax : cfg.authLoginMax,
      keySelector: authKeyByIp,
      skip: effectiveSkip,
      failOpen: false,
      message: "Too many login attempts from this network. Please retry in a few minutes.",
    }),
    createRateLimiter({
      scope: `${portal}-login-failed`,
      routeLabel,
      windowMs,
      max: superAdmin ? cfg.superAdminAuthLoginMax : cfg.authLoginFailedMax,
      keySelector: authKeyByIp,
      countIf: isFailedLogin,
      skip: effectiveSkip,
      failOpen: false,
      message: "Too many failed login attempts. Please retry in a few minutes.",
    }),
  ];
};

const buildRefreshLimiters = ({ portal, routeLabel }) => [
  createRateLimiter({
    scope: `${portal}-refresh-ip`,
    routeLabel,
    windowMs: env.rateLimit.authRefreshWindowMs,
    max: env.rateLimit.authRefreshIpMax,
    keySelector: authKeyByIp,
    skip: isTrustedNetwork,
    failOpen: false,
    message: "Too many token refresh requests. Please retry shortly.",
  }),
  createRateLimiter({
    scope: `${portal}-refresh`,
    routeLabel,
    windowMs: env.rateLimit.authRefreshWindowMs,
    max: env.rateLimit.authRefreshMax,
    keySelector: refreshKeyBySession,
    failOpen: false,
    message: "Too many token refresh requests. Please retry shortly.",
  }),
];

const buildPasswordResetLimiters = ({ portal, superAdmin = false }) => {
  const cfg = env.rateLimit;
  return {
    forgotPassword: createRateLimiter({
      scope: `${portal}-forgot-password`,
      routeLabel: `/api/${portal}/auth/forgot-password`,
      windowMs: superAdmin ? cfg.superAdminPasswordResetWindowMs : cfg.authForgotPasswordWindowMs,
      max: superAdmin ? cfg.superAdminPasswordResetMax : cfg.authForgotPasswordMax,
      keySelector: authKeyByIp,
      failOpen: false,
      message: "Too many password reset requests. Please retry later.",
    }),
    resetPassword: createRateLimiter({
      scope: `${portal}-reset-password`,
      routeLabel: `/api/${portal}/auth/reset-password`,
      windowMs: superAdmin ? cfg.superAdminPasswordResetWindowMs : cfg.authResetPasswordWindowMs,
      max: superAdmin ? cfg.superAdminPasswordResetMax : cfg.authResetPasswordMax,
      keySelector: authKeyByIp,
      failOpen: false,
      message: "Too many password reset attempts. Please retry later.",
    }),
  };
};

/**
 * Limiters for one portal's auth router.
 * portal: "student" | "admin" | "super-admin"
 */
const buildAuthRateLimiters = (portal) => {
  const superAdmin = portal === "super-admin";
  const routeBase = portal === "student" ? "/api/auth" : `/api/${portal}/auth`;
  const resetLimiters = buildPasswordResetLimiters({ portal, superAdmin });

  // /api/auth/login also accepts { role: "SUPER_ADMIN" } (unified login page).
  // Those requests get the strict super-admin policy (sharing its counters)
  // instead of the student one.
  const login = portal === "student"
    ? [
        ...buildLoginLimiters({
          portal: "student",
          routeLabel: `${routeBase}/login`,
          skip: isSuperAdminRoleRequest,
        }),
        ...buildLoginLimiters({
          portal: "super-admin",
          routeLabel: `${routeBase}/login`,
          superAdmin: true,
          skip: (req) => !isSuperAdminRoleRequest(req),
        }),
      ]
    : buildLoginLimiters({ portal, routeLabel: `${routeBase}/login`, superAdmin });

  return {
    login,
    refresh: buildRefreshLimiters({ portal, routeLabel: `${routeBase}/refresh` }),
    forgotPassword: resetLimiters.forgotPassword,
    resetPassword: resetLimiters.resetPassword,
  };
};

module.exports = {
  buildAuthRateLimiters,
  isTrustedNetwork,
  isFailedLogin,
  isSuperAdminRoleRequest,
};
