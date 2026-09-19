#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
ENV_FILE=${ENV_FILE:-"$PROJECT_ROOT/Backend/.env.production"}

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

BACKUP_ROOT=${UPLOADS_BACKUP_ROOT:-${BACKUP_ROOT:-/var/backups/lms-portal}/uploads}
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
ARCHIVE="$BACKUP_ROOT/uploads-$TIMESTAMP.tar.gz"
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
COMPOSE_FILE=${COMPOSE_FILE:-"$PROJECT_ROOT/docker-compose.production.yml"}

mkdir -p "$BACKUP_ROOT"
umask 077

if [ "${USE_DOCKER_COMPOSE_BACKUP:-true}" = "true" ]; then
  RESOURCE_UPLOAD_ROOT=${RESOURCE_UPLOAD_ROOT:-/app/uploads/resources}
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --project-directory "$PROJECT_ROOT" exec -T api1 \
    tar -C "$(dirname "$RESOURCE_UPLOAD_ROOT")" -czf - "$(basename "$RESOURCE_UPLOAD_ROOT")" > "$ARCHIVE"
else
  RESOURCE_UPLOAD_ROOT=${RESOURCE_UPLOAD_ROOT:-uploads/resources}
  if [ ! -d "$RESOURCE_UPLOAD_ROOT" ]; then
    echo "Upload directory not found: $RESOURCE_UPLOAD_ROOT" >&2
    exit 1
  fi

  tar -C "$(dirname "$RESOURCE_UPLOAD_ROOT")" -czf "$ARCHIVE" "$(basename "$RESOURCE_UPLOAD_ROOT")"
fi

if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_ROOT" -type f -name "uploads-*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
fi

echo "Uploads backup written to $ARCHIVE"
