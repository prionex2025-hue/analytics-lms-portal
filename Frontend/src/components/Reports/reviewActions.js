// Anomaly review outcomes per portal. Admins escalate to the super admin; the
// super admin is the final reviewer and confirms instead (the server schemas
// enforce the same split).
export const ADMIN_REVIEW_ACTIONS = [
  { value: "DISMISS", label: "Dismiss", tone: "neutral" },
  { value: "ESCALATE", label: "Escalate", tone: "danger" },
];

export const SUPER_REVIEW_ACTIONS = [
  { value: "DISMISS", label: "Dismiss", tone: "neutral" },
  { value: "CONFIRM", label: "Confirm", tone: "danger" },
];
