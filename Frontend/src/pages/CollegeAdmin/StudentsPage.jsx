import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { parseSpreadsheetRows } from "@/lib/spreadsheet";

const IMPORT_SAMPLE = [
  "fullName,email,enrollNumber,department,year,batch",
  "Alice Doe,alice@example.com,20261001,Computer Science,1,CSE-2027-A",
].join("\n");
const YEAR_OPTIONS = ["1", "2", "3", "4"];
const YEAR_PROMOTION_CONFIRMATION = "PROMOTE STUDENTS YEAR";

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

export default function CollegeAdminStudentsPage() {
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
  const [yearPromotionConfirmation, setYearPromotionConfirmation] = useState("");
  const [yearPromotionVerified, setYearPromotionVerified] = useState(false);

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
    queryKey: ["college-admin-students", search, page, directoryFilters.departmentId, directoryFilters.batchId, directoryFilters.year],
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
  });

  const studentProfileQuery = useQuery({
    queryKey: ["college-admin-student-profile", selectedStudentId],
    queryFn: () => adminApi.getStudentProfile(selectedStudentId),
    enabled: Boolean(selectedStudentId),
  });

  const batchesQuery = useQuery({
    queryKey: ["college-admin-batches-for-students"],
    queryFn: adminApi.getBatches,
  });

  const departmentsQuery = useQuery({
    queryKey: ["college-admin-departments-for-students"],
    queryFn: adminApi.getDepartments,
  });

  const assignBatchMutation = useMutation({
    mutationFn: ({ studentId, batchId }) => adminApi.assignStudentBatch(studentId, { batchId }),
    onSuccess: () => {
      toast.success("Batch assigned.");
      setBanner({ type: "success", title: "Batch updated", message: "Student has been added to the selected batch." });
      queryClient.invalidateQueries({ queryKey: ["college-admin-students"] });
      queryClient.invalidateQueries({ queryKey: ["college-admin-student-profile", selectedStudentId] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Assign failed", message: error?.message || "Could not assign student to this batch." });
      toast.error(error?.message || "Failed to assign batch.");
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
      setBanner({ type: "success", title: "Import completed", message: `Created: ${created} | Failed: ${failed} | Duplicates: ${duplicates}` });
      queryClient.invalidateQueries({ queryKey: ["college-admin-students"] });
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
      queryClient.invalidateQueries({ queryKey: ["college-admin-students"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Create student failed", message: error?.message || "Unable to create student account." });
      toast.error(error?.message || "Unable to create student account");
    },
  });

  const promoteStudentsYearMutation = useMutation({
    mutationFn: (body) => adminApi.promoteStudentsYear(body),
    onSuccess: (payload) => {
      const summary = payload?.summary || {};
      toast.success("Student years updated");
      setBanner({
        type: "success",
        title: "Year updated",
        message: `1st->2nd: ${summary.year1To2 || 0} | 2nd->3rd: ${summary.year2To3 || 0} | 3rd->4th: ${summary.year3To4 || 0} | alumni: ${summary.alumniPrior4 || 0}`,
      });
      setYearPromotionConfirmation("");
      setYearPromotionVerified(false);
      queryClient.invalidateQueries({ queryKey: ["college-admin-students"] });
      queryClient.invalidateQueries({ queryKey: ["college-admin-student-profile", selectedStudentId] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Year update failed", message: error?.message || "Unable to promote student years." });
      toast.error(error?.message || "Unable to promote student years");
    },
  });

  const importJobQuery = useQuery({
    queryKey: ["college-admin-student-import-job", activeImportJobId],
    queryFn: () => adminApi.getStudentImportJobStatus(activeImportJobId),
    enabled: Boolean(activeImportJobId),
    refetchInterval: (query) => {
      const status = query?.state?.data?.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });

  const students = useMemo(() => studentsQuery.data?.data || [], [studentsQuery.data]);
  const studentPagination = studentsQuery.data?.pagination;
  const batches = useMemo(() => Array.isArray(batchesQuery.data) ? batchesQuery.data : batchesQuery.data?.data || [], [batchesQuery.data]);
  const departments = useMemo(() => Array.isArray(departmentsQuery.data) ? departmentsQuery.data : departmentsQuery.data?.data || [], [departmentsQuery.data]);

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
      queryClient.invalidateQueries({ queryKey: ["college-admin-students"] });
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

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"} className={banner.type === "warning" ? "border-warning/30 bg-warning/10 text-warning" : ""}>
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Create Student Account</CardTitle>
          <CardDescription>College admins can create student credentials directly without self-registration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              placeholder="Full name"
              value={studentForm.fullName}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, fullName: event.target.value }))}
            />
            <Input
              type="email"
              placeholder="Email"
              value={studentForm.email}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={studentForm.department}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, department: event.target.value }))}
            >
              <option value="">Select department</option>
              {Array.isArray(departments) && departments.map((department) => (
                <option key={department.id} value={department.name}>{department.name}</option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={studentForm.year}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, year: event.target.value }))}
            >
              <option value="">Select Year</option>
              <option value="1">1 YEAR</option>
              <option value="2">2 YEAR</option>
              <option value="3">3 YEAR</option>
              <option value="4">4 YEAR</option>
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={studentForm.batch}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, batch: event.target.value }))}
            >
              <option value="">Select batch (optional)</option>
              {Array.isArray(batches)
                ? batches
                    .filter((batch) => {
                      if (!studentForm.department) return true;
                      const selected = String(studentForm.department).toLowerCase();
                      const batchDeptName = String(batch.department?.name || "").toLowerCase();
                      return (
                        String(batch.departmentId) === String(studentForm.department) ||
                        String(batch.department?.id) === String(studentForm.department) ||
                        (batchDeptName && batchDeptName === selected)
                      );
                    })
                    .map((batch) => (
                      <option key={batch.id} value={batch.id}>{batch.name}</option>
                    ))
                : null}
            </select>
            <Input
              placeholder="Enroll number"
              value={studentForm.enrollNumber}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, enrollNumber: event.target.value }))}
            />
          </div>
          <p className="text-xs text-text-secondary">Student ID uses the entered enroll number exactly. Password rule: First 3 letters of full name (first letter capitalized) + @ + last 3 digits of enroll number.</p>
          <Button
            className="w-full sm:w-auto"
            onClick={() => createStudentMutation.mutate({
              ...studentForm,
              year: studentForm.year ? Number(studentForm.year) : undefined,
            })}
            disabled={
              createStudentMutation.isPending ||
              !studentForm.fullName.trim() ||
              !studentForm.email.trim() ||
              !studentForm.department.trim() ||
              !studentForm.year ||
              !studentForm.enrollNumber.trim()
            }
          >
            {createStudentMutation.isPending ? "Creating..." : "Create Student"}
          </Button>
          {createdCredentials ? (
            <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
              <p className="font-semibold">Student credentials</p>
              <p>Email: {createdCredentials.identifier}</p>
              <p>Student ID: {createdCredentials.studentId}</p>
              <p>Password: {createdCredentials.password}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Bulk Import (Excel/CSV)</CardTitle>
          <CardDescription>Upload .xlsx/.csv file or paste CSV. Runs as async job and supports large imports.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border bg-background p-3 text-xs text-text-secondary">
            <p className="font-semibold text-text-secondary">Excel format (first row headers):</p>
            <p className="mt-1">fullName, email, enrollNumber, department, year, batch</p>
            <p className="mt-1">Student ID will use the enrollNumber value exactly.</p>
            <p className="mt-1">Example: Alice Doe, alice@example.com, 20261001, Computer Science, 1, CSE-2027-A</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <Input type="file" accept=".xlsx,.csv" onChange={handleImportFile} className="w-full" />
            {importFileName ? <p className="text-xs text-text-secondary">Loaded: {importFileName}</p> : null}
          </div>
          <Textarea rows={8} value={csvData} onChange={(event) => setCsvData(event.target.value)} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button className="w-full sm:w-auto" onClick={() => importMutation.mutate({ csvData })} disabled={importMutation.isPending}>
              {importMutation.isPending ? "Queueing..." : "Start Import"}
            </Button>
            {activeImportJobId ? <p className="break-all text-xs text-text-secondary">Job: {activeImportJobId}</p> : null}
          </div>

          {importJobQuery.data ? (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium text-text-primary">Status: {String(importJobQuery.data.status || "unknown").toUpperCase()}</p>
              {importJobQuery.data.result ? (
                <p className="mt-1 text-text-secondary">
                  Created: {importJobQuery.data.result.created || 0} | Failed: {importJobQuery.data.result.failed || 0} | Duplicates: {importJobQuery.data.result.duplicates || 0}
                </p>
              ) : null}
              {importJobQuery.data.error ? <p className="mt-1 text-danger">Error: {importJobQuery.data.error}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>College Student Directory</CardTitle>
          <CardDescription>Search college students, inspect profiles, assign batches, and monitor import jobs.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Input placeholder="Search by name/email" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={directoryFilters.departmentId}
              onChange={(event) => {
                setDirectoryFilters((prev) => ({ ...prev, departmentId: event.target.value }));
                setPage(1);
              }}
            >
              <option value="">All college departments</option>
              {Array.isArray(departments) && departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={directoryFilters.batchId}
              onChange={(event) => {
                setDirectoryFilters((prev) => ({ ...prev, batchId: event.target.value }));
                setPage(1);
              }}
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
              className="h-10 rounded-md border border-border px-3 text-sm"
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
            <Button className="w-full" variant="outline" onClick={() => studentsQuery.refetch()}>Search</Button>
          </div>
          <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <div className="space-y-2">
              {studentsQuery.isLoading ? (
                <div className="space-y-2">
                  <SkeletonBlock className="h-16" />
                  <SkeletonBlock className="h-16" />
                  <SkeletonBlock className="h-16" />
                </div>
              ) : null}
              {!studentsQuery.isLoading && students.length === 0 ? <p className="text-sm text-text-secondary">No students found for the selected college filters.</p> : null}
              {Array.isArray(students) && students.map((student) => {
                const batchLabel = Array.isArray(student.batches) && student.batches.length > 0
                  ? student.batches.map((batch) => batch.name).join(", ")
                  : (student.batch?.name || "-");

                return (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => {
                      setSelectedStudentId(student.id);
                      setBatchIdInput("");
                    }}
                    className={`flex w-full flex-col gap-3 rounded-xl border px-3 py-3 text-left sm:flex-row sm:items-center sm:justify-between ${selectedStudentId === student.id ? "border-primary/40 bg-primary/10" : "border-border"}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-primary">{student.fullName}</p>
                      <p className="mt-1 break-words text-xs leading-5 text-text-secondary">{student.email} | {student.studentId}</p>
                    </div>
                    <div className="min-w-0 text-xs text-text-secondary sm:text-right">
                      <p className="truncate">{student.department?.name || "-"}</p>
                      <p className="truncate sm:max-w-35">{batchLabel}</p>
                    </div>
                  </button>
                );
              })}
              {(studentPagination?.totalPages || 1) > 1 ? (
                <div className="flex flex-col gap-3 border-t border-border pt-3 text-xs text-text-secondary sm:flex-row sm:items-center sm:justify-between">
                  <p>Page {studentPagination?.page || page} of {studentPagination?.totalPages || 1}</p>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                    <Button className="w-full sm:w-auto" variant="outline" size="sm" disabled={(studentPagination?.page || page) <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                    <Button className="w-full sm:w-auto" variant="outline" size="sm" disabled={(studentPagination?.page || 1) >= (studentPagination?.totalPages || 1)} onClick={() => setPage((prev) => prev + 1)}>Next</Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-3 rounded-xl border border-border p-3">
              {studentProfileQuery.isLoading ? (
                <div className="space-y-2">
                  <SkeletonBlock className="h-6" />
                  <SkeletonBlock className="h-6" />
                  <SkeletonBlock className="h-10" />
                </div>
              ) : null}
              {!selectedStudent ? <p className="text-sm text-text-secondary">Select a student for profile details.</p> : null}
              {selectedStudent ? (
                <>
                  <p className="text-base font-semibold text-text-primary">{selectedStudent.fullName}</p>
                  <p className="break-words text-xs leading-5 text-text-secondary">{selectedStudent.email} | {selectedStudent.studentId}</p>
                  <p className="text-xs text-text-secondary">Department: {selectedStudent.department?.name || "-"}</p>
                  <p className="text-xs text-text-secondary">Year: {selectedStudent.year ? `${selectedStudent.year} YEAR` : "-"}</p>
                  <p className="text-xs text-text-secondary">Total submissions: {selectedStudent._count?.submissions || 0}</p>
                  {Array.isArray(selectedStudent.batches) && selectedStudent.batches.length > 0 ? (
                    <div className="border-t border-border pt-2">
                      <p className="mb-2 text-xs font-medium text-text-primary">Assigned batches:</p>
                      <div className="space-y-1">
                        {selectedStudent.batches.map((batch) => (
                          <div key={batch.id} className="flex items-center justify-between rounded-md bg-primary/5 px-2 py-1 text-xs">
                            <span className="min-w-0 break-words text-text-primary">{batch.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-text-secondary italic">No batches assigned yet</p>
                  )}

                    <div className="grid gap-2 border-t border-border pt-2 md:grid-cols-3">
                    <select className="h-10 rounded-md border border-border px-3 text-sm md:col-span-2" value={batchIdInput} onChange={(event) => setBatchIdInput(event.target.value)}>
                      <option value="">Select batch to add</option>
                      {Array.isArray(batches) && batches.map((batch) => (
                        <option key={batch.id} value={batch.id}>{batch.name} ({batch.department?.name || "-"})</option>
                      ))}
                    </select>
                    <Button
                      className="w-full"
                      onClick={() => assignBatchMutation.mutate({ studentId: selectedStudent.id, batchId: batchIdInput })}
                      disabled={assignBatchMutation.isPending || !batchIdInput}
                    >
                      Add Batch
                    </Button>
                  </div>

                </>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Year Updater</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTitle>Confirmation required</AlertTitle>
            <AlertDescription>
              This action promotes the entire college one year forward. 1st year becomes 2nd, 2nd becomes 3rd, 3rd becomes 4th, and 4th year students stay active.
            </AlertDescription>
          </Alert>
          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-text-secondary uppercase">Step 1: type the confirmation text</p>
              <Input
                value={yearPromotionConfirmation}
                onChange={(event) => {
                  setYearPromotionConfirmation(event.target.value);
                  setYearPromotionVerified(false);
                }}
                placeholder={YEAR_PROMOTION_CONFIRMATION}
                className="w-full md:max-w-md"
              />
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-3 py-3 text-sm text-text-secondary">
              <Checkbox
                checked={yearPromotionVerified}
                onCheckedChange={(checked) => setYearPromotionVerified(Boolean(checked))}
                className="mt-0.5"
              />
              <span>
                Step 2: I have verified that this is the annual promotion action for the whole college and understand that 4th year students remain active.
              </span>
            </label>
            <div className="flex flex-col gap-2 text-xs text-text-secondary sm:flex-row sm:items-center sm:justify-between">
              <p>Verification text must exactly match: {YEAR_PROMOTION_CONFIRMATION}</p>
              <Button
                className="w-full sm:w-auto"
                variant="destructive"
                onClick={() => promoteStudentsYearMutation.mutate({ confirmationText: yearPromotionConfirmation })}
                disabled={
                  promoteStudentsYearMutation.isPending ||
                  !yearPromotionVerified ||
                  yearPromotionConfirmation.trim() !== YEAR_PROMOTION_CONFIRMATION
                }
              >
                {promoteStudentsYearMutation.isPending ? "Updating..." : "Promote All Students"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      
    </div>
  );
}
