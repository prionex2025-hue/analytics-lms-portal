const { ApiError } = require("./http");
const { ROLES, normalizeRole } = require("../constants/roles");
const {
  getScopedDepartmentId,
  isCollegeAdminRequest,
} = require("./admin-scope");

const ASSIGNMENT_METHOD = {
  EVERYONE: "everyone",
  DEPARTMENT_WISE: "department_wise",
  BATCH_WISE: "batch_wise",
};

const normalizeId = (value) => String(value || "").trim();

const normalizeIdList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => normalizeId(value)).filter(Boolean))];

const hasKeys = (value) => value && typeof value === "object" && Object.keys(value).length > 0;

const andWhere = (parts = []) => {
  const present = parts.filter(hasKeys);
  if (present.length === 0) return {};
  if (present.length === 1) return present[0];
  return { AND: present };
};

const getDepartmentBatchIds = async ({ db, collegeId, departmentId }) => {
  if (!departmentId) return [];

  const batches = await db.batch.findMany({
    where: { collegeId, departmentId },
    select: { id: true },
  });

  return normalizeIdList(batches.map((batch) => batch.id));
};

const buildBatchAssignmentFilter = (batchIds = []) => {
  const normalizedBatchIds = normalizeIdList(batchIds);
  if (normalizedBatchIds.length === 0) return {};

  return {
    OR: [
      { batchId: { in: normalizedBatchIds } },
      { batchAssignments: { some: { batchId: { in: normalizedBatchIds } } } },
    ],
  };
};

const buildDepartmentAssignmentFilter = ({ departmentId, batchIds = [] }) => {
  const scopedDepartmentId = normalizeId(departmentId);
  const scopedBatchIds = normalizeIdList(batchIds);
  const conditions = [
    { assignmentMethod: ASSIGNMENT_METHOD.EVERYONE },
  ];

  if (scopedDepartmentId) {
    conditions.push(
      { assignmentMethod: ASSIGNMENT_METHOD.DEPARTMENT_WISE, departmentId: scopedDepartmentId },
      { assignmentMethod: ASSIGNMENT_METHOD.DEPARTMENT_WISE, assignedTo: { in: [scopedDepartmentId] } },
      { assignmentMethod: null, departmentId: scopedDepartmentId },
      { assignmentMethod: null, assignedTo: { in: [scopedDepartmentId] } }
    );
  }

  if (scopedBatchIds.length > 0) {
    conditions.push(
      { assignmentMethod: ASSIGNMENT_METHOD.BATCH_WISE, batchId: { in: scopedBatchIds } },
      { assignmentMethod: ASSIGNMENT_METHOD.BATCH_WISE, batchAssignments: { some: { batchId: { in: scopedBatchIds } } } },
      { assignmentMethod: ASSIGNMENT_METHOD.DEPARTMENT_WISE, departmentId: null, batchId: { in: scopedBatchIds } },
      { assignmentMethod: ASSIGNMENT_METHOD.DEPARTMENT_WISE, departmentId: null, batchAssignments: { some: { batchId: { in: scopedBatchIds } } } },
      { assignmentMethod: null, batchId: { in: scopedBatchIds } },
      { assignmentMethod: null, batchAssignments: { some: { batchId: { in: scopedBatchIds } } } }
    );
  }

  return { OR: conditions };
};

const resolveAdminTestScope = async ({ db, req, filters = {} }) => {
  const collegeId = req.collegeId;
  const adminDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const requestedDepartmentId = filters.departmentId ? normalizeId(filters.departmentId) : null;
  const requestedBatchId = filters.batchId ? normalizeId(filters.batchId) : null;

  if (adminDepartmentId && requestedDepartmentId && normalizeId(adminDepartmentId) !== requestedDepartmentId) {
    throw new ApiError(403, "Cross-department test access denied", null, "CROSS_DEPARTMENT_ACCESS_DENIED");
  }

  const departmentId = adminDepartmentId ? normalizeId(adminDepartmentId) : (requestedDepartmentId || null);
  let batchIds = [];

  if (requestedDepartmentId && !adminDepartmentId) {
    const department = await db.department.findFirst({
      where: { id: requestedDepartmentId, collegeId },
      select: { id: true },
    });

    if (!department) {
      throw new ApiError(404, "Department not found for this college", null, "DEPARTMENT_NOT_FOUND");
    }
  }

  if (departmentId) {
    batchIds = await getDepartmentBatchIds({ db, collegeId, departmentId });

    if (requestedBatchId && !batchIds.includes(requestedBatchId)) {
      throw new ApiError(403, "Batch is outside the admin department scope", null, "CROSS_DEPARTMENT_ACCESS_DENIED");
    }
  } else if (requestedBatchId) {
    const batch = await db.batch.findFirst({
      where: { id: requestedBatchId, collegeId },
      select: { id: true },
    });

    if (!batch) {
      throw new ApiError(404, "Batch not found for this college", null, "BATCH_NOT_FOUND");
    }
  }

  return {
    collegeId,
    departmentId,
    batchId: requestedBatchId,
    batchIds: requestedBatchId ? [requestedBatchId] : batchIds,
  };
};

const buildAdminTestVisibilityWhere = ({ collegeId, departmentId = null, batchId = null, batchIds = [], testId = null } = {}) => {
  const scopeParts = [{ collegeId }];
  if (testId) {
    scopeParts.push({ id: testId });
  }

  if (departmentId) {
    scopeParts.push(buildDepartmentAssignmentFilter({ departmentId, batchIds }));
  } else if (batchId && !testId) {
    // A batch on its own filters the tests LIST to that batch's tests. But a
    // specific test pinned by id is already uniquely identified — the batch is
    // only a student-scoping filter for that test's report, never an
    // authorization boundary. Gating the pinned test by batch assignment here
    // wrongly excludes "everyone"/"department_wise" tests the batch's students
    // actually took, yielding an empty report for a valid batch + test selection.
    // (When a department is present its filter still applies for authorization.)
    scopeParts.push(buildBatchAssignmentFilter([batchId]));
  }

  return andWhere(scopeParts);
};

const buildAdminTestVisibilityWhereForRequest = async ({ db, req, filters = {} }) => {
  const scope = await resolveAdminTestScope({ db, req, filters });
  return {
    scope,
    where: buildAdminTestVisibilityWhere({
      collegeId: scope.collegeId,
      departmentId: scope.departmentId,
      batchId: scope.batchId,
      batchIds: scope.batchIds,
      testId: filters.testId || null,
    }),
  };
};

const assertAdminCanViewTest = async ({ db, req, test, message = "Test is not accessible for this department" }) => {
  if (!test?.id) {
    throw new ApiError(404, "Test not found");
  }

  const scopedDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  if (!scopedDepartmentId) {
    return;
  }

  const { where } = await buildAdminTestVisibilityWhereForRequest({
    db,
    req,
    filters: { testId: test.id, departmentId: scopedDepartmentId },
  });

  const visible = await db.test.findFirst({ where, select: { id: true } });
  if (!visible) {
    throw new ApiError(403, message, null, "CROSS_DEPARTMENT_ACCESS_DENIED");
  }
};

const getTestManagerRole = (test = {}) => {
  if (test?.isGlobal) {
    return ROLES.SUPER_ADMIN;
  }

  const creatorRole = normalizeRole(test?.createdByAdmin?.role || test?.managerRole || "");
  if (creatorRole === ROLES.COLLEGE_ADMIN) {
    return ROLES.COLLEGE_ADMIN;
  }

  return ROLES.ADMIN;
};

const getTestManagerLabel = (test = {}) => getTestManagerRole(test);

const canAdminControlTest = (req, test = {}) => {
  const managerRole = getTestManagerRole(test);
  if (managerRole === ROLES.SUPER_ADMIN) {
    return false;
  }

  if (!isCollegeAdminRequest(req) && managerRole === ROLES.COLLEGE_ADMIN) {
    return false;
  }

  return true;
};

const decorateAdminTestAccess = (req, test = {}) => {
  const canControl = canAdminControlTest(req, test);
  const managedBy = getTestManagerLabel(test);

  return {
    canAdminOperate: canControl,
    canAdminControl: canControl,
    canViewReports: true,
    canLiveMonitor: true,
    managedBy,
    accessLevel: canControl ? "CONTROL" : "VIEW_ONLY",
  };
};

const assertAdminCanControlTest = (req, test = {}) => {
  if (canAdminControlTest(req, test)) {
    return;
  }

  const managedBy = getTestManagerLabel(test);
  const message = managedBy === ROLES.SUPER_ADMIN
    ? "This test is managed by super admin and is read-only for admins"
    : "This test is managed by college admin and is read-only for department admins";

  throw new ApiError(
    403,
    message,
    { testId: test.id, scope: managedBy },
    `${managedBy}_TEST_READ_ONLY`
  );
};

module.exports = {
  buildAdminTestVisibilityWhere,
  buildAdminTestVisibilityWhereForRequest,
  resolveAdminTestScope,
  assertAdminCanViewTest,
  assertAdminCanControlTest,
  canAdminControlTest,
  decorateAdminTestAccess,
  getDepartmentBatchIds,
  getTestManagerLabel,
};
