const ASSIGNMENT_METHOD = {
  EVERYONE: "everyone",
  DEPARTMENT_WISE: "department_wise",
  BATCH_WISE: "batch_wise",
};
const { isCurrentStudent } = require("./student-lifecycle.service");

const normalizeIds = (values = []) =>
  Array.isArray(values) ? values.filter(Boolean).map((value) => String(value)) : [];
const normalizeYears = (values = []) =>
  Array.isArray(values) ? values.map((value) => Number(value)).filter((value) => Number.isInteger(value)) : [];

const getStudentBatchIds = (student) =>
  [...new Set(normalizeIds([...(student?.batchIds || []), student?.batchId]))];

const buildStudentAssignmentScope = (student) => {
  if (!isCurrentStudent(student)) {
    return { id: "__NO_ACTIVE_STUDENT_TESTS__" };
  }

  const userBatchIds = getStudentBatchIds(student);
  const userDepartmentId = student?.departmentId || null;
  const userYear = Number(student?.year);
  const hasBatches = userBatchIds.length > 0;

  const conditions = [
    {
      assignmentMethod: ASSIGNMENT_METHOD.EVERYONE,
      collegeId: student.collegeId,
    },
    ...(userDepartmentId
      ? [
          {
            assignmentMethod: ASSIGNMENT_METHOD.DEPARTMENT_WISE,
            collegeId: student.collegeId,
            departmentId: userDepartmentId,
          },
          {
            assignmentMethod: ASSIGNMENT_METHOD.DEPARTMENT_WISE,
            collegeId: student.collegeId,
            assignedTo: { in: [userDepartmentId] },
          },
          {
            assignmentMethod: null,
            collegeId: student.collegeId,
            departmentId: userDepartmentId,
          },
          {
            assignmentMethod: null,
            collegeId: student.collegeId,
            assignedTo: { in: [userDepartmentId] },
          },
        ]
      : []),
  ];

  if (hasBatches) {
    conditions.push(
      {
        assignmentMethod: ASSIGNMENT_METHOD.BATCH_WISE,
        collegeId: student.collegeId,
        batchId: { in: userBatchIds },
      },
      {
        assignmentMethod: ASSIGNMENT_METHOD.BATCH_WISE,
        collegeId: student.collegeId,
        batchAssignments: {
          some: {
            batchId: { in: userBatchIds },
          },
        },
      },
      {
        assignmentMethod: null,
        collegeId: student.collegeId,
        batchId: { in: userBatchIds },
      },
      {
        assignmentMethod: null,
        collegeId: student.collegeId,
        batchAssignments: {
          some: {
            batchId: { in: userBatchIds },
          },
        },
      }
    );
  }

  const assignmentScope = { OR: conditions };
  if (!Number.isInteger(userYear)) {
    return assignmentScope;
  }

  return {
    AND: [
      {
        OR: [
          { years: null },
          { years: [] },
          { years: { in: [userYear] } },
        ],
      },
      assignmentScope,
    ],
  };
};

const isStudentAssignedToTest = ({ test, student, hasBatchAssignment = false }) => {
  if (!isCurrentStudent(student)) {
    return false;
  }

  const testCollegeId = String(test?.collegeId || "");
  const studentCollegeId = String(student?.collegeId || "");
  if (!testCollegeId || testCollegeId !== studentCollegeId) {
    return false;
  }

  const assignmentMethod = String(test?.assignmentMethod || "").trim().toLowerCase();
  const studentDepartmentId = String(student?.departmentId || "");
  const testYears = normalizeYears(test?.years);
  if (testYears.length > 0 && !testYears.includes(Number(student?.year))) {
    return false;
  }

  const studentBatchIds = getStudentBatchIds(student);
  const assignedDepartmentIds = normalizeIds(test?.assignedTo);

  if (assignmentMethod === ASSIGNMENT_METHOD.EVERYONE) {
    return true;
  }

  if (assignmentMethod === ASSIGNMENT_METHOD.DEPARTMENT_WISE) {
    return Boolean(
      studentDepartmentId
      && (
        String(test?.departmentId || "") === studentDepartmentId
        || assignedDepartmentIds.includes(studentDepartmentId)
      )
    );
  }

  if (assignmentMethod === ASSIGNMENT_METHOD.BATCH_WISE) {
    return Boolean(
      studentBatchIds.includes(String(test?.batchId || ""))
      || hasBatchAssignment
    );
  }

  return Boolean(
    (studentDepartmentId && String(test?.departmentId || "") === studentDepartmentId)
    || (studentDepartmentId && assignedDepartmentIds.includes(studentDepartmentId))
    || studentBatchIds.includes(String(test?.batchId || ""))
    || hasBatchAssignment
  );
};

module.exports = {
  ASSIGNMENT_METHOD,
  buildStudentAssignmentScope,
  getStudentBatchIds,
  isStudentAssignedToTest,
};
