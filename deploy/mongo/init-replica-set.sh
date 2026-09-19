#!/bin/sh
set -eu

: "${MONGO_INITDB_ROOT_USERNAME:?MONGO_INITDB_ROOT_USERNAME is required}"
: "${MONGO_INITDB_ROOT_PASSWORD:?MONGO_INITDB_ROOT_PASSWORD is required}"

export MONGO_REPLICA_SET_NAME="${MONGO_REPLICA_SET_NAME:-rs0}"
export MONGO_REPLICA_SET_HOST="${MONGO_REPLICA_SET_HOST:-mongo:27017}"

for attempt in $(seq 1 60); do
  if mongosh --quiet \
    --host mongo \
    --username "$MONGO_INITDB_ROOT_USERNAME" \
    --password "$MONGO_INITDB_ROOT_PASSWORD" \
    --authenticationDatabase admin \
    --eval 'db.adminCommand({ ping: 1 }).ok' | grep -q 1; then
    break
  fi

  if [ "$attempt" -eq 60 ]; then
    echo "MongoDB did not become reachable for replica-set initialization" >&2
    exit 1
  fi

  sleep 2
done

mongosh --quiet \
  --host mongo \
  --username "$MONGO_INITDB_ROOT_USERNAME" \
  --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin <<'MONGO_JS'
const setName = process.env.MONGO_REPLICA_SET_NAME || "rs0";
const memberHost = process.env.MONGO_REPLICA_SET_HOST || "mongo:27017";

const waitForPrimary = () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const hello = db.adminCommand({ hello: 1 });
      if (hello.setName === setName && hello.isWritablePrimary === true) {
        print(`MongoDB replica set ${setName} is primary at ${memberHost}.`);
        return;
      }
    } catch (_error) {
      // Keep polling until the initiation finishes or the deadline expires.
    }
    sleep(1000);
  }
  throw new Error(`MongoDB replica set ${setName} did not become primary in time`);
};

try {
  const status = rs.status();
  if (status.ok === 1) {
    if (status.set !== setName) {
      throw new Error(`MongoDB replica set name mismatch: expected ${setName}, got ${status.set}`);
    }
    waitForPrimary();
    quit(0);
  }
} catch (error) {
  const message = String(error && error.message || "");
  const codeName = String(error && error.codeName || "");
  const notInitialized =
    codeName === "NotYetInitialized" ||
    message.includes("no replset config") ||
    message.includes("not yet initialized");

  if (!notInitialized) {
    throw error;
  }
}

rs.initiate({
  _id: setName,
  members: [
    { _id: 0, host: memberHost },
  ],
});

waitForPrimary();
MONGO_JS
