import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import { parseSpreadsheetRows } from "@/lib/spreadsheet";
import { isAdminRole } from "@/features/Admin/adminRole";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileUp, KeyRound, Plus, Search, UserPlus, Users } from "lucide-react";
import {
  Callout,
  CredentialList,
  CredentialPanel,
  DetailList,
  EmptyState,
  FormField,
  MiniStat,
  PageHeader,
  PaginationBar,
  SearchInput,
  SectionCard,
  StatusBadge,
} from "@/components/common/page-kit";
import { cn } from "@/lib/utils";

const LINE_TAB = "flex-none rounded-none px-0.5 pt-1 pb-3 text-text-secondary data-active:text-primary after:!bottom-[-1px] after:!bg-primary";

const IMPORT_SAMPLE = [
  "fullName,email,enrollNumber,department,year,batch",
  "Alice Doe,alice@example.com,20261001,Computer Science,1,CSE-2027-A",
].join("\n");
const YEAR_OPTIONS = ["1", "2", "3", "4"];

const normalizeColumnKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getRowValue = (row, aliases = []) => {
  const aliasSet = new Set(aliases.map(normalizeColumnKey));
  for (const [key, value] of Object.entries(row || {})) {
    if (aliasSet.has(normalizeColumnKey(key))) {
      return String(value ?? "").trim();
    }
  }
  return "";
};

const toCsvCell = (value) => {
  const cell = String(value ?? "").trim();
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, "\"\"")}"` : cell;
};

export default function StudentsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [directoryFilters, setDirectoryFilters] = useState({ departmentId: "", batchId: "", year: "" });
  const [page, setPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [batchIdInput, setBatchIdInput] = useState("");
  const [csvData, setCsvData] = useState(IMPORT_SAMPLE);
  const [activeImportJobId, setActiveImportJobId] = useState("");
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [importFileName, setImportFileName] = useState("");
  const [studentForm, setStudentForm] = useState({
    fullName: "",
    email: "",
    department: "",
    enrollNumber: "",
    year: "",
    batch: "",
  });
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [resetCredentials, setResetCredentials] = useState(null);
  const [importCredentials, setImportCredentials] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const canManageStudents = usePermission(ADMIN_PERMISSIONS.MANAGE_STUDENTS);
  const canViewStudents = usePermission(ADMIN_PERMISSIONS.VIEW_STUDENTS) || canManageStudents;
  const canManageBatches = usePermission(ADMIN_PERMISSIONS.MANAGE_BATCHES);
  const canViewBatches = usePermission(ADMIN_PERMISSIONS.VIEW_BATCHES) || canManageBatches;
  const canBulkImport = usePermission(ADMIN_PERMISSIONS.BULK_IMPORT) && canManageStudents;
  const canManageDepartments = usePermission(ADMIN_PERMISSIONS.MANAGE_DEPARTMENTS);
  const canAssignStudentsToBatch = canManageStudents && canManageBatches;

  const rowsToCsv = (rows) => {
    const header = ["fullName", "email", "studentId", "enrollNumber", "department", "year", "batch"];
    const lines = rows.map((row) => {
      const studentId = getRowValue(row, ["studentId", "student_id", "rollNo", "rollNumber", "roll"]);
      const normalized = {
        fullName: getRowValue(row, ["fullName", "full_name", "name", "studentName", "student_name"]),
        email: getRowValue(row, ["email", "emailAddress", "email_address", "eMail", "mail"]),
        studentId,
        enrollNumber: getRowValue(row, ["enrollNumber", "enroll_number", "enrollmentNumber", "enrollment_no", "enrollmentNo"]) || studentId,
        department: getRowValue(row, ["department", "departmentName", "department_name", "departmentId", "department_id", "branch", "branchName"]),
        year: getRowValue(row, ["year", "studentYear", "student_year", "academicYear", "academic_year", "yearOfStudy", "year_of_study"]),
        batch: getRowValue(row, ["batch", "batchName", "batch_name", "batchId", "batch_id", "section"]),
      };
      return [
        toCsvCell(normalized.fullName),
        toCsvCell(normalized.email),
        toCsvCell(normalized.studentId),
        toCsvCell(normalized.enrollNumber),
        toCsvCell(normalized.department),
        toCsvCell(normalized.year),
        toCsvCell(normalized.batch),
      ].join(",");
    });

    return [header.join(","), ...lines].join("\n");
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const name = String(file.name || "").toLowerCase();
      let parsedCsv = "";

      if (name.endsWith(".csv")) {
        parsedCsv = await file.text();
      } else {
        const rows = await parseSpreadsheetRows(file);
        parsedCsv = rowsToCsv(rows);
      }

      setCsvData(parsedCsv);
      setImportFileName(file.name);
      setBanner({ type: "success", title: "File loaded", message: "Spreadsheet parsed successfully. Review rows and start import." });
    } catch (error) {
      setBanner({ type: "error", title: "File parse failed", message: error?.message || "Unable to parse spreadsheet file." });
      toast.error(error?.message || "Unable to parse spreadsheet file");
    }

    event.target.value = "";
  };

  const studentsQuery = useQuery({
    queryKey: ["admin-students", search, page, directoryFilters.departmentId, directoryFilters.batchId, directoryFilters.year],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      params.set("page", String(page));
      if (search.trim()) params.set("search", search.trim());
      if (directoryFilters.departmentId) params.set("departmentId", directoryFilters.departmentId);
      if (directoryFilters.batchId) params.set("batchId", directoryFilters.batchId);
      if (directoryFilters.year) params.set("year", directoryFilters.year);
      return adminApi.getStudents(`?${params.toString()}`);
    },
    enabled: canViewStudents,
  });

  const studentProfileQuery = useQuery({
    queryKey: ["admin-student-profile", selectedStudentId],
    queryFn: () => adminApi.getStudentProfile(selectedStudentId),
    enabled: Boolean(selectedStudentId) && canViewStudents,
  });

  const batchesQuery = useQuery({
    queryKey: ["admin-batches-for-students"],
    queryFn: adminApi.getBatches,
    enabled: canViewBatches,
  });

  const departmentsQuery = useQuery({
    queryKey: ["admin-departments-for-students"],
    queryFn: adminApi.getDepartments,
    enabled: canViewBatches || canManageDepartments,
  });

  const assignBatchMutation = useMutation({
    mutationFn: ({ studentId, batchId }) => adminApi.assignStudentBatch(studentId, { batchId }),
    onSuccess: () => {
      toast.success("Batch assigned.");
      setBanner({ type: "success", title: "Batch updated", message: "Student has been added to the selected batch." });
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
      queryClient.invalidateQueries({ queryKey: ["admin-student-profile", selectedStudentId] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Assign failed", message: error?.message || "Could not assign student to this batch." });
      toast.error(error?.message || "Failed to assign batch.");
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (studentId) => adminApi.resetStudentPassword(studentId),
    onSuccess: (payload) => {
      setResetCredentials(payload?.credentials || null);
      toast.success("Student password reset");
      setBanner({ type: "success", title: "Password reset", message: "Student password regenerated using the default rule." });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Reset failed", message: error?.message || "Could not reset the student password." });
      toast.error(error?.message || "Failed to reset password.");
    },
  });

  const importMutation = useMutation({
    mutationFn: (body) => adminApi.bulkImportStudents(body),
    onSuccess: (payload) => {
      // Handle both queued async job (legacy) and immediate report (new behavior)
      if (payload && payload.jobId) {
        toast.success("Import job queued.");
        setBanner({ type: "success", title: "Import queued", message: "CSV processing started in background." });
        setActiveImportJobId(payload.jobId);
        return;
      }

      // Immediate report returned
      const report = payload?.result || payload || {};
      const created = report.created || 0;
      const failed = report.failed || 0;
      const duplicates = report.duplicates || 0;
      toast.success("Import completed");
      setBanner({ type: "success", title: "Import completed", message: `Created: ${created} • Failed: ${failed} • Duplicates: ${duplicates}` });
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Import queue failed", message: error?.message || "Unable to queue import job." });
      toast.error(error?.message || "Failed to queue import.");
    },
  });

  const createStudentMutation = useMutation({
    mutationFn: (payload) => adminApi.createStudent(payload),
    onSuccess: (payload) => {
      toast.success("Student account created");
      setCreatedCredentials(payload.credentials || null);
      setStudentForm({ fullName: "", email: "", department: "", enrollNumber: "", year: "", batch: "" });
      setBanner({ type: "success", title: "Student created", message: "Student can login directly using email and generated password." });
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Create student failed", message: error?.message || "Unable to create student account." });
      toast.error(error?.message || "Unable to create student account");
    },
  });

  const importJobQuery = useQuery({
    queryKey: ["admin-student-import-job", activeImportJobId],
    queryFn: () => adminApi.getStudentImportJobStatus(activeImportJobId),
    enabled: Boolean(activeImportJobId) && canBulkImport,
    refetchInterval: (query) => {
      const status = query?.state?.data?.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });

  const students = useMemo(() => studentsQuery.data?.data || [], [studentsQuery.data]);
  const studentPagination = studentsQuery.data?.pagination;
  const batches = useMemo(() => Array.isArray(batchesQuery.data) ? batchesQuery.data : batchesQuery.data?.data || [], [batchesQuery.data]);
  const departments = useMemo(() => Array.isArray(departmentsQuery.data) ? departmentsQuery.data : departmentsQuery.data?.data || [], [departmentsQuery.data]);

  const admin = useAdminAuthState()?.admin;
  const scopedDepartmentId = useMemo(
    () => admin?.department?.id || admin?.departmentId || "",
    [admin?.department?.id, admin?.departmentId]
  );
  const isDepartmentScopedAdmin = useMemo(
    () => isAdminRole(admin?.role) && Boolean(scopedDepartmentId),
    [admin?.role, scopedDepartmentId]
  );
  const scopedDepartmentName = !isDepartmentScopedAdmin
    ? ""
    : admin?.department?.name || departments.find((department) => String(department.id) === String(scopedDepartmentId))?.name || "";

  useEffect(() => {
    if (!admin) return;
    if (!isDepartmentScopedAdmin) return;

    setDirectoryFilters((prev) => ({ ...prev, departmentId: prev.departmentId || scopedDepartmentId }));
    if (scopedDepartmentName) {
      setStudentForm((prev) => (prev.department ? prev : { ...prev, department: scopedDepartmentName }));
    }
  }, [admin, isDepartmentScopedAdmin, scopedDepartmentId, scopedDepartmentName]);
  const selectedStudent = studentProfileQuery.data;

  useEffect(() => {
    if (!selectedStudentId && students.length > 0) {
      setSelectedStudentId(students[0].id);
    }
  }, [selectedStudentId, students]);

  useEffect(() => {
    if (!importJobQuery.data) return;
    if (importJobQuery.data.status === "completed") {
      setBanner({ type: "success", title: "Import completed", message: "Refresh student list to review newly created accounts." });
      setImportCredentials(importJobQuery.data.result?.credentials || null);
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
      return;
    }
    if (importJobQuery.data.status === "failed") {
      setBanner({ type: "error", title: "Import failed", message: importJobQuery.data.error || "Import job failed during processing." });
      return;
    }
    if (importJobQuery.data.status === "queued" || importJobQuery.data.status === "processing") {
      setBanner({ type: "warning", title: "Import in progress", message: "Job is still running. Results will appear shortly." });
    }
  }, [importJobQuery.data, queryClient]);

  if (!canViewStudents) {
    return <PermissionDenied action="access students" />;
  }

  const bannerTone = banner.type === "error" ? "danger" : banner.type === "warning" ? "warning" : "success";
  const jobStatus = String(importJobQuery.data?.status || "").toLowerCase();
  const createBatchOptions = Array.isArray(batches)
    ? batches.filter((batch) => {
        if (!studentForm.department) return true;
        const selected = String(studentForm.department).toLowerCase();
        const batchDeptName = String(batch.department?.name || "").toLowerCase();
        return (
          String(batch.departmentId) === String(studentForm.department) ||
          String(batch.department?.id) === String(studentForm.department) ||
          (batchDeptName && batchDeptName === selected)
        );
      })
    : [];

  const directory = (
    <SectionCard
      flush
      title="Student directory"
      description="Search and filter students, inspect a profile, and manage batches."
      footer={
        (studentPagination?.totalPages || 1) > 1 ? (
          <PaginationBar page={studentPagination?.page || page} pages={studentPagination?.totalPages || 1} onPageChange={(next) => setPage(Math.max(next, 1))} />
        ) : null
      }
    >
      <form
        className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          studentsQuery.refetch();
        }}
      >
        <SearchInput
          className="sm:col-span-2 lg:col-span-1"
          label="Search students"
          placeholder="Search by name/email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Department"
          className="ui-select w-full"
          value={directoryFilters.departmentId}
          onChange={(event) => {
            setDirectoryFilters((prev) => ({ ...prev, departmentId: event.target.value }));
            setPage(1);
          }}
          disabled={isDepartmentScopedAdmin}
        >
          {!isDepartmentScopedAdmin ? <option value="">All departments</option> : null}
          {isDepartmentScopedAdmin ? (
            <option value={scopedDepartmentId}>{scopedDepartmentName || "Scoped Department"}</option>
          ) : (
            Array.isArray(departments) && departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))
          )}
        </select>
        <select
          aria-label="Batch"
          className="ui-select w-full"
          value={directoryFilters.batchId}
          onChange={(event) => {
            setDirectoryFilters((prev) => ({ ...prev, batchId: event.target.value }));
            setPage(1);
          }}
          disabled={!canViewBatches}
        >
          <option value="">All batches</option>
          {Array.isArray(batches)
            ? batches
                .filter((batch) => !directoryFilters.departmentId || String(batch.departmentId) === String(directoryFilters.departmentId))
                .map((batch) => (
                  <option key={batch.id} value={batch.id}>{batch.name}</option>
                ))
            : null}
        </select>
        <select
          aria-label="Year"
          className="ui-select w-full"
          value={directoryFilters.year}
          onChange={(event) => {
            setDirectoryFilters((prev) => ({ ...prev, year: event.target.value }));
            setPage(1);
          }}
        >
          <option value="">All years</option>
          {YEAR_OPTIONS.map((year) => (
            <option key={year} value={year}>{year} YEAR</option>
          ))}
        </select>
        <Button type="submit" variant="outline" className="h-10 rounded-lg px-4">
          <Search className="size-4" />
          Search
        </Button>
      </form>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 xl:border-r xl:border-border">
          {studentsQuery.isLoading ? (
            <div className="space-y-2 p-4" aria-busy="true">
              <SkeletonBlock className="h-14 rounded-lg" />
              <SkeletonBlock className="h-14 rounded-lg" />
              <SkeletonBlock className="h-14 rounded-lg" />
            </div>
          ) : students.length === 0 ? (
            <EmptyState icon={Users} title="No students found" description="No students found for current filters." className="border-0" />
          ) : (
            <ul className="divide-y divide-border">
              {students.map((student) => {
                const batchLabel = Array.isArray(student.batches) && student.batches.length > 0
                  ? student.batches.map((batch) => batch.name).join(", ")
                  : (student.batch?.name || "-");
                const active = selectedStudentId === student.id;
                return (
                  <li key={student.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStudentId(student.id);
                        setBatchIdInput("");
                      }}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5",
                        active ? "bg-primary/5" : "hover:bg-muted/40"
                      )}
                    >
                      <span className="min-w-0">
                        <span className={cn("block truncate font-medium", active ? "text-primary" : "text-text-primary")}>{student.fullName}</span>
                        <span className="block truncate text-xs text-text-secondary">{student.email} · {student.studentId}</span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-text-secondary">
                        <span className="block truncate">{student.department?.name || "-"}</span>
                        <span className="block max-w-35 truncate">{batchLabel}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="border-t border-border p-4 sm:p-5 xl:border-t-0">
          {studentProfileQuery.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <SkeletonBlock className="h-6" />
              <SkeletonBlock className="h-6" />
              <SkeletonBlock className="h-10" />
            </div>
          ) : !selectedStudent ? (
            <p className="py-6 text-center text-sm text-text-secondary">Select a student for profile details.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-text-primary">{selectedStudent.fullName}</p>
                <p className="text-xs text-text-secondary">{selectedStudent.email} · {selectedStudent.studentId}</p>
              </div>
              <DetailList
                items={[
                  { label: "Department", value: selectedStudent.department?.name || "-" },
                  { label: "Year", value: selectedStudent.year ? `${selectedStudent.year} YEAR` : "-" },
                  { label: "Total submissions", value: selectedStudent._count?.submissions || 0 },
                ]}
              />
              <div>
                <p className="mb-2 text-xs text-text-secondary">Assigned batches</p>
                {Array.isArray(selectedStudent.batches) && selectedStudent.batches.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedStudent.batches.map((batch) => <StatusBadge key={batch.id} tone="info">{batch.name}</StatusBadge>)}
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary italic">No batches assigned yet</p>
                )}
              </div>

              {canAssignStudentsToBatch ? (
                <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
                  <select aria-label="Batch to add" className="ui-select min-w-0 flex-1" value={batchIdInput} onChange={(event) => setBatchIdInput(event.target.value)}>
                    <option value="">Select batch to add</option>
                    {Array.isArray(batches) && batches.map((batch) => (
                      <option key={batch.id} value={batch.id}>{batch.name} ({batch.department?.name || "-"})</option>
                    ))}
                  </select>
                  <Button
                    className="h-10 rounded-lg px-4"
                    onClick={() => assignBatchMutation.mutate({ studentId: selectedStudent.id, batchId: batchIdInput })}
                    disabled={assignBatchMutation.isPending || !batchIdInput}
                  >
                    <Plus className="size-4" />
                    Add Batch
                  </Button>
                </div>
              ) : null}

              {canManageStudents ? (
                <div className="space-y-3 border-t border-border pt-4">
                  <Button variant="outline" className="h-10 w-full rounded-lg" onClick={() => setConfirmReset(true)} disabled={resetPasswordMutation.isPending}>
                    <KeyRound className="size-4" />
                    {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password to Default Rule"}
                  </Button>
                  <CredentialPanel title="New credentials" credentials={resetCredentials} />
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </SectionCard>
  );

  const createPanel = canManageStudents ? (
    <SectionCard title="Create student account" description="No student registration is needed. Admin creates credentials directly.">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          createStudentMutation.mutate({
            ...studentForm,
            year: studentForm.year ? Number(studentForm.year) : undefined,
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Full name" htmlFor="admin-student-name" required>
            <Input id="admin-student-name" className="h-10 rounded-lg" value={studentForm.fullName} onChange={(event) => setStudentForm((prev) => ({ ...prev, fullName: event.target.value }))} />
          </FormField>
          <FormField label="Email" htmlFor="admin-student-email" required>
            <Input id="admin-student-email" type="email" autoComplete="off" className="h-10 rounded-lg" value={studentForm.email} onChange={(event) => setStudentForm((prev) => ({ ...prev, email: event.target.value }))} />
          </FormField>
          <FormField label="Enroll number" htmlFor="admin-student-enroll" hint="Used exactly as the Student ID." required>
            <Input id="admin-student-enroll" className="h-10 rounded-lg" value={studentForm.enrollNumber} onChange={(event) => setStudentForm((prev) => ({ ...prev, enrollNumber: event.target.value }))} />
          </FormField>
          <FormField label="Department" htmlFor="admin-student-department" required>
            <select
              id="admin-student-department"
              className="ui-select w-full"
              value={studentForm.department}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, department: event.target.value }))}
              disabled={isDepartmentScopedAdmin}
            >
              {!isDepartmentScopedAdmin ? <option value="">Select department</option> : null}
              {isDepartmentScopedAdmin ? (
                <option value={scopedDepartmentName}>{scopedDepartmentName || "Scoped Department"}</option>
              ) : (
                Array.isArray(departments) && departments.map((department) => (
                  <option key={department.id} value={department.name}>{department.name}</option>
                ))
              )}
            </select>
          </FormField>
          <FormField label="Year" htmlFor="admin-student-year" required>
            <select id="admin-student-year" className="ui-select w-full" value={studentForm.year} onChange={(event) => setStudentForm((prev) => ({ ...prev, year: event.target.value }))}>
              <option value="">Select Year</option>
              <option value="1">1 YEAR</option>
              <option value="2">2 YEAR</option>
              <option value="3">3 YEAR</option>
              <option value="4">4 YEAR</option>
            </select>
          </FormField>
          <FormField label="Batch" htmlFor="admin-student-batch" hint="Optional">
            <select id="admin-student-batch" className="ui-select w-full" value={studentForm.batch} onChange={(event) => setStudentForm((prev) => ({ ...prev, batch: event.target.value }))}>
              <option value="">Select batch (optional)</option>
              {createBatchOptions.map((batch) => (
                <option key={batch.id} value={batch.id}>{batch.name}</option>
              ))}
            </select>
          </FormField>
        </div>
        <Callout tone="info" icon={KeyRound}>
          Student ID uses the entered enroll number exactly. Password rule: First 3 letters of full name (first letter capitalized) + @ + last 3 digits of enroll number.
        </Callout>
        <Button
          type="submit"
          className="h-10 rounded-lg px-4"
          disabled={
            createStudentMutation.isPending ||
            !studentForm.fullName.trim() ||
            !studentForm.email.trim() ||
            !studentForm.department.trim() ||
            !studentForm.year ||
            !studentForm.enrollNumber.trim()
          }
        >
          <UserPlus className="size-4" />
          {createStudentMutation.isPending ? "Creating..." : "Create Student"}
        </Button>
      </form>
      <CredentialPanel className="mt-5" title="Student created — share these credentials securely" credentials={createdCredentials} />
    </SectionCard>
  ) : null;

  const importPanel = canBulkImport ? (
    <SectionCard title="Bulk import (Excel/CSV)" description="Upload .xlsx/.csv file or paste CSV. Runs as async job and supports large imports.">
      <div className="space-y-4">
        <Callout tone="info" title="Excel format (first row headers)">
          <p>fullName, email, enrollNumber, department, year, batch</p>
          <p className="mt-1">Student ID will use the enrollNumber value exactly. Example: Alice Doe, alice@example.com, 20261001, Computer Science, 1, CSE-2027-A</p>
        </Callout>
        <FormField label="Spreadsheet file" htmlFor="admin-student-import-file" hint={importFileName ? `Loaded: ${importFileName}` : ".xlsx or .csv"}>
          <Input id="admin-student-import-file" type="file" accept=".xlsx,.csv" onChange={handleImportFile} className="h-10 w-full rounded-lg" />
        </FormField>
        <FormField label="CSV data" htmlFor="admin-student-import-csv">
          <Textarea id="admin-student-import-csv" rows={8} className="rounded-lg font-mono text-xs" value={csvData} onChange={(event) => setCsvData(event.target.value)} />
        </FormField>
        <div className="flex flex-wrap items-center gap-3">
          <Button className="h-10 rounded-lg px-4" onClick={() => importMutation.mutate({ csvData })} disabled={importMutation.isPending}>
            <FileUp className="size-4" />
            {importMutation.isPending ? "Queueing..." : "Start Import"}
          </Button>
          {activeImportJobId ? <p className="font-mono text-xs break-all text-text-secondary">Job: {activeImportJobId}</p> : null}
        </div>

        {importJobQuery.data ? (
          <div className="space-y-3 rounded-lg border border-border p-4" role="status">
            <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
              Status
              <StatusBadge tone={jobStatus === "completed" ? "success" : jobStatus === "failed" ? "danger" : "info"}>
                {String(importJobQuery.data.status || "unknown").toUpperCase()}
              </StatusBadge>
            </p>
            {importJobQuery.data.result ? (
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Created" value={importJobQuery.data.result.created || 0} tone="success" />
                <MiniStat label="Failed" value={importJobQuery.data.result.failed || 0} tone={importJobQuery.data.result.failed ? "danger" : undefined} />
                <MiniStat label="Duplicates" value={importJobQuery.data.result.duplicates || 0} />
              </div>
            ) : null}
            {importJobQuery.data.error ? <Callout tone="danger">Error: {importJobQuery.data.error}</Callout> : null}
            <CredentialList entries={importCredentials} />
          </div>
        ) : null}
      </div>
    </SectionCard>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description={isDepartmentScopedAdmin && scopedDepartmentName ? `Students in ${scopedDepartmentName}.` : "Find, create, and import student accounts for your college."}
      />

      {banner.type ? (
        <Callout tone={bannerTone} title={banner.title}>
          {banner.message}
        </Callout>
      ) : null}

      {createPanel || importPanel ? (
        <Tabs defaultValue="directory" className="gap-5">
          <div className="relative -mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">
            <TabsList variant="line" className="h-auto! w-full min-w-max justify-start gap-6 rounded-none border-b border-border p-0">
              <TabsTrigger value="directory" className={LINE_TAB}>
                <Users className="size-4" />
                Directory
              </TabsTrigger>
              {createPanel ? (
                <TabsTrigger value="create" className={LINE_TAB}>
                  <UserPlus className="size-4" />
                  Add student
                </TabsTrigger>
              ) : null}
              {importPanel ? (
                <TabsTrigger value="import" className={LINE_TAB}>
                  <FileUp className="size-4" />
                  Bulk import
                </TabsTrigger>
              ) : null}
            </TabsList>
          </div>
          <TabsContent value="directory">{directory}</TabsContent>
          {createPanel ? <TabsContent value="create">{createPanel}</TabsContent> : null}
          {importPanel ? <TabsContent value="import">{importPanel}</TabsContent> : null}
        </Tabs>
      ) : (
        directory
      )}

      <ConfirmActionDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset student password"
        description={`Reset the password for ${selectedStudent?.fullName || "this student"} to the default rule? Their current password will stop working.`}
        confirmLabel="Reset Password"
        confirmVariant="destructive"
        onConfirm={() => {
          if (!selectedStudent?.id) return;
          setResetCredentials(null);
          resetPasswordMutation.mutate(selectedStudent.id);
        }}
      />
    </div>
  );
}
