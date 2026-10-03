# Redis, rate limiting and dependency-failure policy

## Request pipeline

```
Client -> host NGINX (TLS, overwrites X-Forwarded-For) -> frontend NGINX (appends) -> Express (TRUST_PROXY=2 -> req.ip)
  -> request id -> CORS/origin check -> helmet -> body limits
  -> general per-principal limiter (/api/*)            middleware/rate-limit.js
  -> portal limiter (/api/college-admin, /api/super-admin)
  -> route: authenticate -> route limiter -> permission -> zod validation -> controller -> MongoDB
```

`req.ip` is the only client-IP source (`utils/client-ip.js`). Never read `X-Forwarded-For` directly.
`TRUST_PROXY` must equal the number of proxies in front of Node (Docker stack: 2).

## What Redis is used for

| Use | Module | Keys | If Redis is unavailable |
|---|---|---|---|
| Rate-limit counters (shared by all replicas) | `middleware/rate-limit.js` | `rate:<scope>:<sha256(identity)[:32]>` (TTL = window) | Production requests requiring a rate limit return 503; per-process memory counters are development/test only. |
| Login lockout (identifier+IP, per account) | `services/login-attempt.service.js` | `login_attempt:<scope>:...:<sha256>` + `:lock` | Production login protection returns HTTP 503 if Redis is unavailable; per-process memory is development/test only. |
| Forgot-password per-account quota | `services/password-reset.service.js` via `consumeRateLimit` | `rate:forgot-password-account:<scope>:<hash>` | Production limiter returns HTTP 503 if Redis is unavailable. |
| Access-token logout blocklist (jti) | `services/access-token-revocation.service.js` | `auth:access:revoked:<jti>` | Authentication and logout return 503 in production until shared revocation state is available. Per-process memory is development/test only. |
| Response cache (per-principal, per-college keys) | `middleware/response-cache.js` | `resp_cache:<college or actor>:<scope>:<hash>` | Bypassed in production (served from MongoDB). |
| Auth principal / test / exam-state / leaderboard caches | `services/*-cache.service.js`, leaderboard controller | various | Bypassed -> MongoDB. |
| Exam start/submit/advance locks | `services/redis-lock.service.js` | lock keys | Task runs without the lock; correctness relies on atomic MongoDB guards (`updateMany({status: IN_PROGRESS})`). |
| BullMQ report queues | `services/*report-queue.service.js` | `bull:*` | Reports cannot be enqueued/processed until Redis returns. |
| Socket.IO adapter (cross-replica events) | `realtime/socket.js` | pub/sub | Production sockets on each replica are disconnected when shared Redis state drops; clients reconnect after Redis returns. |

Production readiness (`/api/ready`) requires both MongoDB and Redis. A Redis outage removes all API
replicas from service until shared rate-limit and revocation state is available again. Set
`REDIS_REQUIRED_FOR_READINESS=false` only in a non-production environment where weaker local state is
acceptable.

Rate-limited requests fail closed with HTTP 503 while Redis is unavailable. The rate-limit degraded
metric tracks telemetry storage fallback only; it does not indicate that security counters switched
to process-local memory.

Redis must run with `maxmemory-policy noeviction` (BullMQ requirement). All non-queue keys carry TTLs.

## Rate-limit policy

Fixed windows, atomic Lua `INCR`+`PEXPIRE` (one round trip). "Failed only" limits reserve a unit per
request and release it when the response is not a failure, so parallel bursts cannot overshoot. Identities are hashed before use as keys.
All values are env-configurable (`config/env.js`); defaults below.

| Route / category | Limit | Window | Identifier | Why |
|---|---|---|---|---|
| Login (student, admin, college admin): all attempts | 600 | 15 min | client IP | Flood / CPU (bcrypt) guard. Generous because a campus lab shares one NAT IP. |
| Login: failed attempts only (HTTP 401) | 60 | 15 min | client IP | Password spraying across many accounts. Successful logins never count. |
| Login lockout: identifier + IP | 5 failures -> 5 min, doubling to 30 min | 15 min sliding | sha256(identifier) + IP | Brute force on one account without letting strangers lock the owner out. |
| Login lockout: identifier (all IPs) | 25 failures -> lockout | 15 min sliding | sha256(identifier) | Distributed guessing on one account. |
| Super admin login: all / failed | 20 / 5 | 15 min | client IP | Highest-privilege accounts. Applies also to `/api/auth/login` with `role: SUPER_ADMIN`. |
| Refresh token | 20 | 5 min | sha256(refresh token) | Per session, so a NAT'd lab is not throttled as one user. |
| Refresh token: per-IP ceiling | 1500 | 5 min | client IP | Flood guard for token-rotation spam. |
| Forgot password | 20 | 15 min | client IP | Abuse / email cost. |
| Forgot password: per account | 3 emails | 1 h | account id | Mail-bombing one inbox. Excess requests get the same generic 202, so no enumeration. |
| Reset password | 10 | 15 min | client IP | Token guessing (tokens are 256-bit; this is defence in depth). |
| Super admin forgot/reset | 3 | 1 h | client IP | |
| General `/api/*` (incl. logout, /me) | 240 | 1 min | user (valid JWT) else IP | Baseline per-principal budget. |
| `/api/college-admin/*` | 180 | 1 min | user | |
| `/api/super-admin/*` | 600 | 1 min | user | |
| Exam start / list / session | 20/min, 20/30s, 30/30s | | user (+test/attempt) | Existing (`routes/Students/tests*.routes.js`). |
| Exam answer / heartbeat / violation / submit | 100/min, 30/min, 12/min, 3/15s | | user + test + attempt | Existing. |
| Reports: admin read / generation, super admin read / generation | 20/30s, 10/min, 180/min, 20/min | | user | Heavy aggregations / Puppeteer. |
| Search, leaderboard, analytics, settings, entity read/write, bulk import, resource upload/download/search | see `config/env.js` | | user | Existing. |
| Socket.IO handshake: failed auth | 60 | 5 min | client IP (proxy-aware) | Token guessing / handshake floods (each costs JWT verify + DB load). Reserved per attempt, released on success. |
| Socket.IO handshake: connections | 30 | 1 min | user | Reconnect loops, one token opening many sockets. |
| Host NGINX edge (`/api/*auth/*`) | 20 r/s, burst 200 | | client IP | Coarse flood guard before Node; generous for campus NAT. |
| `/api/live`, `/api/ready`, `/api/health`, `/api/metrics` | not limited | | | Internal monitoring (`/api/metrics` needs `METRICS_TOKEN`). |

### Shared-NAT campuses

A single insider can burn a campus IP's failed-login budget (60/15 min) and block logins from that IP.
Mitigations: raise `RATE_LIMIT_AUTH_LOGIN_FAILED_MAX`, or list the campus egress IPs/CIDRs in
`RATE_LIMIT_AUTH_TRUSTED_NETWORKS` (exempts them from the per-IP login/refresh ceilings only; per-account
lockout still applies; never applies to super admin login). Blocked attempts are logged with the IP
(`rate_limit.exceeded`, `auth.login_locked`).

## Health endpoints

| Endpoint | Meaning | Checks |
|---|---|---|
| `GET /api/live` | Process up | none (never restarts containers because a dependency is down) |
| `GET /api/ready` | Can serve traffic | MongoDB ping (2 s timeout) required; Redis reported; 503 while shutting down |
| `GET /api/health` | Alias of `/api/ready` | |

Public bodies contain only `status`, `checks.{mongodb,redis}` and `uptime`.

## Shutdown sequence (SIGTERM)

readiness -> 503, stop sweeps, disconnect this replica's sockets, stop accepting HTTP and drain in-flight
requests, finish active BullMQ jobs, close Socket.IO Redis clients, MongoDB, Redis. Forced exit after
`SHUTDOWN_TIMEOUT_MS` (15 s); Docker `stop_grace_period` is 30 s.
