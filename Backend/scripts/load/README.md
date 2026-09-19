# Production Load Testing

Use these k6 scripts against a production-like environment with MongoDB and Redis enabled.

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
