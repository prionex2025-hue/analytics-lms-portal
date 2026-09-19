const dotenv = require("dotenv");

dotenv.config();

const nodeEnv = process.env.NODE_ENV || "development";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required");
}

// JWT secrets are required in ALL environments to prevent accidental use of
// weak defaults. Generate strong secrets with: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

if (!jwtAccessSecret || jwtAccessSecret.length < 32) {
  throw new Error(
    "JWT_ACCESS_SECRET must be set and at least 32 characters. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\""
  );
}

if (!jwtRefreshSecret || jwtRefreshSecret.length < 32) {
  throw new Error(
    "JWT_REFRESH_SECRET must be set and at least 32 characters. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\""
  );
}

const parseOrigins = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const frontendOrigins = parseOrigins(process.env.FRONTEND_ORIGIN || "http://localhost:5173");

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const toBoolean = (value, fallback) => {
  if (typeof value === "undefined") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const legacyExamWriteWindowMs = toPositiveInt(process.env.RATE_LIMIT_EXAM_WRITE_WINDOW_MS, 60 * 1000);
const legacyExamWriteMax = toPositiveInt(process.env.RATE_LIMIT_EXAM_WRITE_MAX, 100);

const rateLimit = {
  authLoginWindowMs: toPositiveInt(process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS, 15 * 60 * 1000),
  authLoginMax: toPositiveInt(process.env.RATE_LIMIT_AUTH_LOGIN_MAX, 15),
  authRefreshWindowMs: toPositiveInt(process.env.RATE_LIMIT_AUTH_REFRESH_WINDOW_MS, 5 * 60 * 1000),
  authRefreshMax: toPositiveInt(process.env.RATE_LIMIT_AUTH_REFRESH_MAX, 50),
  authForgotPasswordWindowMs: toPositiveInt(process.env.RATE_LIMIT_AUTH_FORGOT_PASSWORD_WINDOW_MS, 15 * 60 * 1000),
  authForgotPasswordMax: toPositiveInt(process.env.RATE_LIMIT_AUTH_FORGOT_PASSWORD_MAX, 5),
  authResetPasswordWindowMs: toPositiveInt(process.env.RATE_LIMIT_AUTH_RESET_PASSWORD_WINDOW_MS, 15 * 60 * 1000),
  authResetPasswordMax: toPositiveInt(process.env.RATE_LIMIT_AUTH_RESET_PASSWORD_MAX, 10),
  superAdminAuthLoginWindowMs: toPositiveInt(process.env.RATE_LIMIT_SUPER_ADMIN_AUTH_LOGIN_WINDOW_MS, 15 * 60 * 1000),
  superAdminAuthLoginMax: toPositiveInt(process.env.RATE_LIMIT_SUPER_ADMIN_AUTH_LOGIN_MAX, 5),
  superAdminPasswordResetWindowMs: toPositiveInt(process.env.RATE_LIMIT_SUPER_ADMIN_PASSWORD_RESET_WINDOW_MS, 60 * 60 * 1000),
  superAdminPasswordResetMax: toPositiveInt(process.env.RATE_LIMIT_SUPER_ADMIN_PASSWORD_RESET_MAX, 3),
  examWriteWindowMs: legacyExamWriteWindowMs,
  examWriteMax: legacyExamWriteMax,
  examAnswerWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_ANSWER_WINDOW_MS, legacyExamWriteWindowMs),
  examAnswerMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_ANSWER_MAX, legacyExamWriteMax),
  examHeartbeatWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_HEARTBEAT_WINDOW_MS, 60 * 1000),
  examHeartbeatMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_HEARTBEAT_MAX, 30),
  examViolationWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_VIOLATION_WINDOW_MS, 60 * 1000),
  examViolationMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_VIOLATION_MAX, 12),
  examSubmitWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_SUBMIT_WINDOW_MS, 15 * 1000),
  examSubmitMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_SUBMIT_MAX, 3),
  examStartWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_START_WINDOW_MS, 60 * 1000),
  examStartMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_START_MAX, 20),
  examListWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_LIST_WINDOW_MS, 30 * 1000),
  examListMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_LIST_MAX, 20),
  examSessionWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_SESSION_WINDOW_MS, 30 * 1000),
  examSessionMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_SESSION_MAX, 30),
  eventRegisterWindowMs: toPositiveInt(process.env.RATE_LIMIT_EVENT_REGISTER_WINDOW_MS, 60 * 1000),
  eventRegisterMax: toPositiveInt(process.env.RATE_LIMIT_EVENT_REGISTER_MAX, 6),
  studentReportWindowMs: toPositiveInt(process.env.RATE_LIMIT_STUDENT_REPORT_WINDOW_MS, 60 * 1000),
  studentReportMax: toPositiveInt(process.env.RATE_LIMIT_STUDENT_REPORT_MAX, 10),
  generalApiWindowMs: toPositiveInt(process.env.RATE_LIMIT_GENERAL_API_WINDOW_MS, 60 * 1000),
  generalApiMax: toPositiveInt(process.env.RATE_LIMIT_GENERAL_API_MAX, 240),
  superAdminApiWindowMs: toPositiveInt(process.env.RATE_LIMIT_SUPER_ADMIN_API_WINDOW_MS, 60 * 1000),
  superAdminApiMax: toPositiveInt(process.env.RATE_LIMIT_SUPER_ADMIN_API_MAX, 600),
  reportGenerationWindowMs: toPositiveInt(process.env.RATE_LIMIT_REPORT_GENERATION_WINDOW_MS, 60 * 1000),
  reportGenerationMax: toPositiveInt(process.env.RATE_LIMIT_REPORT_GENERATION_MAX, 10),
  adminReportReadWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_REPORT_READ_WINDOW_MS, 30 * 1000),
  adminReportReadMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_REPORT_READ_MAX, 20),
  adminTestListWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_LIST_WINDOW_MS, 30 * 1000),
  adminTestListMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_LIST_MAX, 30),
  adminTestCreateWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_CREATE_WINDOW_MS, 60 * 1000),
  adminTestCreateMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_CREATE_MAX, 8),
  adminTestUpdateWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_UPDATE_WINDOW_MS, 60 * 1000),
  adminTestUpdateMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_UPDATE_MAX, 20),
  adminTestPublishWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_PUBLISH_WINDOW_MS, 60 * 1000),
  adminTestPublishMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_PUBLISH_MAX, 6),
  adminTestCloneWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_CLONE_WINDOW_MS, 60 * 1000),
  adminTestCloneMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_CLONE_MAX, 5),
  adminTestMonitoringWriteWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_MONITORING_WRITE_WINDOW_MS, 60 * 1000),
  adminTestMonitoringWriteMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_MONITORING_WRITE_MAX, 20),
  adminQuestionBankBulkImportWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_QUESTION_BANK_BULK_IMPORT_WINDOW_MS, 5 * 60 * 1000),
  adminQuestionBankBulkImportMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_QUESTION_BANK_BULK_IMPORT_MAX, 5),
  adminBatchGuardWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_BATCH_GUARD_WINDOW_MS, 60 * 1000),
  adminBatchGuardMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_BATCH_GUARD_MAX, 12),
  superReportWindowMs: toPositiveInt(process.env.RATE_LIMIT_SUPER_REPORT_WINDOW_MS, 60 * 1000),
  superReportMax: toPositiveInt(process.env.RATE_LIMIT_SUPER_REPORT_MAX, 20),
  superReportReadWindowMs: toPositiveInt(process.env.RATE_LIMIT_SUPER_REPORT_READ_WINDOW_MS, 60 * 1000),
  superReportReadMax: toPositiveInt(process.env.RATE_LIMIT_SUPER_REPORT_READ_MAX, 180),
  leaderboardWindowMs: toPositiveInt(process.env.RATE_LIMIT_LEADERBOARD_WINDOW_MS, 30 * 1000),
  leaderboardMax: toPositiveInt(process.env.RATE_LIMIT_LEADERBOARD_MAX, 20),
  searchWindowMs: toPositiveInt(process.env.RATE_LIMIT_SEARCH_WINDOW_MS, 30 * 1000),
  searchMax: toPositiveInt(process.env.RATE_LIMIT_SEARCH_MAX, 30),
  collegeAdminApiWindowMs: toPositiveInt(process.env.RATE_LIMIT_COLLEGE_ADMIN_API_WINDOW_MS, 60 * 1000),
  collegeAdminApiMax: toPositiveInt(process.env.RATE_LIMIT_COLLEGE_ADMIN_API_MAX, 180),
  adminEntityReadWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_ENTITY_READ_WINDOW_MS, 30 * 1000),
  adminEntityReadMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_ENTITY_READ_MAX, 40),
  adminEntityWriteWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_ENTITY_WRITE_WINDOW_MS, 60 * 1000),
  adminEntityWriteMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_ENTITY_WRITE_MAX, 20),
  adminAnalyticsReadWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_ANALYTICS_READ_WINDOW_MS, 30 * 1000),
  adminAnalyticsReadMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_ANALYTICS_READ_MAX, 20),
  adminSettingsWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_SETTINGS_WINDOW_MS, 60 * 1000),
  adminSettingsMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_SETTINGS_MAX, 12),
  resourceDownloadWindowMs: toPositiveInt(process.env.RATE_LIMIT_RESOURCE_DOWNLOAD_WINDOW_MS, 60 * 1000),
  resourceDownloadMax: toPositiveInt(process.env.RATE_LIMIT_RESOURCE_DOWNLOAD_MAX, 20),
  resourceSearchWindowMs: toPositiveInt(process.env.RATE_LIMIT_RESOURCE_SEARCH_WINDOW_MS, 60 * 1000),
  resourceSearchMax: toPositiveInt(process.env.RATE_LIMIT_RESOURCE_SEARCH_MAX, 60),
  resourceUploadWindowMs: toPositiveInt(process.env.RATE_LIMIT_RESOURCE_UPLOAD_WINDOW_MS, 60 * 1000),
  resourceUploadMax: toPositiveInt(process.env.RATE_LIMIT_RESOURCE_UPLOAD_MAX, 10),
  metricsTopNDefault: toPositiveInt(process.env.RATE_LIMIT_METRICS_TOP_N_DEFAULT, 10),
};

const responseCache = {
  enabled: toBoolean(process.env.RESPONSE_CACHE_ENABLED, true),
  adminReportsTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_ADMIN_REPORTS_TTL_SECONDS, 30),
  adminSearchTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_ADMIN_SEARCH_TTL_SECONDS, 10),
  adminCollectionsTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_ADMIN_COLLECTIONS_TTL_SECONDS, 20),
  adminAnalyticsTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_ADMIN_ANALYTICS_TTL_SECONDS, 30),
  superAnalyticsTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_SUPER_ANALYTICS_TTL_SECONDS, 30),
  studentDashboardTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_STUDENT_DASHBOARD_TTL_SECONDS, 15),
  studentTestsTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_STUDENT_TESTS_TTL_SECONDS, 20),
  adminDashboardTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_ADMIN_DASHBOARD_TTL_SECONDS, 20),
  superDashboardTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_SUPER_DASHBOARD_TTL_SECONDS, 20),
};

const database = {
  relationFilterMaxCandidates: toPositiveInt(
    process.env.DB_RELATION_FILTER_MAX_CANDIDATES,
    nodeEnv === "production" ? 5000 : 50000
  ),
  relationFilterBatchSize: toPositiveInt(process.env.DB_RELATION_FILTER_BATCH_SIZE, 500),
};

const redis = {
  enabled: toBoolean(process.env.REDIS_ENABLED, nodeEnv !== "development" && nodeEnv !== "test"),
  connectTimeoutMs: toPositiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 10_000),
  keepAliveMs: toPositiveInt(process.env.REDIS_KEEP_ALIVE_MS, 30_000),
  maxRetryDelayMs: toPositiveInt(process.env.REDIS_MAX_RETRY_DELAY_MS, 2_000),
  maxMemory: process.env.REDIS_MAXMEMORY || "",
  maxMemoryPolicy: process.env.REDIS_MAXMEMORY_POLICY || "",
  queueEnabled: toBoolean(process.env.REDIS_QUEUE_ENABLED, nodeEnv !== "development" && nodeEnv !== "test"),
};

const metrics = {
  enabled: toBoolean(process.env.METRICS_ENABLED, nodeEnv === "production"),
  token: process.env.METRICS_TOKEN || "",
};

const loginLockout = {
  maxAttempts: toPositiveInt(process.env.LOGIN_LOCKOUT_MAX_ATTEMPTS, 5),
  windowMs: toPositiveInt(process.env.LOGIN_LOCKOUT_WINDOW_MS, 15 * 60 * 1000),
  baseLockoutMs: toPositiveInt(process.env.LOGIN_LOCKOUT_BASE_LOCKOUT_MS, 5 * 60 * 1000),
  maxLockoutMs: toPositiveInt(process.env.LOGIN_LOCKOUT_MAX_LOCKOUT_MS, 30 * 60 * 1000),
};

const email = {
  resendApiKey: process.env.RESEND_API_KEY || "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL || "noreply@analyticsedify.com",
  resendFromName: process.env.RESEND_FROM_NAME || "Analytics Edify",
};

const resourceUpload = {
  root: process.env.RESOURCE_UPLOAD_ROOT || "uploads/resources",
  maxFileSizeBytes: toPositiveInt(process.env.RESOURCE_MAX_FILE_SIZE_BYTES, 50 * 1024 * 1024),
};

const backupRoot = process.env.BACKUP_ROOT || "/var/backups/lms-portal";

const operations = {
  backupRoot,
  uploadsBackupRoot: process.env.UPLOADS_BACKUP_ROOT || `${backupRoot}/uploads`,
  backupMaxAgeHours: toPositiveInt(process.env.BACKUP_MAX_AGE_HOURS, 26),
  uploadDiskWarningPercent: toPositiveInt(process.env.UPLOAD_DISK_WARNING_PERCENT, 80),
  uploadDiskCriticalPercent: toPositiveInt(process.env.UPLOAD_DISK_CRITICAL_PERCENT, 90),
  uploadTmpMaxAgeHours: toPositiveInt(process.env.UPLOAD_TMP_MAX_AGE_HOURS, 24),
};

const uploadScan = {
  enabled: toBoolean(process.env.UPLOAD_AV_SCAN_ENABLED, false),
  required: toBoolean(process.env.UPLOAD_AV_SCAN_REQUIRED, nodeEnv === "production"),
  host: process.env.CLAMAV_HOST || "clamav",
  port: toPositiveInt(process.env.CLAMAV_PORT, 3310),
  timeoutMs: toPositiveInt(process.env.CLAMAV_TIMEOUT_MS, 15_000),
};

// Web/worker split: every replica still enqueues jobs (BullMQ producer), but
// only replicas with WORKER_ENABLED=true consume them and run queue recovery.
// Defaults to true so single-instance, PM2, dev, and test runs keep working.
const worker = {
  enabled: toBoolean(process.env.WORKER_ENABLED, true),
};

const normalizeUrlBase = (value) => String(value || "").trim().replace(/\/+$/, "");
const getUrlOrigin = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
};

const configuredPasswordResetMode = String(process.env.PASSWORD_RESET_DELIVERY_MODE || "").trim().toLowerCase();
const normalizedPasswordResetMode =
  configuredPasswordResetMode === "webhook" && email.resendApiKey
    ? "resend"
    : configuredPasswordResetMode;
const legacyPasswordResetUrl = process.env.PASSWORD_RESET_FRONTEND_URL || "";
const passwordResetBaseUrl = normalizeUrlBase(
  process.env.PASSWORD_RESET_FRONTEND_BASE_URL ||
  getUrlOrigin(legacyPasswordResetUrl) ||
  frontendOrigins[0] ||
  "http://localhost:5173"
);

const passwordReset = {
  tokenTtlMinutes: toPositiveInt(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES, 30),
  deliveryMode: normalizedPasswordResetMode || (email.resendApiKey ? "resend" : (nodeEnv === "production" ? "resend" : "response")),
  frontendUrl: legacyPasswordResetUrl || `${passwordResetBaseUrl}/reset-password`,
  resetUrls: {
    student: process.env.PASSWORD_RESET_STUDENT_FRONTEND_URL || legacyPasswordResetUrl || `${passwordResetBaseUrl}/reset-password`,
    admin: process.env.PASSWORD_RESET_ADMIN_FRONTEND_URL || `${passwordResetBaseUrl}/admin/reset-password`,
    "college-admin": process.env.PASSWORD_RESET_COLLEGE_ADMIN_FRONTEND_URL || `${passwordResetBaseUrl}/college-admin/reset-password`,
    "super-admin": process.env.PASSWORD_RESET_SUPER_ADMIN_FRONTEND_URL || `${passwordResetBaseUrl}/super-admin/reset-password`,
  },
  returnToken: toBoolean(process.env.PASSWORD_RESET_RETURN_TOKEN, nodeEnv !== "production"),
};

module.exports = {
  port: Number(process.env.PORT || 5000),
  nodeEnv,
  mongoUri: process.env.MONGODB_URI,
  mongoDbName: process.env.MONGODB_DB_NAME || "lms_portal",
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "5mb",
  jwtAccessSecret,
  jwtRefreshSecret,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  frontendOrigin: frontendOrigins[0] || "http://localhost:5173",
  frontendOrigins,
  redisUrl: process.env.REDIS_URL || "",
  redis,
  metrics,
  loginLockout,
  email,
  resourceUpload,
  operations,
  uploadScan,
  passwordReset,
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || "",
  cloudinaryFolder: process.env.CLOUDINARY_FOLDER || "lms-portal",
  rateLimit,
  responseCache,
  database,
  worker,
};
