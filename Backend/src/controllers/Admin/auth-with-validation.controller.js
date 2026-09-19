/**
 * Admin Auth Controller with Validation Integration
 * 
 * Integrates admin.service for admin creation and permission management.
 */

const bcrypt = require("bcrypt");
const models = require("../../models");
const { createAccessToken } = require("../../utils/token");
const { ApiError, asyncHandler } = require("../../utils/http");
const { resolveAdminPermissions } = require("../../constants/admin-access-profiles");
const { createRefreshTokenRecord } = require("../../services/refresh-token-session.service");
const {
  createAdmin,
  updateAdmin,
  assignPermissions,
  toggleAdminStatus,
} = require("../../services/admin.service");
const { getMetricsSnapshot } = require("../../services/validation-monitoring.service");

/**
 * Admin login (no changes needed, kept for reference)
 */
const adminLogin = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { email, password } = req.body;

  const admin = await db.admin.findFirst({
    where: {
      email,
      isActive: true,
    },
    include: {
      college: true,
      department: true,
    },
  });

  if (!admin) {
    throw new ApiError(401, "Invalid credentials");
  }

  const isMatch = await bcrypt.compare(password, admin.passwordHash);
  if (!isMatch) {
    throw new ApiError(401, "Invalid credentials");
  }

  const permissions = resolveAdminPermissions(admin);
  const accessToken = createAccessToken({ ...admin, permissions });
  await createRefreshTokenRecord({
    db,
    modelName: "adminRefreshToken",
    scope: "admin",
    principal: admin,
    ownerField: "adminId",
  });

  res.status(200).json({
    accessToken,
    admin: {
      id: admin.id,
      employeeId: admin.employeeId,
      fullName: admin.fullName,
      email: admin.email,
      role: admin.role,
      permissions,
      college: admin.college,
      department: admin.department,
    },
  });
});

/**
 * Create admin with validation
 */
const createAdminHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const superAdminId = req.user.id;

  try {
    const admin = await createAdmin(
      {
        fullName: req.body.fullName,
        email: req.body.email,
        password: req.body.password,
        employeeId: req.body.employeeId,
        permissions: req.body.permissions || [],
        accessLevel: req.body.accessLevel || "FULL",
      },
      collegeId,
      superAdminId
    );

    res.status(201).json({
      success: true,
      admin: {
        id: admin.id,
        fullName: admin.fullName,
        email: admin.email,
        employeeId: admin.employeeId,
        permissions: admin.permissions,
      },
      message: "Admin created successfully",
    });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({
        success: false,
        error: error.message,
        details: error.details,
        code: error.errorCode,
      });
    }
    throw error;
  }
});

/**
 * Update admin with validation
 */
const updateAdminHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const superAdminId = req.user.id;
  const { adminId } = req.params;

  try {
    const admin = await updateAdmin(
      adminId,
      req.body,
      collegeId,
      superAdminId
    );

    res.status(200).json({
      success: true,
      admin: {
        id: admin.id,
        fullName: admin.fullName,
        email: admin.email,
        employeeId: admin.employeeId,
        permissions: admin.permissions,
      },
      message: "Admin updated successfully",
    });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({
        success: false,
        error: error.message,
        details: error.details,
        code: error.errorCode,
      });
    }
    throw error;
  }
});

/**
 * Assign permissions to admin
 */
const assignPermissionsHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const superAdminId = req.user.id;
  const { adminId } = req.params;
  const { permissions } = req.body;

  if (!Array.isArray(permissions)) {
    throw new ApiError(400, "Permissions must be an array");
  }

  try {
    const admin = await assignPermissions(
      adminId,
      collegeId,
      permissions,
      superAdminId
    );

    res.status(200).json({
      success: true,
      admin: {
        id: admin.id,
        fullName: admin.fullName,
        email: admin.email,
        permissions: admin.permissions,
      },
      message: "Permissions assigned successfully",
    });
  } catch (error) {
    throw error;
  }
});

/**
 * Toggle admin status
 */
const toggleAdminStatusHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const superAdminId = req.user.id;
  const { adminId } = req.params;
  const { isActive } = req.body;

  try {
    const admin = await toggleAdminStatus(
      adminId,
      collegeId,
      superAdminId,
      isActive
    );

    res.status(200).json({
      success: true,
      admin: {
        id: admin.id,
        fullName: admin.fullName,
        email: admin.email,
        isActive: admin.isActive,
      },
      message: `Admin ${isActive ? "activated" : "deactivated"} successfully`,
    });
  } catch (error) {
    throw error;
  }
});

/**
 * Get admin validation metrics
 */
const getAdminMetrics = asyncHandler(async (req, res) => {
  const metrics = await getMetricsSnapshot();
  const adminMetrics = metrics.failures?.UserValidation || {};

  res.status(200).json({
    total_validations: metrics.summary.total,
    successful: metrics.summary.passed,
    failed: metrics.summary.failed,
    success_rate: metrics.summary.successRate,
    admin_failures: {
      count: adminMetrics.count || 0,
      recent_errors: (adminMetrics.errors || []).slice(0, 5),
    },
    latency_ms: metrics.latency?.UserValidation || {},
  });
});

module.exports = {
  adminLogin,
  createAdminHandler,
  updateAdminHandler,
  assignPermissionsHandler,
  toggleAdminStatusHandler,
  getAdminMetrics,
};
