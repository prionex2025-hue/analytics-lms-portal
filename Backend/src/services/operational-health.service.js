const fs = require("fs/promises");
const path = require("path");

const env = require("../config/env");

const BYTES_IN_GB = 1024 ** 3;

const toGb = (bytes) => Number((bytes / BYTES_IN_GB).toFixed(2));
const toPercent = (value) => Number(value.toFixed(2));
const toAgeSeconds = (date) => Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

const resolveConfiguredPath = (targetPath) =>
  path.isAbsolute(String(targetPath || ""))
    ? path.resolve(targetPath)
    : path.resolve(process.cwd(), String(targetPath || "."));

const findExistingPath = async (targetPath) => {
  let current = resolveConfiguredPath(targetPath);

  while (current && current !== path.dirname(current)) {
    try {
      await fs.stat(current);
      return current;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      current = path.dirname(current);
    }
  }

  return current || path.parse(resolveConfiguredPath(targetPath)).root;
};

const getPathUsage = async (targetPath) => {
  const resolvedPath = resolveConfiguredPath(targetPath);
  try {
    const existingPath = await findExistingPath(resolvedPath);
    const stats = await fs.statfs(existingPath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    const percentUsed = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

    return {
      path: resolvedPath,
      exists: existingPath === resolvedPath,
      measured_path: existingPath,
      used_bytes: usedBytes,
      available_bytes: availableBytes,
      total_bytes: totalBytes,
      used_gb: toGb(usedBytes),
      available_gb: toGb(availableBytes),
      total_gb: toGb(totalBytes),
      percent_used: toPercent(percentUsed),
    };
  } catch (error) {
    return {
      path: resolvedPath,
      exists: false,
      measured_path: null,
      used_bytes: 0,
      available_bytes: 0,
      total_bytes: 0,
      used_gb: 0,
      available_gb: 0,
      total_gb: 0,
      percent_used: 0,
      error: error?.message || "Storage usage unavailable",
    };
  }
};

const findLatestMatchingFile = async (directory, predicate) => {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    let latest = null;

    for (const entry of entries) {
      if (!entry.isFile() || !predicate(entry.name)) {
        continue;
      }

      const filePath = path.join(directory, entry.name);
      const stat = await fs.stat(filePath);
      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = {
          file_path: filePath,
          file_name: entry.name,
          size_bytes: stat.size,
          modified_at: stat.mtime.toISOString(),
          mtimeMs: stat.mtimeMs,
        };
      }
    }

    return latest;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    return {
      error: error?.message || "Backup directory unavailable",
    };
  }
};

const getBackupInfo = async ({ label, directory, predicate, maxAgeHours }) => {
  const latest = await findLatestMatchingFile(directory, predicate);
  if (!latest || latest.error) {
    return {
      label,
      directory,
      present: false,
      status: "missing",
      age_seconds: -1,
      age_hours: -1,
      latest: latest?.error ? { error: latest.error } : null,
    };
  }

  const ageSeconds = toAgeSeconds(new Date(latest.modified_at));
  const ageHours = Number((ageSeconds / 3600).toFixed(2));
  const stale = ageSeconds > maxAgeHours * 3600;

  return {
    label,
    directory,
    present: true,
    status: stale ? "stale" : "ok",
    age_seconds: ageSeconds,
    age_hours: ageHours,
    latest: {
      file_path: latest.file_path,
      file_name: latest.file_name,
      size_bytes: latest.size_bytes,
      modified_at: latest.modified_at,
    },
  };
};

const getTempUploadStats = async (tempDirectory, maxAgeHours) => {
  try {
    const entries = await fs.readdir(tempDirectory, { withFileTypes: true });
    let fileCount = 0;
    let totalBytes = 0;
    let staleFiles = 0;
    let oldestAgeSeconds = 0;
    const staleAfterSeconds = maxAgeHours * 3600;

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const stat = await fs.stat(path.join(tempDirectory, entry.name));
      const ageSeconds = toAgeSeconds(stat.mtime);
      fileCount += 1;
      totalBytes += stat.size;
      oldestAgeSeconds = Math.max(oldestAgeSeconds, ageSeconds);
      if (ageSeconds > staleAfterSeconds) {
        staleFiles += 1;
      }
    }

    return {
      path: tempDirectory,
      file_count: fileCount,
      total_bytes: totalBytes,
      stale_files: staleFiles,
      oldest_age_seconds: oldestAgeSeconds,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        path: tempDirectory,
        file_count: 0,
        total_bytes: 0,
        stale_files: 0,
        oldest_age_seconds: 0,
      };
    }

    return {
      path: tempDirectory,
      file_count: 0,
      total_bytes: 0,
      stale_files: 0,
      oldest_age_seconds: 0,
      error: error?.message || "Temporary upload directory unavailable",
    };
  }
};

const getUploadStorageHealth = async () => {
  const uploadRoot = resolveConfiguredPath(env.resourceUpload.root);
  const tempDirectory = path.join(uploadRoot, "_tmp");
  const [disk, temp] = await Promise.all([
    getPathUsage(uploadRoot),
    getTempUploadStats(tempDirectory, env.operations.uploadTmpMaxAgeHours),
  ]);

  let status = "ok";
  if (disk.error || disk.percent_used >= env.operations.uploadDiskCriticalPercent) {
    status = "critical";
  } else if (!disk.exists || disk.percent_used >= env.operations.uploadDiskWarningPercent || temp.stale_files > 0) {
    status = "degraded";
  }

  return {
    status,
    disk,
    temp,
    thresholds: {
      warning_percent: env.operations.uploadDiskWarningPercent,
      critical_percent: env.operations.uploadDiskCriticalPercent,
      temp_max_age_hours: env.operations.uploadTmpMaxAgeHours,
    },
    malware_scan: {
      enabled: env.uploadScan.enabled,
      required: env.uploadScan.required,
      host: env.uploadScan.host,
      port: env.uploadScan.port,
    },
  };
};

const getBackupFreshness = async () => {
  const backupRoot = resolveConfiguredPath(env.operations.backupRoot);
  const uploadsBackupRoot = resolveConfiguredPath(env.operations.uploadsBackupRoot);
  const [mongodb, uploads] = await Promise.all([
    getBackupInfo({
      label: "mongodb",
      directory: path.join(backupRoot, "mongodb"),
      predicate: (name) => /^mongodb-.*\.archive\.gz$/.test(name),
      maxAgeHours: env.operations.backupMaxAgeHours,
    }),
    getBackupInfo({
      label: "uploads",
      directory: uploadsBackupRoot,
      predicate: (name) => /^uploads-.*\.tar\.gz$/.test(name),
      maxAgeHours: env.operations.backupMaxAgeHours,
    }),
  ]);

  const status = [mongodb.status, uploads.status].includes("missing")
    ? "missing"
    : [mongodb.status, uploads.status].includes("stale")
      ? "stale"
      : "ok";

  return {
    status,
    max_age_hours: env.operations.backupMaxAgeHours,
    mongodb,
    uploads,
  };
};

const getOperationalHealthSnapshot = async () => {
  const [applicationDisk, uploads, backups] = await Promise.all([
    getPathUsage(process.cwd()),
    getUploadStorageHealth(),
    getBackupFreshness(),
  ]);

  return {
    application_disk: applicationDisk,
    uploads,
    backups,
  };
};

module.exports = {
  getOperationalHealthSnapshot,
  getPathUsage,
  getBackupFreshness,
  getUploadStorageHealth,
};
