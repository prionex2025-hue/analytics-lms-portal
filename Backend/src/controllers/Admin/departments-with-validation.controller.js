/**
 * Admin Departments Controller with Validation Integration
 * 
 * Integrates department.service for department operations with validation.
 */

const models = require("../../models");
const { ApiError, asyncHandler } = require("../../utils/http");
const {
  createDepartment,
  updateDepartment,
  assignDepartmentHead,
  removeDepartmentHead,
  toggleDepartmentStatus,
} = require("../../services/department.service");
const { getMetricsSnapshot } = require("../../services/validation-monitoring.service");

/**
 * Get all departments
 */
const getDepartments = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;

  const departments = await db.department.findMany({
    where: { collegeId },
    include: {
      head: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      _count: {
        select: {
          batches: true,
          students: true,
          tests: true,
        },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  res.status(200).json(departments);
});

/**
 * Get department detail
 */
const getDepartmentDetail = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { departmentId } = req.params;

  const department = await db.department.findFirst({
    where: { id: departmentId, collegeId },
    include: {
      head: {
        select: {
          id: true,
          fullName: true,
          email: true,
          employeeId: true,
        },
      },
      batches: {
        include: {
          _count: { select: { students: true } },
        },
      },
      students: {
        select: {
          id: true,
          fullName: true,
          email: true,
          batchId: true,
        },
        take: 20,
      },
      _count: {
        select: {
          batches: true,
          students: true,
          tests: true,
        },
      },
    },
  });

  if (!department) {
    throw new ApiError(404, "Department not found");
  }

  res.status(200).json(department);
});

/**
 * Create department with validation
 */
const createDepartmentHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const superAdminId = req.user.id;

  try {
    const department = await createDepartment(
      {
        name: req.body.name,
        code: req.body.code,
      },
      collegeId,
      superAdminId
    );

    res.status(201).json({
      success: true,
      department,
      message: "Department created successfully",
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
 * Update department with validation
 */
const updateDepartmentHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const superAdminId = req.user.id;
  const { departmentId } = req.params;

  try {
    const department = await updateDepartment(
      departmentId,
      req.body,
      collegeId,
      superAdminId
    );

    res.status(200).json({
      success: true,
      department,
      message: "Department updated successfully",
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
 * Assign department head with validation
 */
const assignDepartmentHeadHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const superAdminId = req.user.id;
  const { departmentId } = req.params;
  const { adminId } = req.body;

  if (!adminId) {
    throw new ApiError(400, "Admin ID is required");
  }

  try {
    const department = await assignDepartmentHead(
      departmentId,
      adminId,
      collegeId,
      superAdminId
    );

    res.status(200).json({
      success: true,
      department: {
        id: department.id,
        name: department.name,
        head: department.head,
      },
      message: "Department head assigned successfully",
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
 * Remove department head
 */
const removeDepartmentHeadHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const superAdminId = req.user.id;
  const { departmentId } = req.params;

  try {
    const department = await removeDepartmentHead(
      departmentId,
      collegeId,
      superAdminId
    );

    res.status(200).json({
      success: true,
      department: {
        id: department.id,
        name: department.name,
        head: null,
      },
      message: "Department head removed successfully",
    });
  } catch (error) {
    throw error;
  }
});

/**
 * Toggle department status
 */
const toggleDepartmentStatusHandler = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const superAdminId = req.user.id;
  const { departmentId } = req.params;
  const { isActive } = req.body;

  try {
    const department = await toggleDepartmentStatus(
      departmentId,
      collegeId,
      superAdminId,
      isActive
    );

    res.status(200).json({
      success: true,
      department: {
        id: department.id,
        name: department.name,
        isActive: department.isActive,
      },
      message: `Department ${isActive ? "activated" : "deactivated"} successfully`,
    });
  } catch (error) {
    throw error;
  }
});

/**
 * Get department validation metrics
 */
const getDepartmentMetrics = asyncHandler(async (req, res) => {
  const metrics = await getMetricsSnapshot();
  const deptMetrics = metrics.failures?.DepartmentValidation || {};

  res.status(200).json({
    total_validations: metrics.summary.total,
    successful: metrics.summary.passed,
    failed: metrics.summary.failed,
    success_rate: metrics.summary.successRate,
    department_failures: {
      count: deptMetrics.count || 0,
      recent_errors: (deptMetrics.errors || []).slice(0, 5),
    },
    latency_ms: metrics.latency?.DepartmentValidation || {},
  });
});

module.exports = {
  getDepartments,
  getDepartmentDetail,
  createDepartmentHandler,
  updateDepartmentHandler,
  assignDepartmentHeadHandler,
  removeDepartmentHeadHandler,
  toggleDepartmentStatusHandler,
  getDepartmentMetrics,
};
