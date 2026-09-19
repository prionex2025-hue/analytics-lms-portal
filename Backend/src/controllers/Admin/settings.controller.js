const bcrypt = require("bcrypt");
const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { invalidateRefreshTokenRecord } = require("../../services/refresh-token-cache.service");
const { bumpPrincipalTokenVersion } = require("../../services/auth-revocation.service");
const {
  SYSTEM_DEFAULT_TEST_SETTINGS,
  normalizeTestType,
  normalizeProctoringPreset,
} = require("../../services/test-config.service");
const { asyncHandler, ApiError } = require("../../utils/http");

const settingsKey = (collegeId) => `college.${collegeId}.admin.defaults`;

const revokeAdminRefreshTokens = async (db, adminId) => {
  await bumpPrincipalTokenVersion(db, "admin", adminId);

  const activeTokens = await db.adminRefreshToken.findMany({
    where: { adminId, revokedAt: null },
  });

  await db.adminRefreshToken.updateMany({
    where: { adminId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await Promise.all(activeTokens.map((record) => invalidateRefreshTokenRecord("admin", record)));
};

const defaultSettings = {
  defaultTestConfig: {
    durationMins: SYSTEM_DEFAULT_TEST_SETTINGS.durationMins,
    attemptsAllowed: SYSTEM_DEFAULT_TEST_SETTINGS.attemptsAllowed,
    violationThreshold: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.violationThreshold,
    evaluationRule: SYSTEM_DEFAULT_TEST_SETTINGS.evaluationRule,
    testType: SYSTEM_DEFAULT_TEST_SETTINGS.testType,
    proctoringPreset: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringPreset,
  },
  collegeSettings: {
    allowBatchArchive: true,
    registrationPolicy: "OPEN",
    reportRetentionDays: 365,
  },
};

const mergeWithDefaultSettings = (value = {}) => ({
  defaultTestConfig: {
    ...defaultSettings.defaultTestConfig,
    ...(value?.defaultTestConfig || {}),
    testType: normalizeTestType(
      value?.defaultTestConfig?.testType,
      defaultSettings.defaultTestConfig.testType
    ),
    proctoringPreset: normalizeProctoringPreset(
      value?.defaultTestConfig?.proctoringPreset,
      defaultSettings.defaultTestConfig.proctoringPreset
    ),
  },
  collegeSettings: {
    ...defaultSettings.collegeSettings,
    ...(value?.collegeSettings || {}),
  },
});

const getAdminSettings = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const key = settingsKey(req.collegeId);

  const [profile, collegeSettings] = await Promise.all([
    db.admin.findFirst({
      where: {
        id: req.admin.id,
        collegeId: req.collegeId,
      },
      include: {
        college: true,
        department: true,
      },
    }),
    db.platformSetting.findUnique({ where: { key } }),
  ]);

  if (!profile) {
    throw new ApiError(404, "Admin profile not found");
  }

  res.status(200).json({
    profile: {
      id: profile.id,
      fullName: profile.fullName,
      email: profile.email,
      employeeId: profile.employeeId,
      role: profile.role,
      college: profile.college,
      department: profile.department,
    },
    settings: mergeWithDefaultSettings(collegeSettings?.value || {}),
  });
});

const updateAdminSettings = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const key = settingsKey(req.collegeId);
  const existing = await db.platformSetting.findUnique({ where: { key } });

  const nextValue = mergeWithDefaultSettings({
    ...existing?.value,
    defaultTestConfig: {
      ...(existing?.value?.defaultTestConfig || {}),
      ...(req.body.defaultTestConfig || {}),
    },
    collegeSettings: {
      ...(existing?.value?.collegeSettings || {}),
      ...(req.body.collegeSettings || {}),
    },
  });

  const updated = await db.platformSetting.upsert({
    where: { key },
    update: {
      value: nextValue,
      updatedById: req.admin.id,
    },
    create: {
      key,
      value: nextValue,
      updatedById: req.admin.id,
    },
  });

  await createAuditLog({
    action: "ADMIN_SETTINGS_UPDATED",
    targetType: "COLLEGE_SETTING",
    targetId: updated.id,
    collegeId: req.collegeId,
    adminId: req.admin.id,
    beforeState: existing?.value || null,
    afterState: updated.value,
  });

  res.status(200).json({
    key: updated.key,
    value: updated.value,
  });
});

const changeAdminPassword = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { currentPassword, newPassword } = req.body;

  const admin = await db.admin.findFirst({
    where: {
      id: req.admin.id,
      collegeId: req.collegeId,
    },
  });

  if (!admin) {
    throw new ApiError(404, "Admin not found");
  }

  const matches = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!matches) {
    throw new ApiError(400, "Current password is incorrect");
  }

  const nextHash = await bcrypt.hash(newPassword, 10);
  await db.admin.update({
    where: { id: admin.id },
    data: { passwordHash: nextHash },
  });
  await revokeAdminRefreshTokens(db, admin.id);

  await createAuditLog({
    action: "ADMIN_PASSWORD_CHANGED",
    targetType: "ADMIN",
    targetId: admin.id,
    collegeId: req.collegeId,
    adminId: req.admin.id,
  });

  res.status(200).json({ message: "Password updated" });
});

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  changeAdminPassword,
};
