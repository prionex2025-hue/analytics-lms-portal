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
MONGODB_BACKUP_DIR="$BACKUP_ROOT/mongodb"
UPLOADS_BACKUP_DIR=${UPLOADS_BACKUP_ROOT:-$BACKUP_ROOT/uploads}
RESTORE_DRILL_SKIP_MONGO=${RESTORE_DRILL_SKIP_MONGO:-false}
RESTORE_DRILL_MONGO_IMAGE=${RESTORE_DRILL_MONGO_IMAGE:-mongo:7.0}

find_latest() {
  directory=$1
  pattern=$2

  if [ ! -d "$directory" ]; then
    return 1
  fi

  find "$directory" -type f -name "$pattern" -print | sort | tail -n 1
}

MONGODB_BACKUP_ARCHIVE=${MONGODB_BACKUP_ARCHIVE:-$(find_latest "$MONGODB_BACKUP_DIR" "mongodb-*.archive.gz" || true)}
UPLOADS_BACKUP_ARCHIVE=${UPLOADS_BACKUP_ARCHIVE:-$(find_latest "$UPLOADS_BACKUP_DIR" "uploads-*.tar.gz" || true)}
export MONGODB_BACKUP_ARCHIVE UPLOADS_BACKUP_ARCHIVE

"$SCRIPT_DIR/verify-backups.sh"

TMP_DIR=$(mktemp -d)
MONGO_CONTAINER=""

cleanup() {
  if [ -n "$MONGO_CONTAINER" ]; then
    docker rm -f "$MONGO_CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

echo "Drilling uploads restore into $TMP_DIR"
tar -C "$TMP_DIR" -xzf "$UPLOADS_BACKUP_ARCHIVE"
if ! find "$TMP_DIR" -mindepth 1 -maxdepth 1 -print | grep -q .; then
  echo "Uploads restore drill failed: archive extracted no files" >&2
  exit 1
fi

echo "Uploads restore drill passed"

if [ "$RESTORE_DRILL_SKIP_MONGO" = "true" ]; then
  echo "Skipping MongoDB restore drill because RESTORE_DRILL_SKIP_MONGO=true"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the MongoDB restore drill. Set RESTORE_DRILL_SKIP_MONGO=true to drill uploads only." >&2
  exit 1
fi

MONGO_CONTAINER="lms-restore-drill-$(date -u +"%Y%m%d%H%M%S")-$$"
docker run -d --rm --name "$MONGO_CONTAINER" "$RESTORE_DRILL_MONGO_IMAGE" >/dev/null

ready=0
attempt=0
while [ "$attempt" -lt 40 ]; do
  if docker exec "$MONGO_CONTAINER" mongosh --quiet --eval 'db.adminCommand({ ping: 1 }).ok' 2>/dev/null | grep -q 1; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  echo "MongoDB restore drill failed: temporary MongoDB did not become ready" >&2
  exit 1
fi

echo "Restoring MongoDB archive into temporary container $MONGO_CONTAINER"
cat "$MONGODB_BACKUP_ARCHIVE" | docker exec -i "$MONGO_CONTAINER" mongorestore --archive --gzip --drop >/dev/null

DRILL_DB_NAME=${MONGODB_DB_NAME:-lms_portal}
database_present=$(docker exec "$MONGO_CONTAINER" mongosh --quiet --eval "db.getMongo().getDBNames().includes('$DRILL_DB_NAME') ? 1 : 0" 2>/dev/null)
case "$database_present" in
  ''|*[!0-9]*)
    echo "MongoDB restore drill failed: could not inspect restored databases" >&2
    exit 1
    ;;
esac

if [ "$database_present" -ne 1 ]; then
  echo "MongoDB restore drill failed: expected database $DRILL_DB_NAME was not visible after restore" >&2
  exit 1
fi

echo "MongoDB restore drill passed"
echo "Full backup restore drill completed"
