const models = require("../models");

const createAuditLog = async ({
  action,
  targetType,
  targetId,
  collegeId = null,
  adminId = null,
  superAdminId = null,
  testId = null,
  beforeState = null,
  afterState = null,
}) => {
  const m = await models.init();
  const AuditLog = m.dbClient.auditLog;
  
  return AuditLog.create({
    data: {
      action,
      targetType,
      targetId,
      collegeId,
      adminId,
      superAdminId,
      testId,
      beforeState,
      afterState,
    },
  });
};

module.exports = {
  createAuditLog,
};
