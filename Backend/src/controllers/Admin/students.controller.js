const { asyncHandler, ApiError } = require("../../utils/http");
const models = require("../../models");
const studentService = require("../../services/admin-student.service");
const { createAuditLog } = require("../../services/audit.service");
const { getScopedDepartmentId, assertDepartmentScope } = require("../../utils/admin-scope");
const { invalidateRefreshTokenRecord } = require("../../services/refresh-token-cache.service");
const { bumpPrincipalTokenVersion } = require("../../services/auth-revocation.service");
const { promoteStudentsForPassout } = require("../../services/student-lifecycle.service");

const revokeStudentRefreshTokens = async (db, studentId) => {
  await bumpPrincipalTokenVersion(db, "student", studentId);

  const activeTokens = await db.studentRefreshToken.findMany({
    where: { userId: studentId, revokedAt: null },
  });

  await db.studentRefreshToken.updateMany({
    where: { userId: studentId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await Promise.all(activeTokens.map((record) => invalidateRefreshTokenRecord("student", record)));
};

const getStudents = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const scopedDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  if (scopedDepartmentId && req.query.departmentId && String(req.query.departmentId) !== String(scopedDepartmentId)) {
    throw new ApiError(403, "Cross-department access denied", null, "CROSS_DEPARTMENT_ACCESS_DENIED");
  }

  const opts = {
    page: req.query.page,
    limit: req.query.limit,
    departmentId: scopedDepartmentId || req.query.departmentId,
    batchId: req.query.batchId,
    search: req.query.search,
    year: req.query.year,
    studentScope: req.query.studentScope,
    passoutYear: req.query.passoutYear,
    passoutCohortId: req.query.passoutCohortId,
  };
  const { data, total, page, limit } = await studentService.listStudents(collegeId, opts);
  res.status(200).json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

const createStudent = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const scopedDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const payload = req.body;
  const m = await models.init();
  const db = m.dbClient;
  const departmentWhere = {
    collegeId,
    ...(scopedDepartmentId ? { id: scopedDepartmentId } : {}),
    ...(payload.department
      ? { name: { equals: payload.department, mode: "insensitive" } }
      : {}),
  };
  const department = await db.department.findFirst({ where: departmentWhere, select: { id: true, name: true } });

  if (!department) {
    throw new ApiError(403, "Department is outside your scope", null, "CROSS_DEPARTMENT_ACCESS_DENIED");
  }

  payload.department = payload.department || department.name;
  const result = await studentService.createStudent(collegeId, adminId, payload);
  res.status(201).json({ student: result.student, credentials: result.credentials });
});

const getStudentPerformance = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const studentId = req.params.studentId;
  const scopedDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const student = await studentService.getStudentPerformance(collegeId, studentId);
  if (!student) {
    throw new ApiError(404, "Student not found");
  }
  if (scopedDepartmentId) {
    assertDepartmentScope(req, student?.departmentId);
  }
  res.status(200).json(student);
});

const getStudentProfile = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const studentId = req.params.studentId;
  const scopedDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const student = await studentService.getStudentProfile(collegeId, studentId);
  if (scopedDepartmentId) {
    assertDepartmentScope(req, student?.departmentId);
  }
  res.status(200).json(student);
});

const assignStudentToBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const scopedDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const { studentId } = req.params;
  const { batchId } = req.body;
  const m = await models.init();
  const db = m.dbClient;
  const [student, batch] = await Promise.all([
    db.student.findFirst({ where: { id: studentId, collegeId }, select: { id: true, departmentId: true } }),
    db.batch.findFirst({ where: { id: batchId, collegeId }, select: { id: true, departmentId: true } }),
  ]);

  if (!student || !batch) {
    throw new ApiError(404, "Student or batch not found");
  }

  if (scopedDepartmentId) {
    assertDepartmentScope(req, student.departmentId, "Student is outside the admin department scope");
    assertDepartmentScope(req, batch.departmentId, "Batch is outside the admin department scope");
  }

  const updated = await studentService.assignStudentToBatch(collegeId, adminId, studentId, batchId);
  res.status(200).json(updated);
});

const bulkImportStudents = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const adminDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const { csvData } = req.body;
  const result = await studentService.bulkImportStudents(collegeId, adminId, csvData, adminDepartmentId);
  res.status(202).json({ jobId: result.jobId, status: result.status, message: "Bulk import queued" });
});

const promoteStudentsYear = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const expectedConfirmation = "PROMOTE STUDENTS YEAR";

  if (String(req.body.confirmationText || "").trim() !== expectedConfirmation) {
    throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
  }

  const m = await models.init();
  const db = m.dbClient;

  const result = await promoteStudentsForPassout({
    db,
    collegeId,
    actorId: adminId,
    actorType: "ADMIN",
    passoutYear: req.body.passoutYear,
    academicLabel: req.body.academicLabel,
  });

  if (result.prior4Ids?.length) {
    await Promise.all(result.prior4Ids.map((studentId) => revokeStudentRefreshTokens(db, studentId)));
  }

  const summary = result.summary;

  await createAuditLog({
    action: "ADMIN_STUDENT_YEAR_PROMOTED",
    targetType: "COLLEGE",
    targetId: collegeId,
    collegeId,
    adminId,
    afterState: summary,
  });

  res.status(200).json({
    message: "Student years updated successfully",
    summary,
    cohort: result.cohort,
  });
});

const getStudentImportJob = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { jobId } = req.params;
  const job = await studentService.getStudentImportJob(collegeId, jobId);
  res.status(200).json(job);
});

module.exports = {
  getStudents,
  createStudent,
  getStudentPerformance,
  getStudentProfile,
  assignStudentToBatch,
  bulkImportStudents,
  promoteStudentsYear,
  getStudentImportJob,
};
