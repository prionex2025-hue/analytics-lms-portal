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

RESTORE_UPLOADS_ARCHIVE=${RESTORE_UPLOADS_ARCHIVE:-${RESTORE_ARCHIVE:-}}
: "${RESTORE_UPLOADS_ARCHIVE:?Set RESTORE_UPLOADS_ARCHIVE to the uploads .tar.gz file to restore}"

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo "Refusing to restore uploads without CONFIRM_RESTORE=YES" >&2
  exit 1
fi

if [ ! -f "$RESTORE_UPLOADS_ARCHIVE" ]; then
  echo "Uploads restore archive not found: $RESTORE_UPLOADS_ARCHIVE" >&2
  exit 1
fi

RESTORE_MODE=${RESTORE_MODE:-replace}
COMPOSE_FILE=${COMPOSE_FILE:-"$PROJECT_ROOT/docker-compose.production.yml"}

case "$RESTORE_MODE" in
  replace|merge) ;;
  *)
    echo "RESTORE_MODE must be replace or merge" >&2
    exit 1
    ;;
esac

if [ "${USE_DOCKER_COMPOSE_BACKUP:-true}" = "true" ]; then
  RESOURCE_UPLOAD_ROOT=${RESOURCE_UPLOAD_ROOT:-/app/uploads/resources}

  cat "$RESTORE_UPLOADS_ARCHIVE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --project-directory "$PROJECT_ROOT" exec -T api1 \
    sh -c '
set -eu

RESOURCE_UPLOAD_ROOT=$1
RESTORE_MODE=$2

case "$RESOURCE_UPLOAD_ROOT" in
  /app/uploads/*) ;;
  *)
    echo "Refusing to restore outside /app/uploads: $RESOURCE_UPLOAD_ROOT" >&2
    exit 1
    ;;
esac

PARENT_DIR=$(dirname "$RESOURCE_UPLOAD_ROOT")
TARGET_NAME=$(basename "$RESOURCE_UPLOAD_ROOT")
RESTORE_DIR="$PARENT_DIR/.restore-$TARGET_NAME-$$"

mkdir -p "$PARENT_DIR" "$RESTORE_DIR"
tar -C "$RESTORE_DIR" -xzf -

if [ ! -d "$RESTORE_DIR/$TARGET_NAME" ]; then
  echo "Archive does not contain expected top-level directory: $TARGET_NAME" >&2
  rm -rf "$RESTORE_DIR"
  exit 1
fi

if [ "$RESTORE_MODE" = "replace" ]; then
  rm -rf "$RESOURCE_UPLOAD_ROOT"
  mv "$RESTORE_DIR/$TARGET_NAME" "$RESOURCE_UPLOAD_ROOT"
else
  mkdir -p "$RESOURCE_UPLOAD_ROOT"
  cp -a "$RESTORE_DIR/$TARGET_NAME/." "$RESOURCE_UPLOAD_ROOT/"
fi

rm -rf "$RESTORE_DIR"
' sh "$RESOURCE_UPLOAD_ROOT" "$RESTORE_MODE"
else
  RESOURCE_UPLOAD_ROOT=${RESOURCE_UPLOAD_ROOT:-uploads/resources}
  PARENT_DIR=$(dirname "$RESOURCE_UPLOAD_ROOT")
  TARGET_NAME=$(basename "$RESOURCE_UPLOAD_ROOT")

  if [ ! -d "$PARENT_DIR" ]; then
    echo "Upload parent directory not found: $PARENT_DIR" >&2
    exit 1
  fi

  ABS_PARENT=$(CDPATH= cd -- "$PARENT_DIR" && pwd)
  case "$ABS_PARENT/$TARGET_NAME" in
    "$PROJECT_ROOT"/*|/var/www/*|/srv/*|/opt/*) ;;
    *)
      echo "Refusing to restore uploads to unexpected path: $ABS_PARENT/$TARGET_NAME" >&2
      exit 1
      ;;
  esac

  RESTORE_DIR="$ABS_PARENT/.restore-$TARGET_NAME-$$"
  mkdir -p "$RESTORE_DIR"
  tar -C "$RESTORE_DIR" -xzf "$RESTORE_UPLOADS_ARCHIVE"

  if [ ! -d "$RESTORE_DIR/$TARGET_NAME" ]; then
    echo "Archive does not contain expected top-level directory: $TARGET_NAME" >&2
    rm -rf "$RESTORE_DIR"
    exit 1
  fi

  if [ "$RESTORE_MODE" = "replace" ]; then
    rm -rf "$ABS_PARENT/$TARGET_NAME"
    mv "$RESTORE_DIR/$TARGET_NAME" "$ABS_PARENT/$TARGET_NAME"
  else
    mkdir -p "$ABS_PARENT/$TARGET_NAME"
    cp -a "$RESTORE_DIR/$TARGET_NAME/." "$ABS_PARENT/$TARGET_NAME/"
  fi

  rm -rf "$RESTORE_DIR"
fi

echo "Uploads restore completed from $RESTORE_UPLOADS_ARCHIVE using mode=$RESTORE_MODE"
