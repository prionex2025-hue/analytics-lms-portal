const { ApiError } = require("./http");
const { isDepartmentAdminRequest } = require("./admin-scope");

// The question bank (and its subjects) is shared across a college: every admin
// can browse it and use its questions in tests. Changing or deleting an entry
// is narrower:
//   - college admins may modify any entry in their college;
//   - department admins may modify only entries owned by their department,
//     i.e. created by them or by another admin of the same department.
// Entries created by college/super admins are therefore read-only for
// department admins.
const resolveOwnerDepartmentId = async (db, record) => {
  if (record?.departmentId) {
    return String(record.departmentId);
  }

  if (!record?.createdByAdminId) {
    return null;
  }

  const creator = await db.admin.findUnique({
    where: { id: record.createdByAdminId },
    select: { departmentId: true },
  });

  return creator?.departmentId ? String(creator.departmentId) : null;
};

const assertCanModifySharedQuestionEntry = async (db, req, record, label = "question") => {
  if (!isDepartmentAdminRequest(req)) {
    return;
  }

  if (record?.createdByAdminId && String(record.createdByAdminId) === String(req.admin?.id)) {
    return;
  }

  const adminDepartmentId = req.admin?.departmentId ? String(req.admin.departmentId) : null;
  const ownerDepartmentId = await resolveOwnerDepartmentId(db, record);

  if (!adminDepartmentId || !ownerDepartmentId || ownerDepartmentId !== adminDepartmentId) {
    throw new ApiError(
      403,
      `This ${label} belongs to another department and can only be changed by its department or a college admin`,
      null,
      "CROSS_DEPARTMENT_ACCESS_DENIED"
    );
  }
};

// departmentId stamped on new entries; null for college admins (college-wide).
const getOwningDepartmentId = (req) =>
  isDepartmentAdminRequest(req) ? req.admin?.departmentId || null : null;

module.exports = {
  assertCanModifySharedQuestionEntry,
  getOwningDepartmentId,
};
