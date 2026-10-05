#!/usr/bin/env bash
# Run the full-length k6 exam load test from the application host.
#
# WHY THIS WRAPPER EXISTS
#
# docker-compose.production.yml declares 9.0 CPU ceilings (mongo 2.0, redis 1.0,
# clamav 1.0, api1/api2/api3 1.5 each, frontend 0.5) on an 8 vCPU host. Running
# an unpinned k6 there means the generator and the application compete for the
# same cores, and the resulting latency numbers describe k6's own CPU starvation
# rather than the API's capacity.
#
# So k6 gets its own cores via taskset and the API containers keep the rest.
# This is a compromise: it is not equivalent to a dedicated load host, but it
# keeps the measurement interpretable. See "Caveats" in
# Backend/scripts/load/README.md before quoting any number from a run.
#
# Usage:
#   ./run-exam-load-test.sh --profile 500
#   ./run-exam-load-test.sh --profile 1000 --submit
#   ./run-exam-load-test.sh --profile 500 --dry-run
#
# Environment (export before invoking, or use --export-env):
#   BASE_URL            default https://lms.analyticsedify.com
#   TEST_ID             optional, pins a specific test
#   K6_CPUS             default "6,7" (taskset CPU list for k6)
#   ACCOUNTS_FILE       default scripts/load/student_accounts.json

set -euo pipefail

PROFILE="500"
RUN_SUBMIT="true"
DRY_RUN="false"
BASE_URL="${BASE_URL:-https://lms.analyticsedify.com}"
TEST_ID="${TEST_ID:-}"
K6_CPUS="${K6_CPUS:-6,7}"
ACCOUNTS_FILE="${ACCOUNTS_FILE:-scripts/load/student_accounts.json}"
PROMETHEUS_URL="${PROMETHEUS_URL:-http://127.0.0.1:${PROMETHEUS_BIND_PORT:-9090}/api/v1/write}"
RUN_ID="${RUN_ID:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TARGET_SCRIPT="${SCRIPT_DIR}/exam-flow-production.k6.js"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)    PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --submit)     RUN_SUBMIT="true"; shift ;;
    --no-submit)  RUN_SUBMIT="false"; shift ;;
    --dry-run)    DRY_RUN="true"; shift ;;
    --base-url)   BASE_URL="${2:?--base-url needs a value}"; shift 2 ;;
    --test-id)    TEST_ID="${2:?--test-id needs a value}"; shift 2 ;;
    --k6-cpus)    K6_CPUS="${2:?--k6-cpus needs a value}"; shift 2 ;;
    -h|--help)    sed -n '2,30p' "$0"; exit 0 ;;
    *)            die "unknown argument: $1" ;;
  esac
done

# RUN_ID embeds the profile, so it has to be derived after argument parsing.
[[ -n "${RUN_ID}" ]] || RUN_ID="exam-${PROFILE}-$(date +%Y%m%d-%H%M%S)"

# ---------------------------------------------------------------- preflight --
log "Preflight"

command -v docker >/dev/null 2>&1 || die "docker not found"

if ! docker compose version >/dev/null 2>&1; then
  die "docker compose v2 not available"
fi

cd "${BACKEND_DIR}"
[[ -f "${TARGET_SCRIPT}" ]] || die "missing ${TARGET_SCRIPT}"
[[ -f "${ACCOUNTS_FILE}" ]]  || die "missing accounts file ${ACCOUNTS_FILE} (set ACCOUNTS_FILE)"

ACCOUNT_COUNT="$(node -e "
  const a = require('./${ACCOUNTS_FILE}');
  if (!Array.isArray(a) || !a.length) { console.error('empty'); process.exit(1); }
  const bad = a.filter((e) => !e || typeof e.identifier !== 'string' || typeof e.password !== 'string').length;
  if (bad) { console.error(bad + ' malformed'); process.exit(1); }
  console.log(a.length);
")" || die "accounts file is not a non-empty array of { identifier, password }"

TARGET_USERS="${PROFILE}"
log "Accounts available: ${ACCOUNT_COUNT} (needed: ${TARGET_USERS})"
[[ "${ACCOUNT_COUNT}" -ge "${TARGET_USERS}" ]] \
  || die "need ${TARGET_USERS} accounts for profile ${PROFILE}, have ${ACCOUNT_COUNT}"

TOTAL_CPUS="$(nproc)"
log "Host has ${TOTAL_CPUS} logical CPUs; k6 pinned to '${K6_CPUS}'"

# The last pinned CPU index must exist on this host.
MAX_PINNED="$(tr ',' '\n' <<<"${K6_CPUS}" | grep -oE '[0-9]+$' | sort -n | tail -1)"
if [[ -n "${MAX_PINNED}" && "${MAX_PINNED}" -ge "${TOTAL_CPUS}" ]]; then
  warn "k6 CPU ${MAX_PINNED} does not exist on a ${TOTAL_CPUS}-CPU host; adjust K6_CPUS"
fi

# nginx must be up or every request fails at the proxy, not the API.
if command -v curl >/dev/null 2>&1; then
  if ! curl -fsS -o /dev/null --max-time 10 "${BASE_URL}/api/health" 2>/dev/null; then
    curl -fsS -o /dev/null --max-time 10 "${BASE_URL}/" 2>/dev/null \
      || warn "could not reach ${BASE_URL}; the run may fail before k6 starts"
  fi
fi

# The per-IP login ceiling is the one limiter that genuinely collides when every
# VU comes from this host's address. RATE_LIMIT_AUTH_LOGIN_MAX defaults to 600
# per 15 minutes, which 1000 logins exceed.
if docker compose --env-file Backend/.env.production -f docker-compose.production.yml ps --status running api1 >/dev/null 2>&1; then
  LIVE_LOGIN_MAX="$(docker compose --env-file Backend/.env.production -f docker-compose.production.yml \
    exec -T api1 printenv RATE_LIMIT_AUTH_LOGIN_MAX 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "${LIVE_LOGIN_MAX}" ]]; then
    warn "could not read RATE_LIMIT_AUTH_LOGIN_MAX from the running api1 container"
  elif [[ "${LIVE_LOGIN_MAX}" -lt "${TARGET_USERS}" ]]; then
    die "running api1 has RATE_LIMIT_AUTH_LOGIN_MAX=${LIVE_LOGIN_MAX} but this profile needs ${TARGET_USERS} logins from one IP. Raise it in Backend/.env.production and restart the api containers first."
  else
    log "Running api1 RATE_LIMIT_AUTH_LOGIN_MAX=${LIVE_LOGIN_MAX} (>= ${TARGET_USERS})"
  fi
fi

# --------------------------------------------------------------- k6 command --
K6_ARGS=(
  run
  --out experimental-prometheus-rw
  --tag "testid=${RUN_ID}"
  -e "BASE_URL=${BASE_URL}"
  -e "PROFILE=${PROFILE}"
  -e "RUN_SUBMIT=${RUN_SUBMIT}"
  -e "ACCOUNTS_FILE=./${ACCOUNTS_FILE#./}"
)
[[ -n "${TEST_ID}" ]] && K6_ARGS+=(-e "TEST_ID=${TEST_ID}")

K6_ENV=(
  "K6_PROMETHEUS_RW_SERVER_URL=${PROMETHEUS_URL}"
  "K6_PROMETHEUS_RW_TREND_STATS=p(95),p(99),max,med"
  "K6_PROMETHEUS_RW_LABELS=environment=production,testid=${RUN_ID},profile=${PROFILE}"
  "K6_PROMETHEUS_RW_PUSH_INTERVAL=5s"
)

DOCKER_ARGS=(
  run --rm -i
  --cpus "${K6_CPUS}"
  -v "${BACKEND_DIR}:/work"
  -w /work
)
for kv in "${K6_ENV[@]}"; do DOCKER_ARGS+=(-e "${kv}"); done
DOCKER_ARGS+=(grafana/k6)

K6_COMMAND=(env "${K6_ENV[@]}" "${DOCKER_ARGS[@]}" "${K6_ARGS[@]}" "${TARGET_SCRIPT#/work/}")

log "Run id: ${RUN_ID}"
log "Base URL: ${BASE_URL}"
log "Profile: ${PROFILE} | submit: ${RUN_SUBMIT}"
log "Remote write: ${PROMETHEUS_URL}"
printf '    %s\n' "${K6_ARGS[*]}"

if [[ "${DRY_RUN}" == "true" ]]; then
  log "Dry run. Execute without --dry-run to start."
  exit 0
fi

# --------------------------------------------------------------------- warn --
cat <<EOF

  About to run ${TARGET_USERS} concurrent ${PROFILE}-profile exams against ${BASE_URL}
  from this host. k6 is pinned to CPUs ${K6_CPUS} of ${TOTAL_CPUS}.

  Abort with Ctrl-C if, in Grafana "k6 Exam Load Test" or via:
      docker stats --no-stream
  you see the api containers CPU-throttled, lms_api_error_rate_percent above 5%,
  or k6_http_req_failed_rate above 1%.

  Thresholds only fail the run at the end; they cannot stop it early.

EOF

read -r -p "  Press Enter to start, Ctrl-C to abort. " _
log "Starting. Run id ${RUN_ID}. Full output also written to /tmp/${RUN_ID}.log"
set -o pipefail
"${K6_COMMAND[@]}" 2>&1 | tee "/tmp/${RUN_ID}.log"
EXIT_CODE=${PIPESTATUS[0]}

echo
if [[ "${EXIT_CODE}" -eq 0 ]]; then
  log "Run ${RUN_ID} finished with all thresholds passing. Log: /tmp/${RUN_ID}.log"
else
  warn "Run ${RUN_ID} exited ${EXIT_CODE}. Thresholds likely failed. Log: /tmp/${RUN_ID}.log"
fi
log "Compare in Grafana using testid=${RUN_ID}"
exit "${EXIT_CODE}"