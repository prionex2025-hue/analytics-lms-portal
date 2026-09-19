const {
  buildDepartmentLookupIndex,
  getInvalidDepartmentReason,
  normalizeImportLookupKey,
  resolveBatchLookup,
  resolveDepartmentLookup,
} = require("../../utils/student-import");

describe("student import lookup utilities", () => {
  it("normalizes department names with spacing, punctuation, and ampersands", () => {
    const departments = [
      { id: "dept-cse", name: "Computer Science & Engineering" },
    ];
    const index = buildDepartmentLookupIndex(departments);

    expect(resolveDepartmentLookup("computer-science and engineering", index)).toEqual(departments[0]);
    expect(resolveDepartmentLookup("Computer\u00a0Science & Engineering", index)).toEqual(departments[0]);
  });

  it("resolves common department abbreviations safely", () => {
    const departments = [
      { id: "dept-cse", name: "Computer Science and Engineering" },
      { id: "dept-it", name: "Information Technology" },
    ];
    const index = buildDepartmentLookupIndex(departments);

    expect(resolveDepartmentLookup("CSE", index)).toEqual(departments[0]);
    expect(resolveDepartmentLookup("IT", index)).toEqual(departments[1]);
  });

  it("does not resolve an abbreviation when two departments claim the same alias", () => {
    const departments = [
      { id: "dept-cs", name: "Computer Science" },
      { id: "dept-cse", name: "Computer Science Engineering" },
    ];
    const index = buildDepartmentLookupIndex(departments);

    expect(resolveDepartmentLookup("CSE", index)).toBeNull();
    expect(resolveDepartmentLookup("Computer Science", index)).toEqual(departments[0]);
  });

  it("prioritizes exact department names before abbreviation aliases", () => {
    const departments = [
      { id: "dept-short", name: "CSE" },
      { id: "dept-full", name: "Computer Science Engineering" },
    ];
    const index = buildDepartmentLookupIndex(departments);

    expect(resolveDepartmentLookup("CSE", index)).toEqual(departments[0]);
  });

  it("resolves batches by department and supports global batches", () => {
    const batches = [
      { id: "batch-a", name: "CSE-2027-A", departmentId: "dept-cse" },
      { id: "batch-global", name: "First Year Common", isGlobal: true, departmentIds: ["dept-cse", "dept-it"] },
    ];

    expect(resolveBatchLookup("cse 2027 a", batches, "dept-cse")).toEqual(batches[0]);
    expect(resolveBatchLookup("First-Year Common", batches, "dept-it")).toEqual(batches[1]);
    expect(resolveBatchLookup("CSE-2027-A", batches, "dept-it")).toBeNull();
  });

  it("includes the supplied value and available names in invalid department messages", () => {
    expect(normalizeImportLookupKey("Computer Science & Engineering")).toBe("computerscienceandengineering");
    expect(getInvalidDepartmentReason("Unknown", [{ name: "Computer Science" }])).toBe(
      'Invalid department "Unknown". Use one of: Computer Science'
    );
  });
});
