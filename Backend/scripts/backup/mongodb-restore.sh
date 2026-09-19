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

: "${RESTORE_ARCHIVE:?Set RESTORE_ARCHIVE to the .archive.gz file to restore}"

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo "Refusing to restore without CONFIRM_RESTORE=YES" >&2
  exit 1
fi

COMPOSE_FILE=${COMPOSE_FILE:-"$PROJECT_ROOT/docker-compose.production.yml"}

if [ "${USE_DOCKER_COMPOSE_BACKUP:-true}" = "true" ]; then
  : "${MONGO_INITDB_ROOT_USERNAME:?MONGO_INITDB_ROOT_USERNAME is required}"
  : "${MONGO_INITDB_ROOT_PASSWORD:?MONGO_INITDB_ROOT_PASSWORD is required}"

  cat "$RESTORE_ARCHIVE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --project-directory "$PROJECT_ROOT" exec -T mongo \
    mongorestore \
      --username "$MONGO_INITDB_ROOT_USERNAME" \
      --password "$MONGO_INITDB_ROOT_PASSWORD" \
      --authenticationDatabase admin \
      --archive \
      --gzip \
      --drop
else
  : "${MONGODB_URI:?MONGODB_URI is required}"
  mongorestore --uri "$MONGODB_URI" --archive="$RESTORE_ARCHIVE" --gzip --drop
fi

echo "MongoDB restore completed from $RESTORE_ARCHIVE"
