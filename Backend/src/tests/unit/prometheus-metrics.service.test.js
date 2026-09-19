describe("prometheus metrics service", () => {
  const loadModule = () => {
    jest.resetModules();

    jest.doMock("../../utils/db", () => ({
      getDb: jest.fn(async () => ({
        college: {
          count: jest.fn(async () => 1),
        },
      })),
    }));
    jest.doMock("../../config/redis", () => ({
      getRedisHealthSnapshot: jest.fn(async () => ({
        configured: true,
        available: true,
        latencyMs: 5,
      })),
    }));
    jest.doMock("../../realtime/socket", () => ({
      getIO: jest.fn(() => ({
        engine: {
          clientsCount: 3,
        },
      })),
    }));
    jest.doMock("../../services/api-metrics.service", () => ({
      getApiMetricsSnapshot: jest.fn(async () => ({
        requestsPerMinute: 42,
        avgResponseMs: 125.5,
        errorRatePercent: 0.25,
      })),
    }));
    jest.doMock("../../services/rate-limit-metrics.service", () => ({
      getRateLimitMetricsSnapshot: jest.fn(async () => ({
        totalBlocked: 7,
      })),
    }));
    jest.doMock("../../services/operational-health.service", () => ({
      getOperationalHealthSnapshot: jest.fn(async () => ({
        uploads: {
          disk: {
            percent_used: 44.5,
            available_bytes: 123456,
          },
          temp: {
            file_count: 2,
            stale_files: 1,
          },
          malware_scan: {
            enabled: true,
            required: true,
          },
        },
        backups: {
          mongodb: {
            present: true,
            age_seconds: 60,
          },
          uploads: {
            present: true,
            age_seconds: 90,
          },
        },
      })),
    }));

    return require("../../services/prometheus-metrics.service");
  };

  it("exports operational metrics without sensitive values", async () => {
    const { getPrometheusMetrics } = loadModule();

    const output = await getPrometheusMetrics();

    expect(output).toContain("lms_mongodb_up 1");
    expect(output).toContain("lms_redis_available 1");
    expect(output).toContain("lms_socket_connected_clients 3");
    expect(output).toContain("lms_api_requests_per_minute 42");
    expect(output).toContain("lms_rate_limit_blocked_total 7");
    expect(output).toContain("lms_upload_disk_used_percent 44.5");
    expect(output).toContain("lms_upload_tmp_stale_files 1");
    expect(output).toContain("lms_upload_malware_scan_enabled 1");
    expect(output).toContain("lms_backup_mongodb_present 1");
    expect(output).toContain("lms_backup_uploads_latest_age_seconds 90");
    expect(output).not.toContain("MONGODB_URI");
    expect(output).not.toContain("REDIS_URL");
  });
});
