describe("clamav service", () => {
  const originalEnv = process.env;
  const baseEnv = {
    MONGODB_URI: "mongodb://localhost:27017/lms_test",
    JWT_ACCESS_SECRET: "a".repeat(48),
    JWT_REFRESH_SECRET: "b".repeat(48),
  };

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  it("skips scans when AV scanning is disabled", async () => {
    process.env = {
      ...originalEnv,
      ...baseEnv,
      UPLOAD_AV_SCAN_ENABLED: "false",
    };

    const { scanFileForThreats } = require("../../services/clamav.service");
    await expect(scanFileForThreats("/tmp/missing-file.pdf")).resolves.toMatchObject({
      status: "skipped",
    });
  });
});
