#!/bin/sh
set -eu

: "${MONGO_INITDB_ROOT_USERNAME:?MONGO_INITDB_ROOT_USERNAME is required}"
: "${MONGO_INITDB_ROOT_PASSWORD:?MONGO_INITDB_ROOT_PASSWORD is required}"
: "${MONGO_APP_USERNAME:?MONGO_APP_USERNAME is required}"
: "${MONGO_APP_PASSWORD:?MONGO_APP_PASSWORD is required}"

export MONGODB_DB_NAME="${MONGODB_DB_NAME:-lms_portal}"

mongosh --quiet \
  --username "$MONGO_INITDB_ROOT_USERNAME" \
  --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin <<'MONGO_JS'
const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const dbName = process.env.MONGODB_DB_NAME || "lms_portal";
const username = required("MONGO_APP_USERNAME");
const password = required("MONGO_APP_PASSWORD");
const appDb = db.getSiblingDB(dbName);
const roles = [{ role: "readWrite", db: dbName }];

if (appDb.getUser(username)) {
  appDb.updateUser(username, { pwd: password, roles });
  print(`Updated LMS MongoDB application user ${username} on ${dbName}.`);
} else {
  appDb.createUser({ user: username, pwd: password, roles });
  print(`Created LMS MongoDB application user ${username} on ${dbName}.`);
}
MONGO_JS
