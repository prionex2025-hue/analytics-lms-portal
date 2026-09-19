const {
  createSuperAdmin,
  listSuperAdmins,
  resetSuperAdminPassword,
  setSuperAdminActive,
  toPublicSuperAdmin,
} = require("../../services/super-admin.service");
const { asyncHandler } = require("../../utils/http");

const getSystemAdmins = asyncHandler(async (req, res) => {
  const result = await listSuperAdmins({
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    status: req.query.status,
  });

  res.status(200).json(result);
});

const createSystemAdmin = asyncHandler(async (req, res) => {
  const superAdmin = await createSuperAdmin({
    name: req.body.name,
    fullName: req.body.fullName,
    email: req.body.email,
    password: req.body.password,
    actorSuperAdminId: req.superAdmin.id,
    bootstrapCreated: false,
  });

  res.status(201).json(toPublicSuperAdmin(superAdmin));
});

const updateSystemAdminStatus = asyncHandler(async (req, res) => {
  const superAdmin = await setSuperAdminActive({
    superAdminId: req.params.superAdminId,
    isActive: req.body.isActive,
    actorSuperAdminId: req.superAdmin.id,
  });

  res.status(200).json(toPublicSuperAdmin(superAdmin));
});

const resetSystemAdminPassword = asyncHandler(async (req, res) => {
  const superAdmin = await resetSuperAdminPassword({
    superAdminId: req.params.superAdminId,
    password: req.body.password,
    actorSuperAdminId: req.superAdmin.id,
  });

  res.status(200).json({
    message: "SuperAdmin password reset",
    superAdmin: toPublicSuperAdmin(superAdmin),
  });
});

module.exports = {
  createSystemAdmin,
  getSystemAdmins,
  resetSystemAdminPassword,
  updateSystemAdminStatus,
};
