const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const composeFile = path.join(repoRoot, "docker-compose.production.yml");

const randomId = () => crypto.randomBytes(4).toString("hex");
const randomSecret = (bytes = 36) => crypto.randomBytes(bytes).toString("base64url");
const randomMongoKey = () => crypto.randomBytes(756).toString("base64").slice(0, 756);

const projectName = `lms-local-prod-${randomId()}`;
const envFile = path.join(os.tmpdir(), `${projectName}.env`);
const hostBackupRoot = path.join(os.tmpdir(), `${projectName}-backups`);
const frontendPort = String(process.env.LOCAL_PROD_SMOKE_FRONTEND_PORT || (18080 + crypto.randomInt(0, 1000)));
const includeFrontend = String(process.env.LOCAL_PROD_SMOKE_INCLUDE_FRONTEND || "true").toLowerCase() !== "false";
const keepStack = String(process.env.LOCAL_PROD_SMOKE_KEEP_STACK || "false").toLowerCase() === "true";

const mongoRootPassword = randomSecret();
const mongoAppPassword = randomSecret();
const redisPassword = randomSecret();
const smokeSuperAdminPassword = `Smoke${randomSecret(12)}1!`;

const envContent = [
  "PORT=5000",
  "NODE_ENV=production",
  "RATE_LIMIT_DISABLED=false",
  "ALLOW_LOCAL_PRODUCTION_SMOKE=true",
  "REQUEST_BODY_LIMIT=5mb",
  "MONGO_INITDB_ROOT_USERNAME=lms_root",
  `MONGO_INITDB_ROOT_PASSWORD=${mongoRootPassword}`,
  "MONGO_APP_USERNAME=lms_app",
  `MONGO_APP_PASSWORD=${mongoAppPassword}`,
  "MONGO_REPLICA_SET_NAME=rs0",
  "MONGO_REPLICA_SET_HOST=mongo:27017",
  `MONGO_REPLICA_SET_KEY=${randomMongoKey()}`,
  `MONGODB_URI=mongodb://lms_app:${mongoAppPassword}@mongo:27017/lms_portal?authSource=lms_portal&replicaSet=rs0`,
  "MONGODB_DB_NAME=lms_portal",
  `REDIS_PASSWORD=${redisPassword}`,
  `REDIS_URL=redis://:${redisPassword}@redis:6379`,
  "REDIS_ENABLED=true",
  "REDIS_QUEUE_ENABLED=true",
  "REDIS_MAXMEMORY=256mb",
  "REDIS_MAXMEMORY_POLICY=noeviction",
  "METRICS_ENABLED=true",
  `METRICS_TOKEN=${randomSecret()}`,
  "RESOURCE_UPLOAD_ROOT=/app/uploads/resources",
  "RESOURCE_MAX_FILE_SIZE_BYTES=52428800",
  "UPLOAD_AV_SCAN_ENABLED=false",
  "UPLOAD_AV_SCAN_REQUIRED=false",
  "UPLOAD_DISK_WARNING_PERCENT=80",
  "UPLOAD_DISK_CRITICAL_PERCENT=90",
  "UPLOAD_TMP_MAX_AGE_HOURS=24",
  `JWT_ACCESS_SECRET=${randomSecret(48)}`,
  `JWT_REFRESH_SECRET=${randomSecret(48)}`,
  "JWT_ACCESS_EXPIRES_IN=15m",
  "JWT_REFRESH_EXPIRES_IN=30d",
  "RESEND_API_KEY=re_smoke_dummy",
  "RESEND_FROM_EMAIL=noreply@analyticsedify.com",
  "RESEND_FROM_NAME=Analytics Edify",
  "PASSWORD_RESET_DELIVERY_MODE=response",
  "PASSWORD_RESET_RETURN_TOKEN=true",
  "PASSWORD_RESET_FRONTEND_BASE_URL=http://127.0.0.1",
  "PASSWORD_RESET_FRONTEND_URL=http://127.0.0.1/reset-password",
  "PASSWORD_RESET_ADMIN_FRONTEND_URL=http://127.0.0.1/admin/reset-password",
  "PASSWORD_RESET_COLLEGE_ADMIN_FRONTEND_URL=http://127.0.0.1/college-admin/reset-password",
  "PASSWORD_RESET_SUPER_ADMIN_FRONTEND_URL=http://127.0.0.1/super-admin/reset-password",
  `FRONTEND_ORIGIN=http://127.0.0.1:${frontendPort}`,
  "CLOUDINARY_CLOUD_NAME=",
  "CLOUDINARY_API_KEY=",
  "CLOUDINARY_API_SECRET=",
  "CLOUDINARY_FOLDER=lms-portal",
  "BACKUP_ROOT=/backups",
  "UPLOADS_BACKUP_ROOT=/backups/uploads",
  `HOST_BACKUP_ROOT=${hostBackupRoot.replace(/\\/g, "/")}`,
  "BACKUP_RETENTION_DAYS=14",
  "BACKUP_MAX_AGE_HOURS=26",
  "RESPONSE_CACHE_ENABLED=true",
  `FRONTEND_BIND_PORT=${frontendPort}`,
  `APP_NETWORK_NAME=${projectName}_net`,
  "",
].join("\n");

const composeArgs = (...args) => [
  "compose",
  "--env-file",
  envFile,
  "-p",
  projectName,
  "-f",
  composeFile,
  ...args,
];

const run = (label, args, options = {}) => {
  console.log(`\n==> ${label}`);
  const result = spawnSync("docker", args, {
    cwd: repoRoot,
    env: process.env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${label} failed with exit code ${result.status}${output ? `\n${output}` : ""}`);
  }

  return result.stdout || "";
};

const fetchJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${String(text).slice(0, 500)}`);
  }
  return body;
};

const cleanup = () => {
  if (keepStack) {
    console.log(`\nKeeping Docker stack '${projectName}' because LOCAL_PROD_SMOKE_KEEP_STACK=true.`);
    console.log(`Temporary env file: ${envFile}`);
    return;
  }

  try {
    run("Tear down disposable production stack", composeArgs("down", "-v", "--remove-orphans"));
  } catch (error) {
    console.warn(error.message);
  }

  fs.rmSync(envFile, { force: true });
  fs.rmSync(hostBackupRoot, { recursive: true, force: true });
};

const main = async () => {
  if (!fs.existsSync(composeFile)) {
    throw new Error(`Missing production compose file: ${composeFile}`);
  }

  fs.writeFileSync(envFile, envContent, { encoding: "utf8", mode: 0o600 });
  fs.mkdirSync(hostBackupRoot, { recursive: true });

  console.log("Local production smoke");
  console.log(`Project: ${projectName}`);
  console.log(`Frontend: ${includeFrontend ? `http://127.0.0.1:${frontendPort}` : "skipped"}`);
  console.log("This uses temporary generated secrets and removes all containers/volumes when complete.");

  try {
    run("Validate production Docker Compose config", composeArgs("config"), { capture: true });
    run(
      "Build and start disposable production stack",
      composeArgs("up", "-d", "--build", includeFrontend ? "frontend" : "api")
    );
    run("Run refresh-token migration", composeArgs("exec", "-T", "api", "npm", "run", "db:migrate:refresh-token-hashes"));
    run("Run violation migration", composeArgs("exec", "-T", "api", "npm", "run", "db:migrate:violations"));
    run("Create MongoDB indexes", composeArgs("exec", "-T", "api", "npm", "run", "db:create-indexes"));
    run(
      "Create smoke SuperAdmin",
      composeArgs("exec", "-T", "api", "npm", "run", "create", "--", "--name=Smoke Owner", "--email=smoke-owner@example.com", `--password=${smokeSuperAdminPassword}`)
    );
    run("Run production readiness check", composeArgs("exec", "-T", "api", "npm", "run", "prod:check"));

    const apiReadyRaw = run(
      "Check API readiness inside container",
      composeArgs("exec", "-T", "api", "wget", "-q", "-O", "-", "http://localhost:5000/api/ready"),
      { capture: true }
    );
    const apiReady = JSON.parse(apiReadyRaw);
    if (apiReady.status !== "ok") {
      throw new Error(`API readiness is not ok: ${apiReadyRaw}`);
    }

    if (includeFrontend) {
      await fetchJson(`http://127.0.0.1:${frontendPort}/api/ready`);
      const frontendResponse = await fetch(`http://127.0.0.1:${frontendPort}/`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!frontendResponse.ok) {
        throw new Error(`Frontend returned ${frontendResponse.status}`);
      }
    }

    console.log("\nLocal production smoke passed.");
  } finally {
    cleanup();
  }
};

main().catch((error) => {
  console.error(`\nLocal production smoke failed: ${error.message}`);
  process.exitCode = 1;
});
