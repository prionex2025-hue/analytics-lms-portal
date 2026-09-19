export const SUPPORT_EMAIL = "prionex2025@gmail.com";

const encodeMailtoValue = (value) => encodeURIComponent(value).replace(/%0A/g, "%0D%0A");

export function buildSupportMailto({ subject, message, reporter = {}, category = "Feedback" }) {
  const reporterLines = [
    reporter.name ? `Name: ${reporter.name}` : null,
    reporter.email ? `Email: ${reporter.email}` : null,
    reporter.role ? `Role: ${reporter.role}` : null,
    reporter.id ? `ID: ${reporter.id}` : null,
    reporter.college ? `College: ${reporter.college}` : null,
    reporter.department ? `Department: ${reporter.department}` : null,
  ].filter(Boolean);

  const body = [
    `Category: ${category}`,
    "",
    "Message:",
    message,
    "",
    "Reporter details:",
    reporterLines.length ? reporterLines.join("\n") : "Not available",
  ].join("\n");

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeMailtoValue(subject)}&body=${encodeMailtoValue(body)}`;
}

export function openSupportMail(payload) {
  window.location.href = buildSupportMailto(payload);
}
