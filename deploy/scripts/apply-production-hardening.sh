#!/usr/bin/env bash
# Apply the 2026-09-30 production-hardening configuration on the VPS.
#
# Run from the repository root on the server (the directory that holds
# docker-compose.production.yml). Dry run by default: prints every change and
# touches nothing until --apply is given.
#
#   deploy/scripts/apply-production-hardening.sh \
#     --trusted-networks "203.0.113.10,198.51.100.0/24" \
#     --alert-webhook "https://hooks.example.com/..." \
#     [--rotate-jwt] [--nginx-conf /etc/nginx/sites-available/lms-portal.conf] \
#     [--apply]
#
# What it does:
#  1. Replaces legacy per-IP auth limits in Backend/.env.production (15 logins
#     per IP locks whole campus labs out) with the NAT-safe defaults.
#  2. Sets RATE_LIMIT_AUTH_TRUSTED_NETWORKS (campus egress IPs/CIDRs).
#  3. Installs deploy/nginx/lms-portal.conf into nginx, runs `nginx -t`, and
#     reloads only if the test passes (the previous file is restored otherwise).
#  4. Ensures METRICS_TOKEN exists (and the Prometheus token file matches);
#     --rotate-jwt generates new JWT secrets (signs every user out once).
#  5. Sets ALERTMANAGER_WEBHOOK_URL.
# Backend/.env.production is backed up before any change. MongoDB and Redis
# passwords are NOT rotated here: they must be changed inside the databases
# first (see the notes printed at the end).
set -euo pipefail

ENV_FILE="Backend/.env.production"
NGINX_SRC="deploy/nginx/lms-portal.conf"
NGINX_DEST=""
TOKEN_FILE="deploy/monitoring/secrets/metrics_token"
TRUSTED=""
WEBHOOK=""
ROTATE_JWT=0
APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --trusted-networks) TRUSTED="$2"; shift 2 ;;
    --alert-webhook) WEBHOOK="$2"; shift 2 ;;
    --rotate-jwt) ROTATE_JWT=1; shift ;;
    --nginx-conf) NGINX_DEST="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (run from the repo root on the server)" >&2; exit 1; }

say() { printf '%s %s\n' "$([ "$APPLY" = 1 ] && echo '[apply]' || echo '[dry-run]')" "$*"; }
secret() { head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | cut -c1-64; }
get_kv() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

WORK="$(mktemp)"
trap 'rm -f "$WORK"' EXIT
cp "$ENV_FILE" "$WORK"

set_kv() { # key value [description-for-log]
  local key="$1" value="$2" shown="${3:-$2}"
  if grep -qE "^${key}=" "$WORK"; then
    local tmp; tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$WORK" > "$tmp" && mv "$tmp" "$WORK"
  else
    printf '%s=%s\n' "$key" "$value" >> "$WORK"
  fi
  say "set $key=$shown"
}

raise_if_below() { # key minimum new-value
  local current; current="$(get_kv "$1")"
  if [ -z "$current" ] || { [[ "$current" =~ ^[0-9]+$ ]] && [ "$current" -lt "$2" ]; }; then
    set_kv "$1" "$3"
  else
    say "keep $1=$current"
  fi
}

# 1. Legacy per-IP auth limits -> NAT-safe policy.
raise_if_below RATE_LIMIT_AUTH_LOGIN_MAX 100 600
raise_if_below RATE_LIMIT_AUTH_LOGIN_FAILED_MAX 1 60
raise_if_below RATE_LIMIT_AUTH_REFRESH_IP_MAX 300 1500
raise_if_below RATE_LIMIT_AUTH_FORGOT_PASSWORD_MAX 20 20
if [ "$(get_kv RATE_LIMIT_AUTH_REFRESH_MAX)" = "50" ]; then
  set_kv RATE_LIMIT_AUTH_REFRESH_MAX 20   # now per session, not per IP
fi

# 2. Trusted campus networks.
if [ -n "$TRUSTED" ]; then
  set_kv RATE_LIMIT_AUTH_TRUSTED_NETWORKS "$TRUSTED"
else
  say "skip RATE_LIMIT_AUTH_TRUSTED_NETWORKS (no --trusted-networks given)"
fi

# 4. Secrets.
if [ -z "$(get_kv METRICS_TOKEN)" ]; then
  set_kv METRICS_TOKEN "$(secret)" "<generated>"
fi
if [ "$ROTATE_JWT" = 1 ]; then
  set_kv JWT_ACCESS_SECRET "$(secret)" "<generated; all users will sign in again>"
  set_kv JWT_REFRESH_SECRET "$(secret)" "<generated>"
fi

# 5. Alert destination.
if [ -n "$WEBHOOK" ]; then
  set_kv ALERTMANAGER_WEBHOOK_URL "$WEBHOOK" "<set>"
elif [ -z "$(get_kv ALERTMANAGER_WEBHOOK_URL)" ]; then
  say "WARNING ALERTMANAGER_WEBHOOK_URL is empty: alerts go nowhere (pass --alert-webhook)"
fi

echo
echo "Changes to $ENV_FILE (secret values hidden):"
diff <(sed -E 's/^((JWT_[A-Z_]*SECRET|METRICS_TOKEN|ALERTMANAGER_WEBHOOK_URL)=).+/\1***/' "$ENV_FILE") \
     <(sed -E 's/^((JWT_[A-Z_]*SECRET|METRICS_TOKEN|ALERTMANAGER_WEBHOOK_URL)=).+/\1***/' "$WORK") || true
echo

if [ "$APPLY" = 1 ]; then
  BACKUP="${ENV_FILE}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$ENV_FILE" "$BACKUP"
  cat "$WORK" > "$ENV_FILE"
  chmod 600 "$ENV_FILE" "$BACKUP"
  say "wrote $ENV_FILE (backup: $BACKUP)"

  mkdir -p "$(dirname "$TOKEN_FILE")"
  printf '%s' "$(get_kv METRICS_TOKEN)" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  say "wrote $TOKEN_FILE"
fi

# 3. Host nginx.
if [ -n "$NGINX_DEST" ]; then
  if [ "$APPLY" = 1 ]; then
    NGINX_BACKUP="${NGINX_DEST}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    sudo cp -p "$NGINX_DEST" "$NGINX_BACKUP"
    sudo cp "$NGINX_SRC" "$NGINX_DEST"
    if sudo nginx -t; then
      sudo systemctl reload nginx
      say "nginx config installed and reloaded (backup: $NGINX_BACKUP)"
    else
      sudo cp -p "$NGINX_BACKUP" "$NGINX_DEST"
      echo "nginx -t FAILED: previous config restored, nginx not reloaded" >&2
      exit 1
    fi
  else
    say "would install $NGINX_SRC -> $NGINX_DEST, run nginx -t, reload on success"
  fi
else
  say "skip nginx (no --nginx-conf given)"
fi

cat <<'EOF'

Next:
  * Restart the API so it picks up the env changes (or run the Deploy VPS workflow):
      docker compose --env-file Backend/.env.production -f docker-compose.production.yml up -d
      docker compose --env-file Backend/.env.production -f docker-compose.production.yml exec -T api1 npm run prod:check
  * Monitoring stack (after METRICS_TOKEN / webhook changes):
      docker compose --env-file Backend/.env.production -f docker-compose.monitoring.yml up -d
  * MongoDB/Redis password rotation (maintenance window): change the password in the
    database first (mongosh db.changeUserPassword / redis CONFIG SET requirepass +
    REDIS_PASSWORD), then update MONGODB_URI / MONGO_APP_PASSWORD / REDIS_PASSWORD /
    REDIS_URL here and restart the stack.
EOF
