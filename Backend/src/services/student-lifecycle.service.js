const { ApiError } = require("../utils/http");
const { REPORTABLE_SUBMISSION_STATUSES } = require("./report-scope.service");

const DEFAULT_DEGREE_YEARS = 4;
const STUDENT_LIFECYCLE_STATUS = {
  ACTIVE: "ACTIVE",
  ALUMNI: "ALUMNI",
  SUSPENDED: "SUSPENDED",
  DROPPED: "DROPPED",
};
const LEGACY_LIFECYCLE_STATUS = {
  GRADUATED: "GRADUATED",
  BLOCKED: "BLOCKED",
};
const TERMINAL_STUDENT_STATUSES = [
  STUDENT_LIFECYCLE_STATUS.ALUMNI,
  LEGACY_LIFECYCLE_STATUS.GRADUATED,
  STUDENT_LIFECYCLE_STATUS.DROPPED,
];
const COHORT_STATUS = {
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
};

const normalizeStudentLifecycleStatus = (status) => {
  const normalized = String(status || STUDENT_LIFECYCLE_STATUS.ACTIVE).trim().toUpperCase();
  if (normalized === LEGACY_LIFECYCLE_STATUS.GRADUATED) return STUDENT_LIFECYCLE_STATUS.ALUMNI;
  if (normalized === LEGACY_LIFECYCLE_STATUS.BLOCKED) return STUDENT_LIFECYCLE_STATUS.SUSPENDED;
  if (Object.values(STUDENT_LIFECYCLE_STATUS).includes(normalized)) return normalized;
  return STUDENT_LIFECYCLE_STATUS.ACTIVE;
};

const isAlumniStatus = (status) =>
  [STUDENT_LIFECYCLE_STATUS.ALUMNI, LEGACY_LIFECYCLE_STATUS.GRADUATED].includes(String(status || "").trim().toUpperCase());

const canStudentAuthenticate = (student = {}) => {
  const lifecycleStatus = normalizeStudentLifecycleStatus(student.lifecycleStatus);
  return lifecycleStatus === STUDENT_LIFECYCLE_STATUS.ACTIVE && student.isActive !== false;
};

const isCurrentStudent = (student = {}) =>
  normalizeStudentLifecycleStatus(student.lifecycleStatus) === STUDENT_LIFECYCLE_STATUS.ACTIVE && student.isActive !== false;

const normalizePassoutYear = (value) => {
  if (value == null || value === "") return new Date().getFullYear();
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ApiError(422, "passoutYear must be a valid year between 2000 and 2100", null, "INVALID_PASSOUT_YEAR");
  }
  return year;
};

const buildAcademicLabel = (passoutYear, label) => {
  const normalized = String(label || "").trim();
  if (normalized) return normalized;
  return `${passoutYear - DEFAULT_DEGREE_YEARS}-${passoutYear}`;
};

const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

const buildStudentPassoutSnapshot = (student = {}) => ({
  id: student.id,
  fullName: student.fullName || "",
  email: student.email || "",
  studentId: student.studentId || "",
  enrollNumber: student.enrollNumber || "",
  enrollmentNumber: student.enrollmentNumber || "",
  registerNumber: getStudentNumber(student),
  collegeId: student.collegeId || null,
  departmentId: student.departmentId || null,
  departmentName: student.department?.name || "",
  batchId: student.batchId || null,
  batchIds: Array.isArray(student.batchIds) ? student.batchIds : [],
  batchName: student.batch?.name || "",
  yearAtPassout: Number(student.year || 4),
});

const incrementStat = (map, key, label) => {
  const safeKey = key || "unassigned";
  const current = map.get(safeKey) || { id: key || null, name: label || "Unassigned", count: 0 };
  current.count += 1;
  map.set(safeKey, current);
};

const buildCohortStats = (students = []) => {
  const departments = new Map();
  const batches = new Map();

  students.forEach((student) => {
    incrementStat(departments, student.departmentId, student.department?.name);
    incrementStat(batches, student.batchId, student.batch?.name);
  });

  return {
    departmentStats: Array.from(departments.values()),
    batchStats: Array.from(batches.values()),
  };
};

const tagPassoutSubmissions = async ({ db, students, passoutYear, passoutCohortId }) => {
  let updatedSubmissions = 0;

  for (const student of students) {
    const snapshot = buildStudentPassoutSnapshot(student);
    const result = await db.submission.updateMany({
      where: {
        collegeId: student.collegeId,
        userId: student.id,
        status: { in: REPORTABLE_SUBMISSION_STATUSES },
      },
      data: {
        passoutYear,
        passoutCohortId,
        studentSnapshot: snapshot,
      },
    });
    updatedSubmissions += Number(result.count || 0);
  }

  return updatedSubmissions;
};

const promoteStudentsForPassout = async ({
  db,
  collegeId,
  actorId,
  actorType,
  passoutYear: rawPassoutYear,
  academicLabel: rawAcademicLabel,
}) => {
  const passoutYear = normalizePassoutYear(rawPassoutYear);
  const academicLabel = buildAcademicLabel(passoutYear, rawAcademicLabel);
  const now = new Date();

  const existingCohort = await db.studentPassoutCohort.findFirst({
    where: {
      collegeId,
      passoutYear,
      status: { in: [COHORT_STATUS.PROCESSING, COHORT_STATUS.COMPLETED] },
    },
    select: { id: true, status: true, passoutYear: true },
  });

  if (existingCohort) {
    throw new ApiError(
      409,
      `Passout promotion for ${passoutYear} has already been ${String(existingCohort.status || "created").toLowerCase()}`,
      { cohortId: existingCohort.id, passoutYear },
      "PASSOUT_COHORT_ALREADY_EXISTS"
    );
  }

  const prior4Students = await db.student.findMany({
    where: {
      collegeId,
      year: 4,
      lifecycleStatus: { not: { in: TERMINAL_STUDENT_STATUSES } },
    },
    include: {
      department: { select: { id: true, name: true } },
      batch: { select: { id: true, name: true } },
    },
  });

  const prior4Ids = prior4Students.map((student) => student.id);
  const { departmentStats, batchStats } = buildCohortStats(prior4Students);

  const cohort = await db.studentPassoutCohort.create({
    data: {
      collegeId,
      passoutYear,
      academicLabel,
      status: COHORT_STATUS.PROCESSING,
      promotedAt: now,
      promotedByType: actorType,
      promotedById: actorId,
      totalStudents: prior4Ids.length,
      studentIds: prior4Ids,
      departmentStats,
      batchStats,
    },
  });

  try {
    const step3 = await db.student.updateMany({
      where: { collegeId, year: 3, lifecycleStatus: { not: { in: TERMINAL_STUDENT_STATUSES } } },
      data: { year: 4 },
    });
    const step2 = await db.student.updateMany({
      where: { collegeId, year: 2, lifecycleStatus: { not: { in: TERMINAL_STUDENT_STATUSES } } },
      data: { year: 3 },
    });
    const step1 = await db.student.updateMany({
      where: { collegeId, year: 1, lifecycleStatus: { not: { in: TERMINAL_STUDENT_STATUSES } } },
      data: { year: 2 },
    });

    let transitionedToAlumni = { count: 0 };
    if (prior4Ids.length > 0) {
      transitionedToAlumni = await db.student.updateMany({
        where: { collegeId, id: { in: prior4Ids } },
        data: {
          isActive: false,
          lifecycleStatus: STUDENT_LIFECYCLE_STATUS.ALUMNI,
          disabledReason: "PASSOUT",
          disabledAt: now,
          passoutYear,
          passoutCohortId: cohort.id,
        },
      });

      for (const student of prior4Students) {
        await db.student.update({
          where: { id: student.id },
          data: {
            passoutSnapshot: buildStudentPassoutSnapshot(student),
          },
        });
      }
    }

    const updatedSubmissions = await tagPassoutSubmissions({
      db,
      students: prior4Students,
      passoutYear,
      passoutCohortId: cohort.id,
    });

    const completed = await db.studentPassoutCohort.update({
      where: { id: cohort.id },
      data: {
        status: COHORT_STATUS.COMPLETED,
        completedAt: new Date(),
        updatedSubmissions,
      },
    });

    const summary = {
      year1To2: resultCount(step1),
      year2To3: resultCount(step2),
      year3To4: resultCount(step3),
      alumniPrior4: resultCount(transitionedToAlumni),
      deactivatedPrior4: resultCount(transitionedToAlumni),
      passoutYear,
      passoutCohortId: cohort.id,
      passoutStudents: prior4Ids.length,
      updatedSubmissions,
    };

    return {
      cohort: completed || cohort,
      prior4Ids,
      summary,
    };
  } catch (error) {
    await db.studentPassoutCohort.update({
      where: { id: cohort.id },
      data: {
        status: COHORT_STATUS.FAILED,
        failedAt: new Date(),
        errorMessage: error?.message || "Promotion failed",
      },
    });
    throw error;
  }
};

const resultCount = (value) => Number(value?.count || 0);

module.exports = {
  COHORT_STATUS,
  STUDENT_LIFECYCLE_STATUS,
  LEGACY_LIFECYCLE_STATUS,
  normalizePassoutYear,
  normalizeStudentLifecycleStatus,
  canStudentAuthenticate,
  isAlumniStatus,
  isCurrentStudent,
  buildAcademicLabel,
  buildStudentPassoutSnapshot,
  promoteStudentsForPassout,
  tagPassoutSubmissions,
};
