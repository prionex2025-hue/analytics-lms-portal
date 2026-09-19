const ADMIN_PERMISSIONS = [
  "view_tests",
  "view_batches",
  "view_students",
  "view_events",
  "view_question_bank",
  "view_resources",
  "create_test",
  "edit_test",
  "delete_test",
  "publish_test",
  "manage_questions",
  "manage_resources",
  "manage_batches",
  "manage_events",
  "view_reports",
  "export_reports",
  "manage_students",
  "bulk_import",
];

const COLLEGE_ADMIN_PERMISSIONS = [
  ...ADMIN_PERMISSIONS,
  "manage_admins",
  "manage_departments",
  "view_analytics",
  "manage_college_settings",
];

module.exports = {
  ADMIN_PERMISSIONS,
  COLLEGE_ADMIN_PERMISSIONS,
};
