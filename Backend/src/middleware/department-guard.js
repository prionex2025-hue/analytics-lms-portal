const { asyncHandler, ApiError } = require("../utils/http");
const { createAuditLog } = require("../services/audit.service");

// Ensure body/params/query departmentId (if provided) matches the authenticated user's department
const requireSameDepartment = (fieldName = "departmentId") =>
  asyncHandler(async (req, _res, next) => {
    const bodyDept = req.body?.[fieldName];
    const paramsDept = req.params?.[fieldName];
    const queryDept = req.query?.[fieldName];
    const candidate = bodyDept || paramsDept || queryDept;

    // super admin can operate across departments
    if (req.superAdmin) return next();

    const userDept = req.admin?.departmentId || req.user?.departmentId || null;

    if (candidate && userDept && String(candidate) !== String(userDept)) {
      await createAuditLog({
        action: "CROSS_DEPT_ATTEMPT",
        targetType: "DEPARTMENT_VALIDATION",
        targetId: candidate,
        collegeId: req.collegeId || null,
        adminId: req.admin?.id || null,
        beforeState: { attemptedBy: req.admin?.id || req.user?.id || null, userDept, candidate },
      });
      throw new ApiError(403, "Cross-department access denied");
    }

    next();
  });

// Generic guard: fetch resource and assert its departmentId matches authenticated user's
const departmentMatch = (resourceFetchFn) =>
  asyncHandler(async (req, res, next) => {
    if (req.superAdmin) return next();

    const paramValues = Object.values(req.params || {}).filter(Boolean);
    const resourceId = req.params?.id || req.body?.id || req.query?.id || paramValues[0];
    if (!resourceId) return next();

    const resource = await resourceFetchFn(resourceId);
    if (!resource) return res.status(404).json({ message: "Not found" });

    const resourceDept = resource.departmentId || null;
    const userDept = req.admin?.departmentId || req.user?.departmentId || null;

    if (userDept && resourceDept && String(userDept) !== String(resourceDept)) {
      await createAuditLog({
        action: "CROSS_DEPT_RESOURCE_ACCESS",
        targetType: resource.constructor?.modelName || "resource",
        targetId: resourceId,
        adminId: req.admin?.id || null,
        collegeId: req.collegeId || null,
        beforeState: { attemptedBy: req.admin?.id || req.user?.id || null, userDept, resourceDept },
      });
      throw new ApiError(403, "Forbidden: cross-department access");
    }

    req.resource = resource;
    next();
  });

module.exports = {
  requireSameDepartment,
  departmentMatch,
};
