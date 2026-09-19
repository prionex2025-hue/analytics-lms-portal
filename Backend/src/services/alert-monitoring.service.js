/**
 * Production Alert Configuration
 * 
 * Configures alerting rules for validation anomalies.
 * Supports multiple notification channels: Slack, Email, PagerDuty, etc.
 */

const {
  getMetricsSnapshot,
  detectAnomalies,
} = require("./validation-monitoring.service");

/**
 * Alert severity levels
 */
const SEVERITY = {
  INFO: "info",
  WARNING: "warning",
  CRITICAL: "critical",
};

/**
 * Alert rules configuration
 */
const ALERT_RULES = {
  HIGH_FAILURE_RATE: {
    name: "High Validation Failure Rate",
    description: "Validation failure rate exceeds threshold",
    threshold: 10, // percentage
    severity: SEVERITY.CRITICAL,
    channels: ["slack", "email", "pagerduty"],
  },
  SLOW_VALIDATIONS: {
    name: "Slow Validation Performance",
    description: "Average validation latency exceeds threshold",
    threshold: 50, // milliseconds
    severity: SEVERITY.WARNING,
    channels: ["slack"],
  },
  NO_ACTIVITY: {
    name: "No Validation Activity",
    description: "No validations recorded in time window",
    threshold: 300000, // 5 minutes in milliseconds
    severity: SEVERITY.WARNING,
    channels: ["slack"],
  },
  PERSISTENT_ERRORS: {
    name: "Persistent Validation Errors",
    description: "Same validation error occurring repeatedly",
    threshold: 5, // consecutive occurrences
    severity: SEVERITY.CRITICAL,
    channels: ["slack", "email"],
  },
};

/**
 * Alert notifier implementations
 */
const notifiers = {
  /**
   * Send alert to Slack
   */
  slack: async (alert, config) => {
    if (!config.slackWebhook) {
      console.warn("Slack webhook not configured");
      return;
    }

    const color = {
      [SEVERITY.INFO]: "#36a64f",
      [SEVERITY.WARNING]: "#ff9900",
      [SEVERITY.CRITICAL]: "#ff0000",
    }[alert.severity];

    const payload = {
      attachments: [
        {
          color,
          title: alert.name,
          text: alert.message,
          fields: [
            {
              title: "Severity",
              value: alert.severity.toUpperCase(),
              short: true,
            },
            {
              title: "Time",
              value: new Date().toISOString(),
              short: true,
            },
            ...(alert.details ? Object.entries(alert.details).map(([key, value]) => ({
              title: key,
              value: JSON.stringify(value),
              short: false,
            })) : []),
          ],
          footer: "LMS Validation Monitoring",
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    try {
      const response = await fetch(config.slackWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error("Slack alert failed:", response.status, response.statusText);
      }
    } catch (error) {
      console.error("Slack notification error:", error.message);
    }
  },

  /**
   * Send alert via email
   */
  email: async (alert, config) => {
    if (!config.emailService) {
      console.warn("Email service not configured");
      return;
    }

    const emailBody = `
      <h2>${alert.name}</h2>
      <p>${alert.message}</p>
      <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
      <p><strong>Time:</strong> ${new Date().toISOString()}</p>
      ${alert.details ? `
        <h3>Details:</h3>
        <pre>${JSON.stringify(alert.details, null, 2)}</pre>
      ` : ""}
    `;

    try {
      await config.emailService.send({
        to: config.alertEmails || [],
        subject: `[${alert.severity.toUpperCase()}] ${alert.name}`,
        html: emailBody,
      });
    } catch (error) {
      console.error("Email notification error:", error.message);
    }
  },

  /**
   * Send alert to PagerDuty
   */
  pagerduty: async (alert, config) => {
    if (!config.pagerdutyKey) {
      console.warn("PagerDuty key not configured");
      return;
    }

    const severityMap = {
      [SEVERITY.INFO]: "info",
      [SEVERITY.WARNING]: "warning",
      [SEVERITY.CRITICAL]: "critical",
    };

    const payload = {
      routing_key: config.pagerdutyKey,
      event_action: "trigger",
      payload: {
        summary: alert.name,
        severity: severityMap[alert.severity],
        source: "LMS Validation Monitoring",
        custom_details: alert.details,
      },
    };

    try {
      const response = await fetch("https://events.pagerduty.com/v2/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error("PagerDuty alert failed:", response.status);
      }
    } catch (error) {
      console.error("PagerDuty notification error:", error.message);
    }
  },

  /**
   * Log alert locally
   */
  log: async (alert) => {
    const level = {
      [SEVERITY.INFO]: "info",
      [SEVERITY.WARNING]: "warn",
      [SEVERITY.CRITICAL]: "error",
    }[alert.severity];

    console[level](`[ALERT] ${alert.name}:`, alert.message, alert.details);
  },
};

/**
 * Check validation metrics and trigger alerts
 */
async function checkAndAlert(config = {}) {
  const alerts = [];
  const metrics = await getMetricsSnapshot();
  const anomalies = await detectAnomalies();

  // Check high failure rate
  if (metrics.summary.total > 0) {
    const failureRate = (metrics.summary.failed / metrics.summary.total) * 100;
    if (failureRate > ALERT_RULES.HIGH_FAILURE_RATE.threshold) {
      alerts.push({
        name: ALERT_RULES.HIGH_FAILURE_RATE.name,
        message: `Validation failure rate: ${failureRate.toFixed(2)}%`,
        severity: ALERT_RULES.HIGH_FAILURE_RATE.severity,
        channels: ALERT_RULES.HIGH_FAILURE_RATE.channels,
        details: {
          failure_rate: failureRate,
          failed_count: metrics.summary.failed,
          total_count: metrics.summary.total,
        },
      });
    }
  }

  // Check for anomalies
  if (anomalies.length > 0) {
    alerts.push({
      name: "Validation Anomalies Detected",
      message: `${anomalies.length} anomalies detected in validation metrics`,
      severity: SEVERITY.WARNING,
      channels: ["slack"],
      details: {
        anomalies: anomalies.map((a) => ({
          type: a.type,
          model: a.model,
          value: a.value,
        })),
      },
    });
  }

  // Send all alerts
  for (const alert of alerts) {
    for (const channel of alert.channels) {
      if (notifiers[channel]) {
        await notifiers[channel](alert, config);
      }
    }
  }

  return alerts;
}

/**
 * Start background alert monitoring
 */
function startAlertMonitoring(config = {}, interval = 60000) {
  // Check every minute by default
  const intervalId = setInterval(async () => {
    try {
      await checkAndAlert(config);
    } catch (error) {
      console.error("Alert monitoring error:", error.message);
    }
  }, interval);

  return intervalId;
}

/**
 * Stop alert monitoring
 */
function stopAlertMonitoring(intervalId) {
  if (intervalId) {
    clearInterval(intervalId);
  }
}

module.exports = {
  SEVERITY,
  ALERT_RULES,
  checkAndAlert,
  startAlertMonitoring,
  stopAlertMonitoring,
};
