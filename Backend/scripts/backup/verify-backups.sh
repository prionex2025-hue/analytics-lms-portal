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

find_latest() {
  directory=$1
  pattern=$2

  if [ ! -d "$directory" ]; then
    return 1
  fi

  find "$directory" -type f -name "$pattern" -print | sort | tail -n 1
}

assert_non_empty_file() {
  file=$1
  label=$2

  if [ ! -f "$file" ]; then
    echo "$label backup not found: $file" >&2
    exit 1
  fi

  if [ ! -s "$file" ]; then
    echo "$label backup is empty: $file" >&2
    exit 1
  fi
}

MONGODB_BACKUP_ARCHIVE=${MONGODB_BACKUP_ARCHIVE:-$(find_latest "$MONGODB_BACKUP_DIR" "mongodb-*.archive.gz" || true)}
UPLOADS_BACKUP_ARCHIVE=${UPLOADS_BACKUP_ARCHIVE:-$(find_latest "$UPLOADS_BACKUP_DIR" "uploads-*.tar.gz" || true)}

assert_non_empty_file "$MONGODB_BACKUP_ARCHIVE" "MongoDB"
assert_non_empty_file "$UPLOADS_BACKUP_ARCHIVE" "Uploads"

gzip -t "$MONGODB_BACKUP_ARCHIVE"
tar -tzf "$UPLOADS_BACKUP_ARCHIVE" >/dev/null

echo "Verified MongoDB backup: $MONGODB_BACKUP_ARCHIVE"
echo "Verified uploads backup: $UPLOADS_BACKUP_ARCHIVE"
