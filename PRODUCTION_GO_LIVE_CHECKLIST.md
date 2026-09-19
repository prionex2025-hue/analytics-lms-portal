# Production Go-Live Checklist — LMS Portal

A **verification gate** to run before opening the portal to real students. It complements
[`DEPLOY.md`](DEPLOY.md) (which is the step-by-step *how to deploy*); this file is the
*prove it's ready* checklist. Work top to bottom. **Do not open to students until every
`[ ] BLOCKER` is checked.** `[ ] WARN` items are strongly recommended but may be risk-accepted
with a named owner.

Legend: **BLOCKER** = go/no-go. **WARN** = fix or explicitly accept. Commands run from `Backend/`
unless noted. Replace `lms.yourdomain.com` with your real domain everywhere.

---

## 0. Deploy the code fixes from the security audit

These landed in the working tree this session and must be in the deployed build:

- [ ] **BLOCKER** Socket.IO tenant fix — students no longer join the `college:<id>` room (`Backend/src/realtime/socket.js`).
- [ ] **BLOCKER** 500 error-message hardening (`Backend/src/middleware/error-handler.js`).
- [ ] **BLOCKER** NoSQL `$`-operator strip in the DB layer (`Backend/src/config/db.js`).
- [ ] **WARN** Report null-name crash fix (`Backend/src/services/report-analytics-aggregation.service.js`).
- [ ] Confirm the deployed commit/image contains all of the above (diff or image tag check).

---

## 1. One-command readiness gate

The repo ships an automated gate. It must pass with the **production** env loaded:

```bash
npm run prod:check
```

- [ ] **BLOCKER** `prod:check` exits 0 with no BLOCKER findings.

It verifies (do not treat as optional — each is its own line item below): JWT secrets are not dev/placeholder,
Redis enabled, `MONGODB_URI` has credentials + a least-privilege app user + `replicaSet` matching
`MONGO_REPLICA_SET_NAME`, `FRONTEND_ORIGIN` is HTTPS-only (no wildcard/localhost), Mongo/Redis/replica-set
secrets aren't placeholders, required indexes exist, ClamAV reachable, and deployment artifacts are present.

---

## 2. Secrets & environment (`Backend/.env.production`)

Startup **fails fast** (`src/config/env.js`) if `MONGODB_URI` is missing or JWT secrets are < 32 chars — good.
Verify the rest:

**Auth / crypto**
- [ ] **BLOCKER** `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are unique, random, ≥ 32 chars, and **not** the CI/dev values. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.
- [ ] **BLOCKER** `PASSWORD_RESET_RETURN_TOKEN` is **false**/unset in production (env default is false in prod — confirm it wasn't overridden).
- [ ] `JWT_ACCESS_EXPIRES_IN` (default `15m`) and `JWT_REFRESH_EXPIRES_IN` (default `30d`) are intentional.

**Origins / CORS / CSP**
- [ ] **BLOCKER** `FRONTEND_ORIGIN` lists only the real HTTPS origin(s), comma-separated. No `*`, no `localhost`.
- [ ] **BLOCKER** CSP `connectSrc` in `src/app.js` points at your real domain (it is hard-coded to `lms.analyticsedify.com` / `wss://…`). If your domain differs, update it (see `DEPLOY.md` Step 5) — otherwise the SPA's API/WebSocket calls are blocked in the browser.

**Database**
- [ ] **BLOCKER** `MONGODB_URI` uses a least-privilege application user (not the Mongo root user) and includes `replicaSet=<name>` — transactions require a replica set.
- [ ] **BLOCKER** `MONGO_APP_PASSWORD`, `MONGO_REPLICA_SET_KEY` (≥ 128 chars), `MONGO_INITDB_ROOT_PASSWORD` are strong and not placeholders.
- [ ] `MONGO_REPLICA_SET_NAME` matches the `replicaSet` in the URI (default `rs0`).

**Redis**
- [ ] **BLOCKER** `REDIS_ENABLED=true`, `REDIS_URL` set, `REDIS_PASSWORD` strong. Redis backs exam locks, exam-state cache, rate limiting, the report queue, and Socket.IO horizontal scaling.
- [ ] `REDIS_QUEUE_ENABLED=true` (report jobs) and `WORKER_ENABLED` set correctly per replica (see §6).

**External services**
- [ ] `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` set (avatar/resource uploads).
- [ ] Email: `RESEND_API_KEY` set and `PASSWORD_RESET_DELIVERY_MODE=resend` (otherwise reset tokens won't be emailed).
- [ ] **BLOCKER** AV scanning: `UPLOAD_AV_SCAN_REQUIRED=true` (prod default) **and** ClamAV reachable at `CLAMAV_HOST`/`CLAMAV_PORT`, or the flag is consciously disabled with sign-off.
- [ ] `METRICS_ENABLED=true` and `METRICS_TOKEN` set to a strong bearer token (guards `/api/metrics`).

**Safety flags**
- [ ] **BLOCKER** `RATE_LIMIT_DISABLED` is **unset** (it exists only for load tests; leaving it on removes all rate limiting).
- [ ] `NODE_ENV=production`. `REQUEST_BODY_LIMIT` (default `5mb`) is intentional for your import sizes.
- [ ] `.env.production` is `chmod 600`, not committed, and excluded by `.gitignore`.

---

## 3. Database — indexes, migrations, replica set

- [ ] **BLOCKER** Replica set initialized and healthy (`rs.status()` → one PRIMARY). Required for transactions.
- [ ] **BLOCKER** Indexes created: `npm run db:create-indexes` (the wrapper uses the raw driver, so Mongoose `.index()` is **not** auto-built — this script is mandatory).
- [ ] **BLOCKER** Migrations applied in order:
  ```bash
  npm run db:migrate:objectid-ids
  npm run db:migrate:admin-access-profiles
  npm run db:migrate:refresh-token-hashes
  npm run db:migrate:violations
  ```
- [ ] First SuperAdmin created (`npm run create`) and login verified (`npm run verify`).

---

## 4. Health, readiness & liveness

With the stack up behind TLS:

- [ ] **BLOCKER** `GET https://lms.yourdomain.com/api/live` → 200 (liveness; used by the orchestrator).
- [ ] **BLOCKER** `GET /api/ready` → 200 with `checks.mongodb=ok` and `redis` not `down` (returns 503 when a dependency is down — confirm it flips correctly by testing against a stopped Redis in staging).
- [ ] `GET /api/health` → 200 (same snapshot).
- [ ] `GET /api/metrics` **without** the token → 401/403; **with** `Authorization: Bearer $METRICS_TOKEN` → 200 Prometheus text.
- [ ] Orchestrator (PM2/systemd/compose) restart policy points liveness at `/api/live` and readiness at `/api/ready`.

---

## 5. Security config verification (spot-checks against a live staging URL)

- [ ] **BLOCKER** Response headers include HSTS (`Strict-Transport-Security`), `X-Frame-Options: DENY` / frame-ancestors none, and CSP. `X-Powered-By` absent.
- [ ] **BLOCKER** A cross-origin `POST` from a non-allowed origin is rejected (CORS + trusted-origin guard returns 403 `UNTRUSTED_ORIGIN`/`CORS_ORIGIN_DENIED`).
- [ ] **BLOCKER** Login operator-injection is blocked: `POST /api/auth/login` with `{"identifier":{"$ne":null},"password":"x"}` → 422 (zod), not a login.
- [ ] Login rate limiting works: repeated bad logins eventually return 429.
- [ ] A student JWT cannot hit an `/api/admin/*` or `/api/super-admin/*` route (403).
- [ ] `trust proxy` is correct so client IPs (rate-limit keys) are the real client, not the proxy.

---

## 6. Web/worker topology

- [ ] Exactly the intended replicas run the report worker: `WORKER_ENABLED=true` on the worker replica(s) only; API-only replicas set it false (prevents multiplying Puppeteer/PDF work). Single-instance deploys leave the default (true).
- [ ] Chromium/Chrome available to the worker (`PUPPETEER_EXECUTABLE_PATH` set or a system Chrome present) — generate one report end-to-end and confirm the PDF downloads.
- [ ] On worker restart, stale `PROCESSING` report jobs recover to `QUEUED` (kill a worker mid-report in staging; confirm it re-runs within ~15 min).

---

## 7. Load testing (the gate I cannot run for you)

Seed a realistic student cohort and a published test in **staging**, then run k6 against it.
Required env: `BASE_URL`, `TEST_ID`, and either `STUDENT_IDENTIFIER`+`STUDENT_PASSWORD` or `STUDENTS_JSON`
(a JSON array of `{identifier,password}`). Set `RUN_SUBMIT=true` to include submission.

Ramp up progressively — do not jump straight to peak:

```bash
# smoke (100 concurrent), then 500, then your real peak
BASE_URL=https://staging.yourdomain.com TEST_ID=<id> STUDENTS_JSON='[...]' RUN_SUBMIT=true npm run load:exam-flow:100
BASE_URL=... TEST_ID=... STUDENTS_JSON='[...]' RUN_SUBMIT=true npm run load:exam-flow:500
BASE_URL=... TEST_ID=... STUDENTS_JSON='[...]' RUN_SUBMIT=true npm run load:exam-flow:1000
# exam-start spike (thundering herd at the top of the hour):
BASE_URL=... npm run load:exam-start:strict
```

Pass/fail thresholds are enforced by the script (`scripts/load/exam-flow.k6.js`) — the run **fails**
if any are breached:

- [ ] **BLOCKER** `http_req_failed` rate **< 1%**.
- [ ] **BLOCKER** `http_req_duration` **p95 < 1000 ms** and **p99 < 2000 ms**.
- [ ] **BLOCKER** `answer_save_latency_ms` **p95 < 750 ms**.
- [ ] **BLOCKER** Run at **≥ your expected peak concurrency** (e.g. `load:exam-flow:1000` for ~1000 simultaneous students; use `:2000`/`:5000` scripts or `TARGET_USERS` for higher).
- [ ] During the run, watch Mongo (connections, slow queries, replica lag), Redis (memory, evictions), CPU/RAM on API + worker, and the Puppeteer worker. No OOM, no connection-pool exhaustion.
- [ ] Re-run the exam-start spike separately — this is the highest-contention moment.

**Do not size prod from a passing 100-user run.** Test at real peak with submission enabled.

---

## 8. Monitoring & observability

- [ ] Prometheus scraping `/api/metrics` with the bearer token (see `docker-compose.monitoring.yml`, `deploy/monitoring`).
- [ ] Alerts wired (`ALERTMANAGER_WEBHOOK_URL`) for: `/api/ready` failing, 5xx rate, event-loop/latency, Mongo down, Redis down, disk usage (upload volume), worker failures.
- [ ] Structured request logs carry `request_id` (production morgan format) and are shipped/retained.
- [ ] Log review confirms **no** secrets, tokens, or passwords are logged.

---

## 9. Backup & disaster recovery (before real traffic)

- [ ] **BLOCKER** Automated backups scheduled: `npm run backup:all` (Mongo + uploads) on a cron; `BACKUP_ROOT` on durable/off-box storage.
- [ ] **BLOCKER** Restore actually works — run the drill, don't assume: `npm run backup:restore-drill` (and/or `restore:mongodb` / `restore:uploads` into a scratch target).
- [ ] `npm run backup:verify` passes; off-site sync (`backup:sync`) configured.
- [ ] Documented RPO/RTO and who runs the restore at 2am.
- [ ] TLS cert auto-renewal (certbot timer) verified; renewal reloads nginx.

---

## 10. Deploy mechanics & rollback

- [ ] Deploy performed per `DEPLOY.md` (Steps 1–13); firewall closed to all but 80/443 (+ SSH).
- [ ] **Rollback path proven**: you can redeploy the previous image/commit and it comes up healthy (`/api/ready` 200). Note: DB migrations are forward-only — confirm the previous build is compatible with the migrated schema, or have a data rollback plan.
- [ ] Zero-downtime consideration for deploys **during active exams**: draining/rolling restart keeps in-flight attempts alive (server-authoritative timers + resume-on-reconnect handle brief drops, but avoid deploying mid-exam if possible).
- [ ] `local-production` smoke passes where applicable: `npm run smoke:local-production`.

---

## 11. Final go / no-go

| Gate | Owner | Status | Notes |
|------|-------|--------|-------|
| §0 Audit fixes deployed | | ☐ | |
| §1 `prod:check` green | | ☐ | |
| §2 Secrets/env | | ☐ | |
| §3 Indexes + migrations + replica set | | ☐ | |
| §4 Health/readiness | | ☐ | |
| §5 Security spot-checks | | ☐ | |
| §7 Load test at peak passed | | ☐ | |
| §9 Backup + **restore drill** | | ☐ | |
| §10 Rollback proven | | ☐ | |

**Sign-off (all BLOCKERS clear):** _______________  Date: __________

---

### Known limitations / risk register (carry into launch)
- **Single points of failure** — see `DEPLOY.md` "Notes / known single points of failure". Confirm whether Mongo/Redis are single-node and accept or mitigate.
- **Deeper testing not yet done**: property/chaos testing of dependency-down paths (Mongo/Redis/Cloudinary/SMTP mid-exam) beyond the readiness probe. Recommended post-launch.
- **Report `errorMessage`** is surfaced to admins on failed report jobs — acceptable (admin-facing) but avoid putting sensitive data in aggregation errors.
