const fs = require("fs/promises");
const os = require("os");
const path = require("path");

describe("operational health service", () => {
  const originalEnv = process.env;
  const baseEnv = {
    MONGODB_URI: "mongodb://localhost:27017/lms_test",
    JWT_ACCESS_SECRET: "a".repeat(48),
    JWT_REFRESH_SECRET: "b".repeat(48),
  };

  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lms-ops-health-"));
    process.env = {
      ...originalEnv,
      ...baseEnv,
      RESOURCE_UPLOAD_ROOT: path.join(tempRoot, "uploads", "resources"),
      BACKUP_ROOT: path.join(tempRoot, "backups"),
      UPLOADS_BACKUP_ROOT: path.join(tempRoot, "backups", "uploads"),
      UPLOAD_AV_SCAN_ENABLED: "false",
    };
  });

  afterEach(async () => {
    jest.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
    process.env = originalEnv;
  });

  it("reports backup freshness and upload temp health", async () => {
    await fs.mkdir(path.join(tempRoot, "uploads", "resources", "_tmp"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "backups", "mongodb"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "backups", "uploads"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "uploads", "resources", "_tmp", "pending.tmp"), "x");
    await fs.writeFile(path.join(tempRoot, "backups", "mongodb", "mongodb-20260531T000000Z.archive.gz"), "x");
    await fs.writeFile(path.join(tempRoot, "backups", "uploads", "uploads-20260531T000000Z.tar.gz"), "x");

    const { getOperationalHealthSnapshot } = require("../../services/operational-health.service");
    const snapshot = await getOperationalHealthSnapshot();

    expect(snapshot.uploads.temp.file_count).toBe(1);
    expect(snapshot.backups.mongodb.present).toBe(true);
    expect(snapshot.backups.uploads.present).toBe(true);
    expect(snapshot.uploads.malware_scan.enabled).toBe(false);
  });
});
