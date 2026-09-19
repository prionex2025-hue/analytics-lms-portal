const { buildAdminTestVisibilityWhere } = require("../../utils/admin-test-access");

// Flatten a where-clause into the list of leaf conditions, whether the helper
// returned a single object or an { AND: [...] } wrapper.
const parts = (where) => (Array.isArray(where?.AND) ? where.AND : [where]);
const hasCondition = (where, predicate) => parts(where).some(predicate);

describe("buildAdminTestVisibilityWhere", () => {
  it("resolves a specific test + batch (no department) WITHOUT gating the test by batch assignment", () => {
    // Regression: an "everyone"/"department_wise" test is not assigned to any
    // specific batch, so gating the pinned test by batchId produced an empty
    // report for a valid batch + test selection. The batch scopes students, not
    // the pinned test.
    const where = buildAdminTestVisibilityWhere({
      collegeId: "c1",
      departmentId: null,
      batchId: "b1",
      batchIds: ["b1"],
      testId: "t1",
    });

    expect(hasCondition(where, (p) => p.collegeId === "c1")).toBe(true);
    expect(hasCondition(where, (p) => p.id === "t1")).toBe(true);
    // No batch-assignment OR gate on the pinned test.
    expect(hasCondition(where, (p) => Array.isArray(p.OR))).toBe(false);
  });

  it("still batch-gates the tests LIST (no specific test pinned)", () => {
    const where = buildAdminTestVisibilityWhere({
      collegeId: "c1",
      departmentId: null,
      batchId: "b1",
      batchIds: ["b1"],
      testId: null,
    });

    // The list is restricted to that batch's tests via a batch-assignment OR.
    expect(hasCondition(where, (p) => Array.isArray(p.OR))).toBe(true);
  });

  it("keeps the department authorization filter (incl. everyone) for a test + batch + department", () => {
    const where = buildAdminTestVisibilityWhere({
      collegeId: "c1",
      departmentId: "d1",
      batchId: "b1",
      batchIds: ["b1"],
      testId: "t1",
    });

    expect(hasCondition(where, (p) => p.id === "t1")).toBe(true);
    const assignment = parts(where).find((p) => Array.isArray(p.OR));
    expect(assignment).toBeDefined();
    // An "everyone"-assigned test the batch's students took is still visible.
    expect(assignment.OR.some((clause) => clause.assignmentMethod === "everyone")).toBe(true);
  });
});
