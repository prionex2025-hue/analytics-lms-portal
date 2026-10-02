const {
  compareListValues,
  normalizeListQuery,
  paginateAnalyticsPayload,
  paginateList,
} = require("../../services/report-list-pagination.service");

const departments = [
  { department: "Civil", college: "North", students: 40, avgScore: 61, passRate: null, participation: 50, violations: 1 },
  { department: "Biomedical", college: "North", students: 10, avgScore: null, passRate: null, participation: 80, violations: 0 },
  { department: "Mechanical", college: "North", students: 25, avgScore: 48, passRate: 40, participation: 60, violations: 2 },
];

const students = [
  { rank: 1, name: "Asha", rollNo: "NC-042", department: "Civil", batch: "2024", year: 2, avgScore: 88, participation: 100, violations: 0 },
  { rank: 2, name: "Vikram", rollNo: "NC-043", department: "Civil", batch: "2024", year: 2, avgScore: null, participation: null, violations: 1 },
  { rank: null, name: "Meera", rollNo: "NC-044", department: "Biomedical", batch: "2023", year: 3, avgScore: null, participation: null, violations: 0 },
];

const basePayload = () => ({
  metrics: { totalStudents: 3 },
  departmentRows: departments.map((row) => ({ ...row })),
  tableRows: students.map((row) => ({ ...row })),
});

describe("normalizeListQuery", () => {
  it("falls back to the defaults and clamps the page size", () => {
    expect(normalizeListQuery({}, "students", ["name"], "rank")).toEqual({ page: 1, limit: 25, search: "", sort: "rank", dir: "asc" });
    expect(normalizeListQuery({ studentsLimit: "5000" }, "students", ["name"], "rank").limit).toBe(100);
    expect(normalizeListQuery({ studentsLimit: "0" }, "students", ["name"], "rank").limit).toBe(1);
    expect(normalizeListQuery({ studentsPage: "-4" }, "students", ["name"], "rank").page).toBe(1);
  });

  it("ignores a sort column the caller may not request", () => {
    const allowed = ["department", "avgScore"];

    expect(normalizeListQuery({ departmentsSort: "; drop" }, "departments", allowed, "department").sort).toBe("department");
    // "students" belongs to the student list, not the department list.
    expect(normalizeListQuery({ departmentsSort: "students" }, "departments", allowed, "department").sort).toBe("department");
    expect(normalizeListQuery({ departmentsSort: "avgScore" }, "departments", allowed, "department").sort).toBe("avgScore");
  });

  it("lowercases the search text so matches are case-insensitive", () => {
    expect(normalizeListQuery({ studentsSearch: " Asha " }, "students", ["name"], "rank").search).toBe("asha");
  });
});

describe("compareListValues", () => {
  it("pushes a metric with no data to the end instead of treating it as 0", () => {
    expect(compareListValues(null, 0)).toBeGreaterThan(0);
    expect(compareListValues(null, null)).toBe(0);
    expect(compareListValues(10, 60)).toBeLessThan(0);
  });

  it("orders names naturally and case-insensitively", () => {
    expect(compareListValues("Batch 2", "Batch 10")).toBeLessThan(0);
    expect(compareListValues("asha", "Asha")).toBe(0);
  });
});

describe("paginateList", () => {
  it("returns the page plus the metadata the table needs", () => {
    const result = paginateList(departments, { page: 2, limit: 2, search: "", sort: "department", dir: "asc" }, ["department"]);

    expect(result.data.map((row) => row.department)).toEqual(["Mechanical"]);
    expect(result.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it("clamps an out-of-range page to the last one instead of returning nothing", () => {
    const result = paginateList(departments, { page: 99, limit: 2, search: "", sort: "department", dir: "asc" }, ["department"]);

    expect(result.pagination.page).toBe(2);
    expect(result.data).toHaveLength(1);
  });

  it("searches every declared column", () => {
    const byName = paginateList(students, { page: 1, limit: 10, search: "med", sort: "rank", dir: "asc" }, ["name", "rollNo", "department", "batch", "year"]);
    expect(byName.data.map((row) => row.name)).toEqual(["Meera"]);

    const byRollNo = paginateList(students, { page: 1, limit: 10, search: "nc-043", sort: "rank", dir: "asc" }, ["name", "rollNo", "department", "batch", "year"]);
    expect(byRollNo.data.map((row) => row.name)).toEqual(["Vikram"]);
  });

  it("keeps a no-data metric last whichever direction the sort runs", () => {
    const descending = paginateList(students, { page: 1, limit: 10, search: "", sort: "avgScore", dir: "desc" }, ["name"]);
    expect(descending.data[0].name).toBe("Asha");
    expect(descending.data.slice(1).map((row) => row.avgScore)).toEqual([null, null]);

    const ascending = paginateList(students, { page: 1, limit: 10, search: "", sort: "avgScore", dir: "asc" }, ["name"]);
    expect(ascending.data[0].name).toBe("Asha");
    expect(ascending.data.slice(1).map((row) => row.avgScore)).toEqual([null, null]);
  });
});

describe("paginateAnalyticsPayload", () => {
  it("pages the departments and the student ranking", () => {
    const payload = paginateAnalyticsPayload(basePayload(), { departmentsLimit: "2", studentsLimit: "1" }, "all");

    expect(payload.departmentRows).toHaveLength(2);
    expect(payload.departmentPagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    // The student list defaults to rank order, so page 1 is the top-ranked student.
    expect(payload.tableRows.map((row) => row.name)).toEqual(["Asha"]);
    expect(payload.studentPagination).toEqual({ page: 1, limit: 1, total: 3, totalPages: 3 });
  });

  it("leaves the student list whole for rows=absent, which the deep-dive needs in full", () => {
    const payload = paginateAnalyticsPayload(basePayload(), { studentsLimit: "1" }, "absent");

    expect(payload.tableRows).toHaveLength(3);
    expect(payload.studentPagination).toBeUndefined();
  });

  it("still pages the departments when the student list is suppressed", () => {
    const payload = paginateAnalyticsPayload(basePayload(), { departmentsLimit: "1", rows: "none" }, "none");

    expect(payload.departmentRows).toHaveLength(1);
    expect(payload.departmentPagination.total).toBe(3);
    expect(payload.studentPagination).toBeUndefined();
  });

  it("copes with a payload that carries no list at all", () => {
    const payload = paginateAnalyticsPayload({ metrics: {} }, {}, "all");

    expect(payload.departmentRows).toEqual([]);
    expect(payload.tableRows).toEqual([]);
    expect(payload.departmentPagination).toEqual({ page: 1, limit: 25, total: 0, totalPages: 1 });
    expect(payload.studentPagination).toEqual({ page: 1, limit: 25, total: 0, totalPages: 1 });
  });
});