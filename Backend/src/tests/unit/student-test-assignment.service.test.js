const {
  buildStudentAssignmentScope,
  isStudentAssignedToTest,
} = require("../../services/student-test-assignment.service");

const student = {
  collegeId: "college-1",
  departmentId: "dept-1",
  batchIds: ["batch-1"],
};

describe("student-test-assignment.service", () => {
  it("includes department-wise assignedTo matching in student visibility scope", () => {
    const scope = buildStudentAssignmentScope(student);

    expect(scope.OR).toContainEqual({
      assignmentMethod: "department_wise",
      collegeId: "college-1",
      assignedTo: { in: ["dept-1"] },
    });
  });

  it("allows department-wise assignment by department list", () => {
    expect(isStudentAssignedToTest({
      test: {
        collegeId: "college-1",
        assignmentMethod: "department_wise",
        assignedTo: ["dept-1"],
      },
      student,
    })).toBe(true);
  });

  it("does not allow batch-wise tests by department list alone", () => {
    expect(isStudentAssignedToTest({
      test: {
        collegeId: "college-1",
        assignmentMethod: "batch_wise",
        assignedTo: ["dept-1"],
        batchId: "batch-2",
      },
      student,
      hasBatchAssignment: false,
    })).toBe(false);
  });
});
