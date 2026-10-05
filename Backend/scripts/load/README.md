# Production Load Testing

Use these k6 scripts against a production-like environment with MongoDB and Redis enabled.

## Full-Length Production Exam Simulation

`exam-flow-production.k6.js` is a different test from `exam-flow.k6.js`. The older
script is a short throughput probe: one login, one list, one start, one answer,
one optional submit. The production script holds one real student per VU for the
entire exam window and replays the full lifecycle:

1. `POST /api/auth/login`
2. `GET /api/tests/ongoing` and test selection
3. `POST /api/tests/:id/agree`
4. `POST /api/tests/:id/start`
5. One `POST /api/tests/:id/answer` per question, paced across the exam window,
   with the correct payload per question type (`selectedOption` for `mcq`,
   `answerBoolean` for `true_false`, `answerText` for `fill_blank`/`paragraph`)
6. `POST /api/tests/:id/heartbeat` every 15s
7. `POST /api/auth/refresh` before the access token expires
8. `POST /api/tests/:id/submit`

Heartbeats are every 15s because the backend marks a student `DISCONNECTED`
after 20s of silence and auto-submits after 15 minutes. Lowering
`HEARTBEAT_INTERVAL_SECONDS` will silently turn the run into an auto-submit test.

### Credentials

Accounts are read from a JSON file in k6's init context, so passwords never
appear in argv, `ps` output, or shell history:

```json
[
  { "identifier": "student1@example.com", "password": "..." },
  { "identifier": "student2@example.com", "password": "..." }
]
```

The default path is `student_accounts.json` next to the script. It is covered by
`Backend/scripts/load/*.json` in `.gitignore`; do not remove that rule or commit
the file. Each VU maps to one account via `exec.vu.idInTest`, so the run needs
at least as many accounts as target VUs.

### Preflight

Run from `Backend` on a machine that can reach the API directly.

```bash
# 1. Confirm credentials work and that a startable test is visible, without
#    starting an attempt. Use one account, then delete nothing.
BASE_URL="https://lms.example.com" k6 run \
  -e TARGET_USERS=1 -e PROFILE=500 -e RUN_SUBMIT=false -e EXAM_DURATION_SECONDS=30 \
  scripts/load/exam-flow-production.k6.js

# 2. Back up the production env so rate-limit changes can be reverted.
cp Backend/.env.production Backend/.env.production.loadtest-backup
```

The single-VU run must produce a successful login, `/agree`, `/start`, at least
one answer, and a `exams_in_progress` value of 1. If it reports
`no_startable_test`, the accounts are not assigned to the selected test and the
full run would only measure rate limiting.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:5000` | API base URL |
| `ACCOUNTS_FILE` | `student_accounts.json` | Credential file, resolved in init context |
| `PROFILE` | `500` | `500` or `1000` |
| `TARGET_USERS` | profile value | Override the concurrency target |
| `TEST_ID` | auto | Pin a specific test instead of picking the first startable one |
| `EXAM_DURATION_SECONDS` | `3900` (65m) | Per-VU exam length |
| `EXAM_MARGIN_SECONDS` | `90` | Stop this long before the server's own expiry so submit wins the race |
| `HEARTBEAT_INTERVAL_SECONDS` | `15` | Must stay below 20 |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Match `JWT_ACCESS_EXPIRES_IN` |
| `TOKEN_REFRESH_RATIO` | `0.7` | Refresh after this fraction of the TTL |
| `RUN_SUBMIT` | `true` | Set `false` to measure throughput only |
| `DEBUG_FAILURES` | `false` | Log response bodies on failure |

Wrapper-only variables for `run-exam-load-test.sh`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `K6_CPUS` | `6,7` | `taskset` CPU list for the k6 container |
| `PROMETHEUS_URL` | `http://127.0.0.1:9090/api/v1/write` | Remote-write endpoint |
| `RUN_ID` | `exam-<profile>-<timestamp>` | Correlates a run across k6, Grafana and the log file |

### Running on the app host

`run-exam-load-test.sh` wraps the containerised run and adds the preflight
checks that make a host-local run interpretable. Use it when the test runs on the
same machine that serves the API.

```bash
cd Backend
./scripts/load/run-exam-load-test.sh --profile 500 --dry-run   # preflight only
./scripts/load/run-exam-load-test.sh --profile 500
```

The script refuses to start when the accounts file is short of the profile size,
warns when `K6_CPUS` names a core the host does not have, and reads
`RATE_LIMIT_AUTH_LOGIN_MAX` out of the running `api1` container to catch the
per-IP login ceiling before it silently throttles the whole run.

#### Why k6 is pinned to specific cores

`docker-compose.production.yml` already declares 9.0 CPU ceilings on an 8 vCPU
host (mongo 2.0, redis 1.0, clamav 1.0, api1/api2/api3 1.5 each, frontend 0.5).
An unpinned k6 competes with the API for the same cores, and the resulting
latency figures describe the generator starving rather than the API saturating.
The wrapper passes `--cpus 6,7` to `docker run` so the application keeps the
other cores.

Override with `K6_CPUS`, choosing the last cores on the host:

```bash
K6_CPUS=10,11 ./scripts/load/run-exam-load-test.sh --profile 500
```

#### Caveats of running on the app host

This is a compromise, not a dedicated load host. Treat results as follows:

- k6 shares CPU, memory bandwidth and NIC with the application, so absolute
  latency is pessimistic versus a remote generator.
- Every request comes from one source IP, so the per-IP auth ceilings apply as
  they would to a single NAT'd office, not as they would from 1000 distinct
  students.
- The run is representative of nginx -> TLS termination -> round-robin across
  all three replicas, which is a real advantage over hitting the API directly.
- Check for CPU throttling while it runs. If `docker stats --no-stream` shows
  the api containers pinned at their `cpus` ceiling, the numbers are measuring
  the ceiling and the profile needs to be re-run on a separate host to be
  meaningful.

### Running from a separate machine

Requests then bypass nginx, so the round-robin across replicas and TLS
termination are no longer part of the measurement. Prometheus is bound to
loopback, so tunnel it:

```bash
ssh -N -L 9090:127.0.0.1:9090 deploy@srv1986922
```

```bash
cd Backend
BASE_URL="https://lms.example.com" \
K6_PROMETHEUS_RW_SERVER_URL=http://127.0.0.1:9090/api/v1/write \
K6_PROMETHEUS_RW_TREND_STATS=p(95),p(99),max,med \
K6_PROMETHEUS_RW_LABELS="environment=production,testid=exam-500-run1" \
npm run load:exam-full:500 -- --out experimental-prometheus-rw --tag testid=exam-500-run1
```

Or with Docker directly, which is how the script was validated:

```bash
docker run --rm -i \
  -v "$PWD:/work" -w /work \
  -e BASE_URL="https://lms.example.com" \
  -e PROFILE=500 \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://host.docker.internal:9090/api/v1/write \
  -e K6_PROMETHEUS_RW_TREND_STATS=p(95),p(99),max,med \
  --add-host host.docker.internal:host-gateway \
  grafana/k6 run --out experimental-prometheus-rw scripts/load/exam-flow-production.k6.js
```

Run 500 first. Only attempt 1000 once the 500 run meets every pass criterion
below.

### Rate limits

Exam write limiters are keyed per actor (`rate-limit.js` builds
`user:ROLE:id:test:testId:attempt:submissionId`), so 1000 concurrent students do
not share a quota. The ceilings that matter are the per-IP auth ones, because
every k6 VU comes from one address:

| Variable | Default | Note |
| --- | --- | --- |
| `RATE_LIMIT_AUTH_LOGIN_MAX` | `600` per 15m | 1000 logins from one IP exceeds the default; `Backend/.env.production` sets `2000` |
| `RATE_LIMIT_AUTH_LOGIN_FAILED_MAX` | `60` per 15m | Any bad credential in the file burns this shared budget |
| `RATE_LIMIT_AUTH_REFRESH_IP_MAX` | `1500` per 5m | Refresh is also limited per session (default 20 per 5m), which is per student and fine |

`RATE_LIMIT_AUTH_TRUSTED_NETWORKS` is the alternative to raising
`RATE_LIMIT_AUTH_LOGIN_MAX`: it exempts the load generator's IP/CIDR from the
per-IP login and refresh ceilings while leaving per-account lockout intact.

After the run, restore the pre-test values:

```bash
cp Backend/.env.production.loadtest-backup Backend/.env.production
docker compose --env-file Backend/.env.production -f docker-compose.production.yml \
  up -d --no-deps api1 api2 api3
```

### Monitoring

Prometheus runs with `--web.enable-remote-write-receiver` (added to
`docker-compose.monitoring.yml`), so k6 can push metrics over remote write:

```bash
docker compose --env-file Backend/.env.production -f docker-compose.monitoring.yml up -d prometheus
```

The dashboard **k6 Exam Load Test** (`k6-exam-load.json`) is auto-provisioned by
the existing dashboard provider. It needs the run to use
`K6_PROMETHEUS_RW_TREND_STATS` values that match the panels; the default is
`p(99)` only. Panels without data mean that stat was not exported.

Backend metrics (`lms_api_*`, `lms_rate_limit_blocked_total`, `lms_mongodb_up`,
`lms_redis_available`) come from the existing `lms-api` scrape and are shown on
the same dashboard for correlation. Note `lms_api_avg_response_ms` is a rolling
average with no histogram buckets, so only k6 can give you p95/p99.

### Abort thresholds

Abort with Ctrl-C if any of these hold for more than a minute. k6 thresholds
fail the run at the end; they cannot stop it early.

- `lms_api_error_rate_percent` above 5% (matches the `LmsApiHighErrorRate` alert)
- `k6_http_req_failed_rate` above 1%
- `k6_exam_start_success_rate` below 0.98
- `lms_redis_available` or `lms_mongodb_up` at 0
- `lms_rate_limit_degraded` at 1
- host CPU sustained above 90%, or API containers restarting

Aborting mid-exam leaves `IN_PROGRESS` submissions behind. They expire via the
lifecycle sweep or the heartbeat auto-submit path; if that matters for the test,
wait for the full run instead.

### Pass criteria

- `http_req_failed` below 1%
- `login_success`, `answer_success` above 0.99
- `exam_start_success` above 0.98
- `submit_success` above 0.95
- request p95 below 2000ms, p99 below 5000ms
- answer-save and heartbeat p95 below 1000ms
- fewer than 200 rate-limited requests across the whole run
- Redis healthy and below 80% of `REDIS_MAXMEMORY`
- MongoDB CPU and slow queries stable, no replica step-down

Both runs submit, so each account consumes one attempt. With
`attemptsAllowed: 10` that leaves 8 remaining after the 500 and 1000 runs.

---

## Required Test Data

Create active student accounts that are assigned to an active test. Pass either one student:

```powershell
$env:STUDENT_IDENTIFIER="student@example.com"
$env:STUDENT_PASSWORD="password"
$env:TEST_ID="optional-test-id"
npm run load:exam-flow
```

or a JSON array of many students:

```powershell
$env:STUDENTS_JSON='[{"identifier":"student1@example.com","password":"password1"},{"identifier":"student2@example.com","password":"password2"}]'
$env:TEST_ID="optional-test-id"
npm run load:exam-flow
```

## Named Load Profiles

Run in stages and watch API, MongoDB, Redis, CPU, disk I/O, and memory metrics.

| Script | Target VUs | Purpose |
| --- | ---: | --- |
| `npm run load:exam-flow:100` | 100 | first staging confidence run |
| `npm run load:exam-flow:500` | 500 | expected medium college traffic |
| `npm run load:exam-flow:1000` | 1000 | high single-instance traffic gate |
| `npm run load:exam-flow:2000` | 2000 | stress run for the current VPS shape |
| `npm run load:exam-flow:5000` | 5000 | capacity discovery; expect horizontal scaling work |

```powershell
$env:BASE_URL="http://localhost:5000"
$env:STUDENTS_JSON='[...]'
$env:TEST_ID="..."
$env:RUN_SUBMIT="false"
npm run load:exam-flow:500
```

Keep `RUN_SUBMIT=false` for the first large run so repeated test submissions do not consume real attempts. Use a disposable test and disposable students when testing submit behavior.

The exam-flow script logs in once per virtual user, reuses that access token for about 14 minutes, and backs off when a rate-limit response includes `Retry-After`. If you see `api-general` 429 responses during a very small run, first confirm every load-test student can see a startable ongoing test; otherwise the script will repeatedly check `/api/tests/ongoing` and mostly test rate limiting instead of exam throughput.

You can also run a custom profile:

```powershell
$env:TARGET_USERS="750"
$env:WARMUP_USERS="150"
$env:WARMUP_DURATION="4m"
$env:HOLD_DURATION="12m"
$env:RAMPDOWN_DURATION="2m"
npm run load:exam-flow
```

## Pass Criteria

- `http_req_failed` below 1%
- p95 request latency below 1000ms for exam APIs
- answer-save p95 below 750ms
- Redis health remains `ok`
- Redis memory stays below 80% of `REDIS_MAXMEMORY`
- MongoDB CPU and slow queries remain stable
- Node memory does not climb continuously

For the Hostinger KVM 8 target, do not treat the app as production-ready for 1000+ concurrent exam users until the 100, 500, and 1000 profiles all pass against the real VPS with production Redis, MongoDB replica set, NGINX, and TLS enabled.
