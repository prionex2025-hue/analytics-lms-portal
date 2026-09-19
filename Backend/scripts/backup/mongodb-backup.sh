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

BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/lms-portal}
BACKUP_DIR="$BACKUP_ROOT/mongodb"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
ARCHIVE="$BACKUP_DIR/mongodb-$TIMESTAMP.archive.gz"
MANIFEST="$BACKUP_DIR/mongodb-$TIMESTAMP.manifest"
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
COMPOSE_FILE=${COMPOSE_FILE:-"$PROJECT_ROOT/docker-compose.production.yml"}

mkdir -p "$BACKUP_DIR"
umask 077

if [ "${USE_DOCKER_COMPOSE_BACKUP:-true}" = "true" ]; then
  : "${MONGO_INITDB_ROOT_USERNAME:?MONGO_INITDB_ROOT_USERNAME is required}"
  : "${MONGO_INITDB_ROOT_PASSWORD:?MONGO_INITDB_ROOT_PASSWORD is required}"
  : "${MONGODB_DB_NAME:=lms_portal}"

  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --project-directory "$PROJECT_ROOT" exec -T mongo \
    mongodump \
      --username "$MONGO_INITDB_ROOT_USERNAME" \
      --password "$MONGO_INITDB_ROOT_PASSWORD" \
      --authenticationDatabase admin \
      --db "$MONGODB_DB_NAME" \
      --archive \
      --gzip > "$ARCHIVE"
else
  : "${MONGODB_URI:?MONGODB_URI is required}"
  mongodump --uri "$MONGODB_URI" --archive="$ARCHIVE" --gzip
fi

cat > "$MANIFEST" <<EOF
created_at=$TIMESTAMP
archive=$ARCHIVE
database=${MONGODB_DB_NAME:-from-uri}
mode=$([ "${USE_DOCKER_COMPOSE_BACKUP:-true}" = "true" ] && echo docker-compose || echo host)
EOF

if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -type f \( -name "*.archive.gz" -o -name "*.manifest" \) -mtime +"$RETENTION_DAYS" -delete
fi

echo "MongoDB backup written to $ARCHIVE"
