const monitoringRoutes = require("../routes/SuperAdmin/monitoring.routes");
const { authenticateSuperAdmin } = require("../middleware/auth");
const { startAlertMonitoring, stopAlertMonitoring } = require("../services/alert-monitoring.service");

const alertConfig = {
  slackWebhook: process.env.SLACK_WEBHOOK_URL || null,
  emailService: null,
  alertEmails: (process.env.ALERT_EMAILS || "").split(",").filter(Boolean),
  pagerdutyKey: process.env.PAGERDUTY_KEY || null,
};

let alertMonitoringInterval = null;
let shutdownHandlersRegistered = false;

function startAlertMonitoringService(interval = 60000) {
  if (alertMonitoringInterval || (process.env.NODE_ENV !== "production" && process.env.ENABLE_ALERTS !== "true")) {
    return;
  }

  alertMonitoringInterval = startAlertMonitoring(alertConfig, interval);
  console.log(`Validation alert monitoring started (check every ${interval}ms)`);
}

function stopAlertMonitoringService() {
  if (!alertMonitoringInterval) {
    return;
  }

  stopAlertMonitoring(alertMonitoringInterval);
  alertMonitoringInterval = null;
  console.log("Validation alert monitoring stopped");
}

function setupCompleteValidationSystem(app) {
  app.use("/api/super-admin", authenticateSuperAdmin, monitoringRoutes);

  startAlertMonitoringService(parseInt(process.env.ALERT_CHECK_INTERVAL || "60000", 10));

  if (!shutdownHandlersRegistered) {
    process.once("SIGTERM", stopAlertMonitoringService);
    process.once("SIGINT", stopAlertMonitoringService);
    shutdownHandlersRegistered = true;
  }
}

module.exports = {
  setupCompleteValidationSystem,
  stopAlertMonitoringService,
};
