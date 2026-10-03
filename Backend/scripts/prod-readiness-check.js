process.env.NODE_ENV = "production";
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

const resolveEnvFile = () => {
  if (process.env.PROD_ENV_FILE) {
    return process.env.PROD_ENV_FILE;
  }

  return [".env.production.local", ".env.production", ".env"].find((candidate) =>
    fs.existsSync(path.resolve(process.cwd(), candidate))
  );
};

const envFile = resolveEnvFile();
dotenv.config(envFile ? { path: envFile } : undefined);

let env;
try {
  env = require("../src/config/env");
} catch (error) {
  console.error(`Production configuration invalid: ${error?.message || "unknown validation error"}`);
  process.exit(1);
}
const { getRedisHealthSnapshot, redisClient, shutdownRedis } = require("../src/config/redis");
const { pingClamAV } = require("../src/services/clamav.service");

const requiredIndexes = {
  testBatch: [
    ["batchId", "testId"],
    { fields: ["testId", "batchId"], unique: true },
  ],
  test: [
    ["collegeId", "status"],
    ["collegeId", "assignmentMethod", "departmentId"],
    ["collegeId", "batchId"],
    ["collegeId", "createdAt"],
  ],
  question: [
    ["testId", "order"],
  ],
  answer: [
    { fields: ["submissionId", "questionId"], unique: true },
  ],
  violation: [
    ["submissionId", "createdAt"],
    ["submissionId", "type", "createdAt"],
    ["userId", "testId"],
    ["collegeId", "testId", "createdAt"],
    ["collegeId", "userId", "createdAt"],
  ],
  submission: [
    ["collegeId", "testId", "status"],
    ["status", "collegeId"],
    ["collegeId", "userId", "submittedAt"],
    { fields: ["userId", "testId", "attemptNumber"], unique: true },
    ["collegeId", "status", "submittedAt"],
  ],
  testSession: [
    { fields: ["userId", "testId"], unique: true },
    ["submissionId"],
  ],
  studentRefreshToken: [
    { fields: ["tokenHash"], unique: true },
    { fields: ["token"], unique: true },
    ["userId", "revokedAt", "expiresAt"],
  ],
  adminRefreshToken: [
    { fields: ["tokenHash"], unique: true },
    { fields: ["token"], unique: true },
    ["adminId", "revokedAt", "expiresAt"],
  ],
  superAdminRefreshToken: [
    { fields: ["tokenHash"], unique: true },
    { fields: ["token"], unique: true },
    ["superAdminId", "revokedAt", "expiresAt"],
  ],
  passwordResetToken: [
    { fields: ["tokenHash"], unique: true },
    ["scope", "principalId", "usedAt", "revokedAt"],
    ["expiresAt"],
  ],
  student: [
    ["collegeId", "departmentId", "isActive"],
    ["isActive", "collegeId"],
    ["collegeId", "departmentId", "year", "createdAt"],
    ["collegeId", "batchId", "createdAt"],
    ["collegeId", "email"],
    ["collegeId", "studentId"],
  ],
  admin: [
    ["collegeId", "role", "isActive"],
    ["collegeId", "role", "createdAt"],
    ["collegeId", "email"],
    ["collegeId", "employeeId"],
  ],
  superAdmin: [
    { fields: ["email"], unique: true },
    ["role", "isActive"],
    ["createdAt"],
  ],
  event: [
    ["collegeId", "startsAt"],
  ],
  reportJob: [
    ["collegeId", "type", "status", "createdAt"],
  ],
  superReportJob: [
    ["filters.collegeId", "status", "createdAt"],
    ["initiatedById", "createdAt"],
  ],
  resource: [
    ["collegeId", "subjectId"],
    ["tags"],
    ["visibilityScope"],
    ["collegeId", "visibilityScope", "isActive", "createdAt"],
  ],
  resourceView: [
    ["resourceId", "userId"],
  ],
  resourceDownload: [
    ["resourceId", "userId"],
  ],
};

const mask = (value) => (value ? "set" : "missing");

const indexKeyNames = (index) => Object.keys(index.key || {});

const normalizeRequiredIndex = (spec) => Array.isArray(spec) ? { fields: spec, unique: false } : spec;

const hasIndex = (indexes, requirement) =>
  indexes.some((index) => {
    const keys = indexKeyNames(index);
    const fields = requirement.fields || [];
    if (requirement.unique && index.unique !== true) {
      return false;
    }
    return fields.length === keys.length && fields.every((field, idx) => keys[idx] === field);
  });

const getCollectionIndexes = async (db, collectionName) => {
  try {
    return await db.collection(collectionName).indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") {
      return null;
    }
    throw error;
  }
};

const warnIfDevelopmentSecret = (name, value) => {
  const text = String(value || "").toLowerCase();
  if (!value || text.includes("development") || text.includes("change") || text.includes("secret-for-the-jwt")) {
    return [`${name} must be replaced with a strong production secret.`];
  }
  return [];
};

const warnIfPlaceholder = (name, value) => {
  const text = String(value || "").toLowerCase();
  if (!value || text.includes("change-this") || text.includes("password") || text.includes("example")) {
    return [`${name} must be replaced with a strong production value.`];
  }
  return [];
};

const warnIfShortSecret = (name, value, minLength = 32) => {
  if (!value || String(value).length < minLength) {
    return [`${name} must be at least ${minLength} characters when enabled.`];
  }
  return [];
};

const warnIfInvalidMongoKeyFileSecret = (name, value) => {
  if (value && !/^[A-Za-z0-9+/=]+$/.test(String(value))) {
    return [`${name} must contain only MongoDB keyfile characters: A-Z, a-z, 0-9, +, /, =.`];
  }
  return [];
};

const warnIfInvalidRedisMemory = (name, value) => {
  const text = String(value || "").trim();
  if (!text || !/^[1-9]\d*(b|k|kb|m|mb|g|gb)?$/i.test(text)) {
    return [`${name} must be set to a Redis memory value such as 2gb, 4096mb, or a positive byte count.`];
  }
  return [];
};

const warnIfInvalidEmail = (name, value) => {
  const text = String(value || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return [`${name} must be a valid email address.`];
  }
  return [];
};

const warnIfNonHttpsUrl = (name, value) => {
  if (!String(value || "").startsWith("https://")) {
    return [`${name} must use HTTPS in production.`];
  }
  return [];
};

const redisConfigArrayToObject = (items = []) => {
  const result = {};
  for (let index = 0; index < items.length - 1; index += 2) {
    result[String(items[index])] = String(items[index + 1]);
  }
  return result;
};

const isLocalOrigin = (origin) => {
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const isEnabledFlag = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const parseUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const hasUriCredentials = (value) => {
  const parsed = parseUrl(value);
  return Boolean(parsed?.username || parsed?.password);
};

const getUriUsername = (value) => {
  const parsed = parseUrl(value);
  if (!parsed?.username) {
    return "";
  }

  try {
    return decodeURIComponent(parsed.username);
  } catch {
    return parsed.username;
  }
};

const getQueryParam = (value, name) => {
  const parsed = parseUrl(value);
  return parsed?.searchParams?.get(name) || "";
};

const isPrivateServiceHost = (hostname) => {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "redis", "mongo", "mongodb"].includes(host)) {
    return true;
  }

  if (/^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }

  const match = host.match(/^172\.(\d{1,2})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
};

const shouldCheckDeploymentArtifacts = () => {
  const explicit = String(process.env.CHECK_DEPLOYMENT_ARTIFACTS || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(explicit)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(explicit)) {
    return false;
  }

  const repoRoot = path.resolve(__dirname, "..", "..");
  return fs.existsSync(path.join(repoRoot, ".git")) || fs.existsSync(path.join(repoRoot, "docker-compose.production.yml"));
};

const validateStopGracePeriod = () => {
  if (!shouldCheckDeploymentArtifacts()) return [];

  const repoRoot = path.resolve(__dirname, "..", "..");
  const composePath = path.join(repoRoot, "docker-compose.production.yml");
  try {
    const compose = fs.readFileSync(composePath, "utf8");
    const match = compose.match(/stop_grace_period:\s*([0-9]+)s/);
    if (!match) return ["docker-compose.production.yml must set stop_grace_period for the API service."];

    const graceSeconds = Number(match[1]);
    if (graceSeconds * 1000 <= env.httpServer.shutdownTimeoutMs) {
      return [
        `docker-compose.production.yml stop_grace_period (${graceSeconds}s) must exceed ` +
        `SHUTDOWN_TIMEOUT_MS (${env.httpServer.shutdownTimeoutMs}ms), otherwise Docker ` +
        "SIGKILLs the API before the graceful drain completes."
      ];
    }
    return [];
  } catch (error) {
    return [`Could not read docker-compose.production.yml to verify stop_grace_period: ${error.message}`];
  }
};

const validateDeploymentArtifacts = () => {
  if (!shouldCheckDeploymentArtifacts()) {
    return [];
  }

  const repoRoot = path.resolve(__dirname, "..", "..");
  const requiredFiles = [
    "docker-compose.production.yml",
    "Backend/.env.production.example",
    "Backend/.dockerignore",
    "Backend/scripts/backup/mongodb-backup.sh",
    "Backend/scripts/backup/uploads-backup.sh",
    "Backend/scripts/backup/mongodb-restore.sh",
    "Backend/scripts/backup/uploads-restore.sh",
    "Backend/scripts/backup/verify-backups.sh",
    "Backend/scripts/backup/sync-backups.sh",
    "Backend/scripts/backup/restore-drill.sh",
    "docker-compose.monitoring.yml",
    "deploy/monitoring/prometheus/prometheus.yml",
    "deploy/monitoring/prometheus/rules/lms-alerts.yml",
    "deploy/monitoring/alertmanager/alertmanager.yml",
    "deploy/monitoring/loki/loki.yml",
    "deploy/monitoring/promtail/promtail.yml",
    "deploy/monitoring/grafana/provisioning/datasources/datasources.yml",
    "deploy/monitoring/grafana/provisioning/dashboards/dashboards.yml",
    "deploy/monitoring/grafana/dashboards/lms-overview.json",
    "deploy/mongo/init-app-user.sh",
    "deploy/mongo/docker-entrypoint-replset.sh",
    "deploy/mongo/init-replica-set.sh",
    "Frontend/Dockerfile",
    "Frontend/nginx.conf",
    "Frontend/.dockerignore",
    "Frontend/.env.production.example",
    "deploy/nginx/lms-portal.conf",
    "deploy/pm2/ecosystem.config.cjs",
    "deploy/systemd/lms-mongodb-backup.service",
    "deploy/systemd/lms-mongodb-backup.timer",
    "deploy/systemd/lms-uploads-backup.service",
    "deploy/systemd/lms-uploads-backup.timer",
    "deploy/systemd/lms-backup-verify.service",
    "deploy/systemd/lms-backup-verify.timer",
    "deploy/systemd/lms-backup-sync.service",
    "deploy/systemd/lms-backup-sync.timer",
    "deploy/systemd/lms-restore-drill.service",
    "deploy/systemd/lms-restore-drill.timer",
  ];

  return requiredFiles
    .filter((file) => !fs.existsSync(path.join(repoRoot, file)))
    .map((file) => `Missing deployment artifact: ${file}`);
};

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRedisHealthWithRetry = async ({ attempts, delayMs }) => {
  let snapshot = await getRedisHealthSnapshot();

  for (let attempt = 1; attempt < attempts; attempt += 1) {
    const healthy = snapshot.status === "ok" || snapshot.status === "degraded";
    if (healthy) {
      return { snapshot, attemptsUsed: attempt };
    }

    // Redis can report "down" briefly during startup because commands run
    // before the initial ready state when offline queue is disabled.
    await sleep(delayMs);
    snapshot = await getRedisHealthSnapshot();
  }

  return { snapshot, attemptsUsed: attempts };
};

const run = async () => {
  const findings = [];
  const redisRetryAttempts = toPositiveInt(process.env.PROD_CHECK_REDIS_RETRIES, 6);
  const redisRetryDelayMs = toPositiveInt(process.env.PROD_CHECK_REDIS_RETRY_DELAY_MS, 500);
  const allowLocalProductionSmoke = env.nodeEnv === "production" && isEnabledFlag(process.env.ALLOW_LOCAL_PRODUCTION_SMOKE);

  console.log("Production readiness check");
  console.log(`NODE_ENV: ${env.nodeEnv}`);
  console.log(`MongoDB URI: ${mask(env.mongoUri)}`);
  console.log(`Redis URL: ${mask(env.redisUrl)}`);
  console.log(`Redis enabled: ${Boolean(env.redis.enabled)}`);
  console.log(`Redis queue enabled: ${Boolean(env.redis.queueEnabled)}`);

  findings.push(...warnIfDevelopmentSecret("JWT_ACCESS_SECRET", env.jwtAccessSecret));
  findings.push(...warnIfDevelopmentSecret("JWT_REFRESH_SECRET", env.jwtRefreshSecret));
  // config/env.js already throws on a missing/short JWT secret at startup, so the
  // length check here is only a clearer pre-deploy message. The distinctness
  // check is also enforced at startup but is repeated so operators see it before
  // the deploy rather than after a crash-looping container.
  findings.push(...warnIfShortSecret("JWT_ACCESS_SECRET", env.jwtAccessSecret, 32));
  findings.push(...warnIfShortSecret("JWT_REFRESH_SECRET", env.jwtRefreshSecret, 32));
  findings.push(...validateDeploymentArtifacts());

  if (env.nodeEnv === "production" && !env.redis.enabled) {
    findings.push("Redis should be enabled for production traffic.");
  }

  // config/env.js throws at startup if the two JWT secrets are identical (access
  // and refresh tokens would be interchangeable). Repeated here so the operator
  // sees it before the deploy rather than as a crash-looping container.
  if (
    env.jwtAccessSecret
    && env.jwtRefreshSecret
    && String(env.jwtAccessSecret) === String(env.jwtRefreshSecret)
  ) {
    findings.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.");
  }

  // A Puppeteer render budget longer than the drain window guarantees that a
  // deploy or restart landing mid-render force-exits the process and the admin
  // gets a failed report. Require headroom rather than equality so a render that
  // is nearly finished still completes.
  if (env.reportPdfTimeoutMs >= env.httpServer.shutdownTimeoutMs) {
    findings.push(
      `REPORT_PDF_TIMEOUT_MS (${env.reportPdfTimeoutMs}) must be lower than ` +
      `SHUTDOWN_TIMEOUT_MS (${env.httpServer.shutdownTimeoutMs}); otherwise a restart ` +
      "during report generation kills the render mid-flight."
    );
  }

  // stop_grace_period must exceed the drain window, otherwise Docker SIGKILLs the
  // API before its own force-exit timer fires and in-flight submissions are lost.
  // Read the real value from the compose file rather than trusting documentation.
  findings.push(...validateStopGracePeriod());

  if (env.nodeEnv === "production" && !hasUriCredentials(env.mongoUri)) {
    findings.push("MONGODB_URI should include database credentials in production.");
  }

  if (env.nodeEnv === "production") {
    const mongoUriUsername = getUriUsername(env.mongoUri);
    const rootUsername = String(process.env.MONGO_INITDB_ROOT_USERNAME || "");
    if (rootUsername && mongoUriUsername && mongoUriUsername === rootUsername) {
      findings.push("MONGODB_URI must use a least-privilege application user, not MONGO_INITDB_ROOT_USERNAME.");
    }
    if (process.env.MONGO_APP_PASSWORD) {
      findings.push(...warnIfPlaceholder("MONGO_APP_PASSWORD", process.env.MONGO_APP_PASSWORD));
    }
    if (process.env.MONGO_REPLICA_SET_KEY) {
      findings.push(...warnIfShortSecret("MONGO_REPLICA_SET_KEY", process.env.MONGO_REPLICA_SET_KEY, 128));
      findings.push(...warnIfPlaceholder("MONGO_REPLICA_SET_KEY", process.env.MONGO_REPLICA_SET_KEY));
      findings.push(...warnIfInvalidMongoKeyFileSecret("MONGO_REPLICA_SET_KEY", process.env.MONGO_REPLICA_SET_KEY));
    }
    const expectedReplicaSet = process.env.MONGO_REPLICA_SET_NAME || "rs0";
    const uriReplicaSet = getQueryParam(env.mongoUri, "replicaSet");
    if (!uriReplicaSet) {
      findings.push("MONGODB_URI must include replicaSet in production so MongoDB transactions are available.");
    } else if (uriReplicaSet !== expectedReplicaSet) {
      findings.push(`MONGODB_URI replicaSet must match MONGO_REPLICA_SET_NAME (${expectedReplicaSet}).`);
    }
  }

  if (env.nodeEnv === "production" && env.frontendOrigins.some((origin) => origin === "*" || (isLocalOrigin(origin) && !allowLocalProductionSmoke))) {
    findings.push("FRONTEND_ORIGIN must list only the real production HTTPS origins; localhost and wildcard origins are not allowed.");
  }

  if (env.nodeEnv === "production" && env.frontendOrigins.some((origin) => !String(origin).startsWith("https://") && !(allowLocalProductionSmoke && isLocalOrigin(origin)))) {
    findings.push("FRONTEND_ORIGIN should use HTTPS origins in production.");
  }

  if (env.nodeEnv === "production" && process.env.MONGO_INITDB_ROOT_PASSWORD) {
    findings.push(...warnIfPlaceholder("MONGO_INITDB_ROOT_PASSWORD", process.env.MONGO_INITDB_ROOT_PASSWORD));
  }

  if (env.nodeEnv === "production" && process.env.REDIS_PASSWORD) {
    findings.push(...warnIfPlaceholder("REDIS_PASSWORD", process.env.REDIS_PASSWORD));
  }

  if (env.nodeEnv === "production" && String(env.redisUrl || "").startsWith("redis://")) {
    const parsedRedisUrl = parseUrl(env.redisUrl);
    const hasRedisPassword = Boolean(parsedRedisUrl?.password);
    const privateRedisHost = isPrivateServiceHost(parsedRedisUrl?.hostname);
    if (!hasRedisPassword) {
      findings.push("REDIS_URL must include AUTH credentials in production.");
    }
    if (!privateRedisHost) {
      findings.push("Use rediss:// for Redis when connecting to a non-private Redis host.");
    }
  }

  if (env.nodeEnv === "production" && env.redis.enabled) {
    findings.push(...warnIfInvalidRedisMemory("REDIS_MAXMEMORY", env.redis.maxMemory));
    if (String(env.redis.maxMemoryPolicy || "").toLowerCase() !== "noeviction") {
      findings.push("REDIS_MAXMEMORY_POLICY must be noeviction so auth, rate-limit, queue, and revocation keys are not silently evicted.");
    }
  }

  const forbiddenSuperAdminEnv = ["SUPERADMIN_EMAIL", "SUPERADMIN_PASSWORD", "SUPERADMIN_NAME", "SUPER_ADMIN_EMAIL", "SUPER_ADMIN_PASSWORD"];
  for (const key of forbiddenSuperAdminEnv) {
    if (process.env[key]) {
      findings.push(`${key} must not be set; create SuperAdmins with npm run create and store accounts in MongoDB.`);
    }
  }

  if (env.nodeEnv === "production") {
    // req.ip (used for rate limits and login lockout) is only trustworthy when
    // Express trusts exactly the proxies in front of it.
    if (typeof env.trustProxy !== "number" || env.trustProxy < 1) {
      findings.push("TRUST_PROXY must be the number of reverse proxies in front of the API (2 for the docker-compose + host nginx setup).");
    }
    // Old default (15 per IP / 15 min) locks whole campus labs behind one NAT IP
    // out of login at exam start. Failed attempts have their own low limit.
    if (env.rateLimit.authLoginMax < 100) {
      findings.push(
        `RATE_LIMIT_AUTH_LOGIN_MAX=${env.rateLimit.authLoginMax} is a legacy per-IP value that blocks shared campus networks; ` +
        "use >= 300 (default 600). Brute force is limited by RATE_LIMIT_AUTH_LOGIN_FAILED_MAX and account lockout."
      );
    }
    if (env.rateLimit.authRefreshIpMax < 300) {
      findings.push(`RATE_LIMIT_AUTH_REFRESH_IP_MAX=${env.rateLimit.authRefreshIpMax} is too low for a shared campus IP; use >= 300 (default 1500).`);
    }
    const rateLimitDisabled = String(process.env.RATE_LIMIT_DISABLED || "").trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(rateLimitDisabled)) {
      findings.push("RATE_LIMIT_DISABLED must not be enabled in production (it removes login brute-force protection).");
    }
  }

  if (env.nodeEnv === "production" && env.metrics?.enabled) {
    findings.push(...warnIfShortSecret("METRICS_TOKEN", env.metrics.token));
    findings.push(...warnIfPlaceholder("METRICS_TOKEN", env.metrics.token));
  }

  if (env.nodeEnv === "production" && !allowLocalProductionSmoke) {
    if (env.passwordReset.returnToken) {
      findings.push("PASSWORD_RESET_RETURN_TOKEN must be false in production.");
    }
    if (env.passwordReset.deliveryMode !== "resend") {
      findings.push("PASSWORD_RESET_DELIVERY_MODE must be resend in production.");
    }
    if (!env.email.resendApiKey) {
      findings.push("RESEND_API_KEY must be configured in production for password reset email delivery.");
    }
    findings.push(...warnIfInvalidEmail("RESEND_FROM_EMAIL", env.email.resendFromEmail));
    if (String(env.email.resendFromEmail || "").toLowerCase() !== "noreply@analyticsedify.com") {
      findings.push("RESEND_FROM_EMAIL must be noreply@analyticsedify.com for Analytics Edify production mail.");
    }
    findings.push(...warnIfNonHttpsUrl("PASSWORD_RESET_FRONTEND_URL", env.passwordReset.frontendUrl));
    for (const [portal, resetUrl] of Object.entries(env.passwordReset.resetUrls || {})) {
      if (portal === "student") {
        continue;
      }
      findings.push(...warnIfNonHttpsUrl(`PASSWORD_RESET_${portal.toUpperCase().replace(/-/g, "_")}_FRONTEND_URL`, resetUrl));
    }
  }

  if (env.nodeEnv === "production" && !path.isAbsolute(env.resourceUpload.root)) {
    findings.push("RESOURCE_UPLOAD_ROOT should be an absolute persistent volume path in production.");
  }

  const backupRoot = process.env.BACKUP_ROOT || "";
  const uploadsBackupRoot = process.env.UPLOADS_BACKUP_ROOT || "";
  if (env.nodeEnv === "production") {
    if (!backupRoot || !path.isAbsolute(backupRoot)) {
      findings.push("BACKUP_ROOT must be set to an absolute off-server-sync backup path in production.");
    }
    if (!uploadsBackupRoot || !path.isAbsolute(uploadsBackupRoot)) {
      findings.push("UPLOADS_BACKUP_ROOT must be set to an absolute uploads backup path in production.");
    }
    const backupSyncConfigured = isEnabledFlag(process.env.BACKUP_SYNC_CONFIGURED) ||
      Boolean(process.env.BACKUP_RCLONE_DESTINATION || process.env.BACKUP_SYNC_COMMAND);
    if (!allowLocalProductionSmoke && !backupSyncConfigured) {
      findings.push("Configure BACKUP_RCLONE_DESTINATION or BACKUP_SYNC_COMMAND so backups are synced off-server.");
    }
    if (!allowLocalProductionSmoke && env.uploadScan.required && !env.uploadScan.enabled) {
      findings.push("UPLOAD_AV_SCAN_ENABLED must be true in production when UPLOAD_AV_SCAN_REQUIRED is true.");
    }
  }

  if (env.nodeEnv === "production" && env.uploadScan.enabled) {
    const clamav = await pingClamAV();
    console.log(`ClamAV: ${clamav.status}`);
    if (!clamav.reachable) {
      findings.push(`ClamAV malware scanner is enabled but not reachable${clamav.error ? `: ${clamav.error}` : ""}`);
    }
  }

  await mongoose.connect(env.mongoUri, {
    dbName: env.mongoDbName || undefined,
  });
  await mongoose.connection.db.admin().ping();
  console.log("MongoDB: ok");

  if (env.nodeEnv === "production") {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName) {
      findings.push("MongoDB must run as a replica set in production.");
    }
    if (hello.setName && hello.setName !== (process.env.MONGO_REPLICA_SET_NAME || "rs0")) {
      findings.push(`MongoDB replica set name mismatch: connected to ${hello.setName}.`);
    }
    if (hello.isWritablePrimary !== true) {
      findings.push("MongoDB readiness check must connect to a writable primary.");
    }
  }

  for (const [collectionName, specs] of Object.entries(requiredIndexes)) {
    const indexes = await getCollectionIndexes(mongoose.connection.db, collectionName);
    if (!indexes) {
      findings.push(`Missing MongoDB collection or indexes for ${collectionName}; run npm run db:create-indexes before production.`);
      continue;
    }
    for (const spec of specs) {
      const requirement = normalizeRequiredIndex(spec);
      if (!hasIndex(indexes, requirement)) {
        findings.push(
          `Missing MongoDB ${requirement.unique ? "unique " : ""}index on ${collectionName}: ${requirement.fields.join(", ")}`
        );
      }
    }
  }

  for (const collectionName of ["studentRefreshToken", "adminRefreshToken", "superAdminRefreshToken"]) {
    const rawTokenCount = await mongoose.connection.db.collection(collectionName).countDocuments({
      token: { $type: "string" },
    });
    if (rawTokenCount > 0) {
      findings.push(
        `${collectionName} contains ${rawTokenCount} raw refresh token(s); run npm run db:migrate:refresh-token-hashes before production.`
      );
    }
  }

  const superAdminCollection = mongoose.connection.db.collection("superAdmin");
  const [totalSuperAdmins, activeSuperAdmins] = await Promise.all([
    superAdminCollection.countDocuments({ role: "SUPER_ADMIN" }),
    superAdminCollection.countDocuments({ role: "SUPER_ADMIN", isActive: true }),
  ]);
  if (totalSuperAdmins > 5) {
    findings.push(`superAdmin contains ${totalSuperAdmins} account(s); maximum allowed is 5.`);
  }
  if (activeSuperAdmins < 1) {
    findings.push("At least one active MongoDB-backed SuperAdmin account is required; run npm run create before deployment.");
  }

  const incompleteViolationCount = await mongoose.connection.db.collection("violation").countDocuments({
    $or: [
      { submissionId: { $exists: false } },
      { submissionId: null },
      { userId: { $exists: false } },
      { userId: null },
      { testId: { $exists: false } },
      { testId: null },
      { collegeId: { $exists: false } },
      { collegeId: null },
      { type: { $exists: false } },
      { type: null },
      { count: { $exists: false } },
      { count: null },
    ],
  });
  if (incompleteViolationCount > 0) {
    findings.push(
      `violation contains ${incompleteViolationCount} incomplete proctoring record(s); run npm run db:migrate:violations before production.`
    );
  }

  const { snapshot: redis, attemptsUsed } = await getRedisHealthWithRetry({
    attempts: redisRetryAttempts,
    delayMs: redisRetryDelayMs,
  });
  console.log(`Redis: ${redis.status}${redis.latencyMs >= 0 ? ` (${redis.latencyMs}ms)` : ""}`);
  if (attemptsUsed > 1 && (redis.status === "ok" || redis.status === "degraded")) {
    console.log(`Redis health stabilized after ${attemptsUsed} checks.`);
  }
  if (env.redis.enabled && redis.status !== "ok" && redis.status !== "degraded") {
    findings.push(`Redis is enabled but health is ${redis.status}${redis.error ? `: ${redis.error}` : ""}`);
  }

  if (env.nodeEnv === "production" && env.redis.enabled && (redis.status === "ok" || redis.status === "degraded") && redisClient) {
    try {
      const redisConfig = redisConfigArrayToObject(
        await redisClient.config("GET", "appendonly", "maxmemory", "maxmemory-policy")
      );
      if (redisConfig.appendonly !== "yes") {
        findings.push("Redis appendonly must be enabled in production to reduce cache/session loss after restart.");
      }
      if (!redisConfig.maxmemory || redisConfig.maxmemory === "0") {
        findings.push("Redis maxmemory must be configured in production to prevent unbounded memory growth.");
      }
      if (redisConfig["maxmemory-policy"] !== "noeviction") {
        findings.push("Redis maxmemory-policy must be noeviction in production.");
      }
    } catch (error) {
      findings.push(`Redis CONFIG validation failed: ${error?.message || "unknown error"}`);
    }
  }

  await mongoose.disconnect();
  await shutdownRedis();

  if (findings.length > 0) {
    console.log("\nFindings:");
    findings.forEach((finding) => console.log(`- ${finding}`));
    process.exitCode = 1;
    return;
  }

  console.log("Readiness check passed.");
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  await shutdownRedis().catch(() => {});
  process.exitCode = 1;
});
