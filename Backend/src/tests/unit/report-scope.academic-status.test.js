const {
  STUDENT_STATUS,
  ACADEMIC_STATUS,
  STUDENT_SCOPE,
  REPORT_STATUS_MAP,
  normalizeAcademicStatus,
  normalizeStudentScope,
  academicStatusToStudentScope,
  studentScopeToAcademicStatus,
  buildAcademicStatusWhere,
  buildStudentLifecycleWhere,
  buildCurrentReportWhere,
  buildPassoutReportWhere,
  buildReportScopeMetadata,
  resolveStudentAcademicStatus,
} = require("../../services/report-scope.service");

describe("Canonical Student Status and Academic Status Contract", () => {
  it("enforces canonical ACADEMIC_STATUS and STUDENT_STATUS values", () => {
    expect(STUDENT_STATUS).toEqual({ ACTIVE: "ACTIVE", PASSOUT: "PASSOUT" });
    expect(ACADEMIC_STATUS).toEqual({ CURRENT: "current", PASSOUT: "passout" });
    expect(REPORT_STATUS_MAP).toEqual({
      current: "ACTIVE",
      passout: "PASSOUT",
    });
  });

  describe("academic status normalization", () => {
    it("accepts canonical values and aliases", () => {
      expect(normalizeAcademicStatus("current")).toBe(ACADEMIC_STATUS.CURRENT);
      expect(normalizeAcademicStatus("Active")).toBe(ACADEMIC_STATUS.CURRENT);
      expect(normalizeAcademicStatus("passout")).toBe(ACADEMIC_STATUS.PASSOUT);
      expect(normalizeAcademicStatus("alumni")).toBe(ACADEMIC_STATUS.PASSOUT);
      expect(normalizeAcademicStatus("graduated")).toBe(ACADEMIC_STATUS.PASSOUT);
    });

    it("returns null when no valid status is supplied", () => {
      expect(normalizeAcademicStatus(undefined)).toBeNull();
      expect(normalizeAcademicStatus("")).toBeNull();
      expect(normalizeAcademicStatus("garbage")).toBeNull();
    });

    it("normalizes student scope strictly without ALL scope", () => {
      expect(normalizeStudentScope("current")).toBe(ACADEMIC_STATUS.CURRENT);
      expect(normalizeStudentScope("passout")).toBe(ACADEMIC_STATUS.PASSOUT);
      expect(normalizeStudentScope("all")).toBe(ACADEMIC_STATUS.CURRENT);
      expect(normalizeStudentScope(undefined)).toBe(ACADEMIC_STATUS.CURRENT);
    });

    it("maps academic status to student scope and vice versa", () => {
      expect(academicStatusToStudentScope(ACADEMIC_STATUS.PASSOUT)).toBe(ACADEMIC_STATUS.PASSOUT);
      expect(academicStatusToStudentScope(ACADEMIC_STATUS.CURRENT)).toBe(ACADEMIC_STATUS.CURRENT);
      expect(studentScopeToAcademicStatus(STUDENT_SCOPE.PASSOUT)).toBe(ACADEMIC_STATUS.PASSOUT);
      expect(studentScopeToAcademicStatus(STUDENT_SCOPE.CURRENT)).toBe(ACADEMIC_STATUS.CURRENT);
    });
  });

  describe("where clauses", () => {
    it("builds academic status where strictly by studentStatus", () => {
      expect(buildAcademicStatusWhere(ACADEMIC_STATUS.CURRENT)).toEqual({ studentStatus: STUDENT_STATUS.ACTIVE });
      expect(buildAcademicStatusWhere(ACADEMIC_STATUS.PASSOUT)).toEqual({ studentStatus: STUDENT_STATUS.PASSOUT });
    });

    it("builds current report where", () => {
      const where = buildCurrentReportWhere({ collegeId: "col1", departmentId: "dept1", batchId: "b1" });
      expect(where).toEqual({
        studentStatus: STUDENT_STATUS.ACTIVE,
        collegeId: "col1",
        departmentId: "dept1",
        batchId: "b1",
      });
    });

    it("builds passout report where with passoutYear and passoutCohortId", () => {
      const where = buildPassoutReportWhere({ collegeId: "col1", passoutYear: 2026, passoutCohortId: "coh1" });
      expect(where).toEqual({
        studentStatus: STUDENT_STATUS.PASSOUT,
        collegeId: "col1",
        passoutYear: 2026,
        passoutCohortId: "coh1",
      });
    });

    it("buildStudentLifecycleWhere prioritizes studentStatus then academicStatus", () => {
      expect(buildStudentLifecycleWhere({ studentStatus: "PASSOUT" })).toEqual({
        studentStatus: STUDENT_STATUS.PASSOUT,
      });
      expect(buildStudentLifecycleWhere({ studentStatus: "ACTIVE" })).toEqual({
        studentStatus: STUDENT_STATUS.ACTIVE,
      });
      expect(buildStudentLifecycleWhere({ academicStatus: "passout", passoutYear: 2025 })).toEqual({
        studentStatus: STUDENT_STATUS.PASSOUT,
        passoutYear: 2025,
      });
      expect(buildStudentLifecycleWhere({ studentScope: "passout" })).toEqual({
        studentStatus: STUDENT_STATUS.PASSOUT,
      });
      // Default is strictly Current / ACTIVE
      expect(buildStudentLifecycleWhere({})).toEqual({
        studentStatus: STUDENT_STATUS.ACTIVE,
      });
    });
  });

  describe("report scope metadata", () => {
    it("resolves metadata with canonical mapping", () => {
      expect(buildReportScopeMetadata({ studentScope: "passout", passoutYear: 2026 })).toEqual({
        studentScope: ACADEMIC_STATUS.PASSOUT,
        academicStatus: ACADEMIC_STATUS.PASSOUT,
        studentStatus: STUDENT_STATUS.PASSOUT,
        passoutYear: 2026,
        passoutCohortId: null,
      });

      expect(buildReportScopeMetadata({})).toEqual({
        studentScope: ACADEMIC_STATUS.CURRENT,
        academicStatus: ACADEMIC_STATUS.CURRENT,
        studentStatus: STUDENT_STATUS.ACTIVE,
        passoutYear: null,
        passoutCohortId: null,
      });
    });
  });

  describe("resolveStudentAcademicStatus", () => {
    it("derives canonical status strictly from studentStatus with legacy fallback", () => {
      expect(resolveStudentAcademicStatus({ studentStatus: "ACTIVE" })).toBe(ACADEMIC_STATUS.CURRENT);
      expect(resolveStudentAcademicStatus({ studentStatus: "PASSOUT" })).toBe(ACADEMIC_STATUS.PASSOUT);
      expect(resolveStudentAcademicStatus({ lifecycleStatus: "ALUMNI" })).toBe(ACADEMIC_STATUS.PASSOUT);
      expect(resolveStudentAcademicStatus({ disabledReason: "PASSOUT" })).toBe(ACADEMIC_STATUS.PASSOUT);
      expect(resolveStudentAcademicStatus({})).toBe(ACADEMIC_STATUS.CURRENT);
    });
  });
});
