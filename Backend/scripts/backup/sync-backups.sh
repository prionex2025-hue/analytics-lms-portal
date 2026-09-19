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
UPLOADS_BACKUP_ROOT=${UPLOADS_BACKUP_ROOT:-$BACKUP_ROOT/uploads}
BACKUP_SYNC_VERIFY=${BACKUP_SYNC_VERIFY:-true}
BACKUP_RCLONE_DESTINATION=${BACKUP_RCLONE_DESTINATION:-}
BACKUP_RCLONE_FLAGS=${BACKUP_RCLONE_FLAGS:-}
BACKUP_SYNC_COMMAND=${BACKUP_SYNC_COMMAND:-}

"$SCRIPT_DIR/verify-backups.sh"

if [ -n "$BACKUP_SYNC_COMMAND" ]; then
  echo "Syncing backups with BACKUP_SYNC_COMMAND"
  export BACKUP_ROOT UPLOADS_BACKUP_ROOT
  sh -c "$BACKUP_SYNC_COMMAND"
  echo "Backup sync command completed"
  exit 0
fi

if [ -z "$BACKUP_RCLONE_DESTINATION" ]; then
  echo "Set BACKUP_RCLONE_DESTINATION or BACKUP_SYNC_COMMAND before running backup sync" >&2
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone is required when BACKUP_RCLONE_DESTINATION is used" >&2
  exit 1
fi

echo "Syncing $BACKUP_ROOT to $BACKUP_RCLONE_DESTINATION"
# BACKUP_RCLONE_FLAGS is intentionally word-split so operators can pass
# trusted rclone flags such as --transfers=4 or --bwlimit=10M.
# shellcheck disable=SC2086
rclone copy "$BACKUP_ROOT" "$BACKUP_RCLONE_DESTINATION" --create-empty-src-dirs $BACKUP_RCLONE_FLAGS

if [ "$BACKUP_SYNC_VERIFY" = "true" ]; then
  echo "Verifying remote backup sync with rclone check"
  # shellcheck disable=SC2086
  rclone check "$BACKUP_ROOT" "$BACKUP_RCLONE_DESTINATION" --one-way $BACKUP_RCLONE_FLAGS
fi

echo "Backup sync completed"
