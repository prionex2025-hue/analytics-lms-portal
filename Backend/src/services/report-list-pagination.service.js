const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 25;

const DEPARTMENT_LIST_SORT_KEYS = [
  "department",
  "college",
  "students",
  "submissions",
  "avgScore",
  "passRate",
  "participation",
  "violations",
];

const STUDENT_LIST_SORT_KEYS = [
  "rank",
  "name",
  "rollNo",
  "department",
  "batch",
  "year",
  "testsTaken",
  "avgScore",
  "participation",
  "violations",
];

const normalizeListQuery = (query = {}, prefix, allowedSort, defaultSort = "name") => {
  const page = Math.max(1, Number.parseInt(query[`${prefix}Page`], 10) || 1);
  const requestedLimit = Number.parseInt(query[`${prefix}Limit`], 10);
  const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIST_LIMIT));
  const search = String(query[`${prefix}Search`] || "").trim().toLowerCase();
  const requestedSort = String(query[`${prefix}Sort`] || "");
  const sort = allowedSort.includes(requestedSort) ? requestedSort : defaultSort;
  const dir = String(query[`${prefix}Dir`] || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  return { page, limit, search, sort, dir };
};

// A metric the API answers as null ("no data") must sort after every real value
// in either direction, never as a 0.
const compareListValues = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

const paginateList = (rows = [], { page, limit, search, sort, dir }, searchableKeys = []) => {
  const list = Array.isArray(rows) ? rows : [];
  const filtered = search
    ? list.filter((row) => searchableKeys.some((key) => String(row[key] ?? "").toLowerCase().includes(search)))
    : list;
  const sorted = [...filtered].sort((a, b) => {
    const aMissing = a[sort] == null;
    const bMissing = b[sort] == null;
    // A metric with no data sorts last in BOTH directions: reversing the sort
    // must not promote a missing value above a real one.
    if (aMissing || bMissing) {
      if (aMissing && bMissing) return 0;
      return aMissing ? 1 : -1;
    }
    const cmp = compareListValues(a[sort], b[sort]);
    return dir === "desc" ? -cmp : cmp;
  });
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  return {
    data: sorted.slice(start, start + limit),
    pagination: { page: safePage, limit, total, totalPages },
  };
};

// Optional server-side paging for the analytics lists. The endpoint still
// computes the full scope (the metrics and charts need it), but when the client
// asks with `paginate=1` it ships one page of the bulky per-student and
// per-department rows instead of every row in the college. Paging the student
// list is skipped for rows=none/absent, whose callers need the complete set.
const paginateAnalyticsPayload = (payload = {}, query = {}, rowsMode = "all") => {
  const departments = paginateList(
    payload.departmentRows,
    normalizeListQuery(query, "departments", DEPARTMENT_LIST_SORT_KEYS, "department"),
    ["department", "college"]
  );
  payload.departmentRows = departments.data;
  payload.departmentPagination = departments.pagination;

  if (rowsMode === "all") {
    const students = paginateList(
      payload.tableRows,
      normalizeListQuery(query, "students", STUDENT_LIST_SORT_KEYS, "rank"),
      ["name", "rollNo", "department", "batch", "year"]
    );
    payload.tableRows = students.data;
    payload.studentPagination = students.pagination;
  }
  return payload;
};

module.exports = {
  DEPARTMENT_LIST_SORT_KEYS,
  STUDENT_LIST_SORT_KEYS,
  compareListValues,
  normalizeListQuery,
  paginateAnalyticsPayload,
  paginateList,
};