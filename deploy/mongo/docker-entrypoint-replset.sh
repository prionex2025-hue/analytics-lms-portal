#!/bin/sh
set -eu

: "${MONGO_REPLICA_SET_KEY:?MONGO_REPLICA_SET_KEY is required}"

KEYFILE_DIR=/etc/mongo-keyfile
KEYFILE_PATH="$KEYFILE_DIR/keyfile"
KEY_LENGTH=${#MONGO_REPLICA_SET_KEY}

if [ "$KEY_LENGTH" -lt 128 ]; then
  echo "MONGO_REPLICA_SET_KEY must be at least 128 characters." >&2
  exit 1
fi

case "$MONGO_REPLICA_SET_KEY" in
  *change*|*Change*|*CHANGE*|*example*|*Example*|*EXAMPLE*)
    echo "MONGO_REPLICA_SET_KEY must be replaced with a strong production value." >&2
    exit 1
    ;;
  *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=]*)
    echo "MONGO_REPLICA_SET_KEY must contain only base64 keyfile characters: A-Z, a-z, 0-9, +, /, =" >&2
    exit 1
    ;;
esac

mkdir -p "$KEYFILE_DIR"
printf "%s\n" "$MONGO_REPLICA_SET_KEY" > "$KEYFILE_PATH"
chown -R mongodb:mongodb "$KEYFILE_DIR"
chmod 700 "$KEYFILE_DIR"
chmod 400 "$KEYFILE_PATH"

exec docker-entrypoint.sh "$@"
