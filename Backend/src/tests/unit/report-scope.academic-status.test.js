const {
  ACADEMIC_STATUS,
  normalizeAcademicStatus,
  academicStatusToStudentScope,
  buildAcademicStatusWhere,
  buildStudentLifecycleWhere,
  buildReportScopeMetadata,
  resolveStudentAcademicStatus,
  STUDENT_SCOPE,
} = require("../../services/report-scope.service");

describe("academic status normalization", () => {
  it("accepts canonical values and aliases", () => {
    expect(normalizeAcademicStatus("current")).toBe(ACADEMIC_STATUS.CURRENT);
    expect(normalizeAcademicStatus("Active")).toBe(ACADEMIC_STATUS.CURRENT);
    expect(normalizeAcademicStatus("passout")).toBe(ACADEMIC_STATUS.GRADUATED);
    expect(normalizeAcademicStatus("alumni")).toBe(ACADEMIC_STATUS.GRADUATED);
    expect(normalizeAcademicStatus("suspended")).toBe(ACADEMIC_STATUS.ON_HOLD);
    expect(normalizeAcademicStatus("blocked")).toBe(ACADEMIC_STATUS.ON_HOLD);
    expect(normalizeAcademicStatus("dropped")).toBe(ACADEMIC_STATUS.WITHDRAWN);
    expect(normalizeAcademicStatus("transferred")).toBe(ACADEMIC_STATUS.TRANSFERRED);
    expect(normalizeAcademicStatus("inactive")).toBe(ACADEMIC_STATUS.ARCHIVED);
    expect(normalizeAcademicStatus("all")).toBe(ACADEMIC_STATUS.ALL);
  });

  it("returns null when no status is supplied so callers can fall back", () => {
    expect(normalizeAcademicStatus(undefined)).toBeNull();
    expect(normalizeAcademicStatus("")).toBeNull();
    expect(normalizeAcademicStatus("garbage")).toBeNull();
  });

  it("maps academic status to the legacy student scope", () => {
    expect(academicStatusToStudentScope(ACADEMIC_STATUS.GRADUATED)).toBe(STUDENT_SCOPE.PASSOUT);
    expect(academicStatusToStudentScope(ACADEMIC_STATUS.ALL)).toBe(STUDENT_SCOPE.ALL);
    expect(academicStatusToStudentScope(ACADEMIC_STATUS.CURRENT)).toBe(STUDENT_SCOPE.CURRENT);
  });
});

describe("academic status where clauses", () => {
  it("only current students match the current filter", () => {
    const where = buildAcademicStatusWhere(ACADEMIC_STATUS.CURRENT);
    expect(where.isActive).toBe(true);
    expect(where.lifecycleStatus.not.in).toEqual(
      expect.arrayContaining(["ALUMNI", "GRADUATED", "SUSPENDED", "BLOCKED", "DROPPED", "TRANSFERRED", "ARCHIVED"])
    );
  });

  it("maps each status to its lifecycle set", () => {
    expect(buildAcademicStatusWhere(ACADEMIC_STATUS.GRADUATED)).toEqual({ lifecycleStatus: { in: ["ALUMNI", "GRADUATED"] } });
    expect(buildAcademicStatusWhere(ACADEMIC_STATUS.ON_HOLD)).toEqual({ lifecycleStatus: { in: ["SUSPENDED", "BLOCKED"] } });
    expect(buildAcademicStatusWhere(ACADEMIC_STATUS.WITHDRAWN)).toEqual({ lifecycleStatus: { in: ["DROPPED"] } });
    expect(buildAcademicStatusWhere(ACADEMIC_STATUS.TRANSFERRED)).toEqual({ lifecycleStatus: { in: ["TRANSFERRED"] } });
    expect(buildAcademicStatusWhere(ACADEMIC_STATUS.ARCHIVED)).toEqual({ lifecycleStatus: { in: ["ARCHIVED"] } });
    expect(buildAcademicStatusWhere(ACADEMIC_STATUS.ALL)).toEqual({});
  });

  it("prefers an explicit academicStatus over the legacy studentScope", () => {
    const where = buildStudentLifecycleWhere({ academicStatus: ACADEMIC_STATUS.GRADUATED, studentScope: STUDENT_SCOPE.CURRENT });
    expect(where).toEqual({ lifecycleStatus: { in: ["ALUMNI", "GRADUATED"] } });
  });

  it("falls back to the legacy studentScope when academicStatus is absent", () => {
    expect(buildStudentLifecycleWhere({ studentScope: STUDENT_SCOPE.PASSOUT })).toEqual({
      lifecycleStatus: { in: ["ALUMNI", "GRADUATED"] },
    });
  });

  it("keeps passout filters alongside the status", () => {
    const where = buildStudentLifecycleWhere({ academicStatus: ACADEMIC_STATUS.GRADUATED, passoutYear: 2026 });
    expect(where.passoutYear).toBe(2026);
  });
});

describe("report scope metadata", () => {
  it("resolves an academic status even when only legacy scope is supplied", () => {
    expect(buildReportScopeMetadata({ studentScope: STUDENT_SCOPE.PASSOUT })).toMatchObject({
      studentScope: STUDENT_SCOPE.PASSOUT,
      academicStatus: ACADEMIC_STATUS.GRADUATED,
    });
  });
});

describe("resolveStudentAcademicStatus", () => {
  it("derives a status from the persisted lifecycle", () => {
    expect(resolveStudentAcademicStatus({ lifecycleStatus: "ACTIVE", isActive: true })).toBe(ACADEMIC_STATUS.CURRENT);
    expect(resolveStudentAcademicStatus({ lifecycleStatus: "GRADUATED" })).toBe(ACADEMIC_STATUS.GRADUATED);
    expect(resolveStudentAcademicStatus({ lifecycleStatus: "BLOCKED" })).toBe(ACADEMIC_STATUS.ON_HOLD);
    expect(resolveStudentAcademicStatus({ lifecycleStatus: "DROPPED" })).toBe(ACADEMIC_STATUS.WITHDRAWN);
    expect(resolveStudentAcademicStatus({ lifecycleStatus: "TRANSFERRED" })).toBe(ACADEMIC_STATUS.TRANSFERRED);
    expect(resolveStudentAcademicStatus({ lifecycleStatus: "ARCHIVED" })).toBe(ACADEMIC_STATUS.ARCHIVED);
    expect(resolveStudentAcademicStatus({ lifecycleStatus: "ACTIVE", isActive: false })).toBe(ACADEMIC_STATUS.ARCHIVED);
  });
});
