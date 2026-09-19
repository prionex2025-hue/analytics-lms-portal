module.exports = {
  apps: [
    {
      name: "lms-portal-api",
      cwd: "/var/www/lms-portal/Backend",
      script: "src/server.js",
      instances: 2,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 5000,
      },
      max_memory_restart: "1200M",
      kill_timeout: 15000,
      listen_timeout: 10000,
      time: true,
      error_file: "/var/log/lms-portal/api-error.log",
      out_file: "/var/log/lms-portal/api-out.log",
      merge_logs: true,
    },
  ],
};
