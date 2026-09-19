import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchSuperColleges,
  fetchSuperStudents,
} from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { X } from "lucide-react";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import { parseSpreadsheetRows } from "@/lib/spreadsheet";

const IMPORT_SAMPLE = [
  "fullName,email,enrollNumber,department,year,batch",
  "Alice Doe,alice@example.com,20261001,Computer Science,1,CSE-2027-A",
].join("\n");
const YEAR_OPTIONS = ["1", "2", "3", "4"];

const normalizeColumnKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

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
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
};

const unwrapItems = (response) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  return [];
};

const collegeScopedLimit = 50;
const studentPageLimit = 20;
const YEAR_PROMOTION_CONFIRMATION = "PROMOTE STUDENTS YEAR";

export default function StudentsPage() {
  const dispatch = useDispatch();
  const students = useSelector((state) => state.superAdminPanel.students);
  const studentPagination = useSelector(
    (state) => state.superAdminPanel.studentPagination,
  );
  const colleges = useSelector((state) => state.superAdminPanel.colleges);
  const [filters, setFilters] = useState({
    search: "",
    collegeId: "",
    departmentId: "",
    batchId: "",
    year: "",
  });
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [activeImportJobId, setActiveImportJobId] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [csvData, setCsvData] = useState(IMPORT_SAMPLE);
  const [pendingResetStudent, setPendingResetStudent] = useState(null);
  const [yearPromotionCollegeId, setYearPromotionCollegeId] = useState("");
  const [yearPromotionConfirmation, setYearPromotionConfirmation] =
    useState("");
  const [yearPromotionVerified, setYearPromotionVerified] = useState(false);
  const [studentForm, setStudentForm] = useState({
    fullName: "",
    email: "",
    enrollNumber: "",
    year: "",
    collegeId: "",
    departmentId: "",
    batchId: "",
  });
  const [editFormData, setEditFormData] = useState({
    fullName: "",
    email: "",
    enrollNumber: "",
    year: "",
    collegeId: "",
    departmentId: "",
    batchId: "",
  });
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const createCollegeId = studentForm.collegeId;

  useEffect(() => {
    dispatch(fetchSuperColleges());
  }, [dispatch]);

  const departmentsQuery = useQuery({
    queryKey: ["super-student-departments", createCollegeId],
    queryFn: () => {
      const params = `?collegeId=${encodeURIComponent(createCollegeId)}&limit=${collegeScopedLimit}`;
      return superAdminApi.getDepartments(params);
    },
    enabled: Boolean(createCollegeId),
  });

  const batchesQuery = useQuery({
    queryKey: ["super-student-batches", createCollegeId],
    queryFn: () => {
      const params = `?collegeId=${encodeURIComponent(createCollegeId)}&limit=${collegeScopedLimit}`;
      return superAdminApi.getBatches(params);
    },
    enabled: Boolean(createCollegeId),
  });

  const importJobQuery = useQuery({
    queryKey: ["super-student-import-job", activeImportJobId],
    queryFn: () => superAdminApi.getStudentImportJobStatus(activeImportJobId),
    enabled: Boolean(activeImportJobId),
    refetchInterval: (query) => {
      const status = query?.state?.data?.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });

  const filterDepartmentsQuery = useQuery({
    queryKey: ["super-student-filter-departments", filters.collegeId],
    queryFn: () => {
      const params = `?collegeId=${encodeURIComponent(filters.collegeId)}&limit=${collegeScopedLimit}`;
      return superAdminApi.getDepartments(params);
    },
    enabled: Boolean(filters.collegeId),
  });

  const filterBatchesQuery = useQuery({
    queryKey: ["super-student-filter-batches", filters.collegeId],
    queryFn: () => {
      const params = `?collegeId=${encodeURIComponent(filters.collegeId)}&limit=${collegeScopedLimit}`;
      return superAdminApi.getBatches(params);
    },
    enabled: Boolean(filters.collegeId),
  });

  const rowsToCsv = (rows) => {
    const header = [
      "fullName",
      "email",
      "studentId",
      "enrollNumber",
      "department",
      "year",
      "batch",
    ];
    const lines = rows.map((row) => {
      const studentId = getRowValue(row, [
        "studentId",
        "student_id",
        "rollNo",
        "rollNumber",
        "roll",
      ]);
      const normalized = {
        fullName: getRowValue(row, [
          "fullName",
          "full_name",
          "name",
          "studentName",
          "student_name",
        ]),
        email: getRowValue(row, [
          "email",
          "emailAddress",
          "email_address",
          "eMail",
          "mail",
        ]),
        studentId,
        enrollNumber:
          getRowValue(row, [
            "enrollNumber",
            "enroll_number",
            "enrollmentNumber",
            "enrollment_no",
            "enrollmentNo",
          ]) || studentId,
        department: getRowValue(row, [
          "department",
          "departmentName",
          "department_name",
          "departmentId",
          "department_id",
          "branch",
          "branchName",
        ]),
        year: getRowValue(row, [
          "year",
          "studentYear",
          "student_year",
          "academicYear",
          "academic_year",
          "yearOfStudy",
          "year_of_study",
        ]),
        batch: getRowValue(row, [
          "batch",
          "batchName",
          "batch_name",
          "batchId",
          "batch_id",
          "section",
        ]),
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
      setBanner({
        type: "success",
        title: "File loaded",
        message:
          "Spreadsheet parsed successfully. Review rows and start import.",
      });
    } catch (error) {
      setBanner({
        type: "error",
        title: "File parse failed",
        message: error?.message || "Unable to parse spreadsheet file.",
      });
      toast.error(error?.message || "Unable to parse spreadsheet file");
    }

    event.target.value = "";
  };

  const loadStudents = useCallback(
    (targetPage = 1) => {
      if (!filters.collegeId.trim()) {
        setBanner({
          type: "warning",
          title: "Select a college",
          message: "Choose a college before loading students.",
        });
        return;
      }
      const params = new URLSearchParams();
      params.set("page", String(targetPage));
      params.set("limit", String(studentPageLimit));
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.collegeId.trim())
        params.set("collegeId", filters.collegeId.trim());
      if (filters.departmentId.trim())
        params.set("departmentId", filters.departmentId.trim());
      if (filters.batchId.trim()) params.set("batchId", filters.batchId.trim());
      if (filters.year.trim()) params.set("year", filters.year.trim());
      const query = params.toString() ? `?${params.toString()}` : "";
      dispatch(fetchSuperStudents(query));
    },
    [
      dispatch,
      filters.batchId,
      filters.collegeId,
      filters.departmentId,
      filters.search,
      filters.year,
    ],
  );

  const runSearch = useCallback(() => {
    setPage(1);
    loadStudents(1);
  }, [loadStudents]);

  const createStudentMutation = useMutation({
    mutationFn: (payload) => superAdminApi.createStudent(payload),
    onSuccess: (payload) => {
      setCreatedCredentials(payload.credentials || null);
      setStudentForm({
        fullName: "",
        email: "",
        enrollNumber: "",
        year: "",
        collegeId: "",
        departmentId: "",
        batchId: "",
      });
      setBanner({
        type: "success",
        title: "Student created",
        message: "Student account created with generated credentials.",
      });
      toast.success("Student account created");
      loadStudents(page);
    },
    onError: (error) => {
      setBanner({
        type: "error",
        title: "Create student failed",
        message: error?.message || "Unable to create student account.",
      });
      toast.error(error?.message || "Unable to create student account");
    },
  });

  const importMutation = useMutation({
    mutationFn: (payload) => superAdminApi.bulkImportStudents(payload),
    onSuccess: (payload) => {
      setActiveImportJobId(payload.jobId);
      setBanner({
        type: "success",
        title: "Import queued",
        message: "CSV processing started in background.",
      });
      toast.success("Import job queued");
    },
    onError: (error) => {
      setBanner({
        type: "error",
        title: "Import queue failed",
        message: error?.message || "Unable to queue import job.",
      });
      toast.error(error?.message || "Unable to queue import job");
    },
  });

  const updateStudentMutation = useMutation({
    mutationFn: (payload) =>
      superAdminApi.updateStudent(editingStudent?.id, payload),
    onSuccess: () => {
      setBanner({
        type: "success",
        title: "Student updated",
        message: "Student information has been updated successfully.",
      });
      toast.success("Student updated successfully");
      setEditingStudent(null);
      loadStudents(page);
    },
    onError: (error) => {
      setBanner({
        type: "error",
        title: "Update failed",
        message: error?.message || "Unable to update student.",
      });
      toast.error(error?.message || "Unable to update student");
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (studentId) => superAdminApi.resetStudentPassword(studentId),
    onSuccess: () => {
      toast.success("Student password reset to the default rule.");
      setBanner({
        type: "success",
        title: "Password reset",
        message: "Student password has been reset successfully.",
      });
      setPendingResetStudent(null);
    },
    onError: (error) => {
      setBanner({
        type: "error",
        title: "Reset failed",
        message: error?.message || "Unable to reset student password.",
      });
      toast.error(error?.message || "Unable to reset student password");
    },
  });

  const promoteStudentsYearMutation = useMutation({
    mutationFn: (body) => superAdminApi.promoteStudentsYear(body),
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
      setYearPromotionCollegeId("");
      loadStudents(page);
    },
    onError: (error) => {
      setBanner({
        type: "error",
        title: "Year update failed",
        message: error?.message || "Unable to promote student years.",
      });
      toast.error(error?.message || "Unable to promote student years");
    },
  });

  const deleteStudentHandler = async (student, confirmationText = null) => {
    try {
      await superAdminApi.deleteStudent(student.id, {
        ...(confirmationText ? { confirmationText } : {}),
      });
      setBanner({
        type: "success",
        title: "Student deleted",
        message: `${student.fullName} has been permanently deleted from the database.`,
      });
      toast.success("Student deleted successfully");
      loadStudents(page);
    } catch (error) {
      setBanner({
        type: "error",
        title: "Delete failed",
        message: error?.message || "Unable to delete student.",
      });
      toast.error(error?.message || "Unable to delete student");
    }
  };

  const openEditForm = (student) => {
    setEditingStudent(student);
    setEditFormData({
      fullName: student.fullName || "",
      email: student.email || "",
      enrollNumber: student.enrollNumber || student.studentId || "",
      year: student.year ? String(student.year) : "",
      collegeId: student.collegeId || "",
      departmentId: student.departmentId || "",
      batchId: student.batchId || "",
    });
  };

  const openResetConfirm = (student) => {
    setPendingResetStudent(student);
  };

  const handleEditSubmit = () => {
    if (
      !editFormData.fullName.trim() ||
      !editFormData.email.trim() ||
      !editFormData.enrollNumber.trim() ||
      !editFormData.year
    ) {
      toast.error("Please fill in all required fields");
      return;
    }
    updateStudentMutation.mutate({
      fullName: editFormData.fullName,
      email: editFormData.email,
      enrollNumber: editFormData.enrollNumber,
      ...(editFormData.year ? { year: Number(editFormData.year) } : {}),
      collegeId: editFormData.collegeId,
      departmentId: editFormData.departmentId,
      ...(editFormData.batchId ? { batchId: editFormData.batchId } : {}),
    });
  };

  useEffect(() => {
    if (!importJobQuery.data) return;

    if (importJobQuery.data.status === "completed") {
      setBanner({
        type: "success",
        title: "Import completed",
        message: "Refresh student list to review newly created accounts.",
      });
      loadStudents(page);
      return;
    }

    if (importJobQuery.data.status === "failed") {
      setBanner({
        type: "error",
        title: "Import failed",
        message:
          importJobQuery.data.error || "Import job failed during processing.",
      });
      return;
    }

    if (
      importJobQuery.data.status === "queued" ||
      importJobQuery.data.status === "processing"
    ) {
      setBanner({
        type: "warning",
        title: "Import in progress",
        message: "Job is still running. Results will appear shortly.",
      });
    }
  }, [importJobQuery.data, loadStudents, page]);

  useEffect(() => {
    if (filters.collegeId) {
      setPage(1);
      loadStudents(1);
    }
  }, [filters.collegeId, loadStudents]);

  const departments = useMemo(
    () => unwrapItems(departmentsQuery.data),
    [departmentsQuery.data],
  );
  const batches = useMemo(
    () => unwrapItems(batchesQuery.data),
    [batchesQuery.data],
  );
  const filterDepartments = useMemo(
    () => unwrapItems(filterDepartmentsQuery.data),
    [filterDepartmentsQuery.data],
  );
  const filterBatches = useMemo(
    () => unwrapItems(filterBatchesQuery.data),
    [filterBatchesQuery.data],
  );
  const visibleStudents = useMemo(
    () => (filters.collegeId ? students : []),
    [filters.collegeId, students],
  );
  const studentTotalPages = Number(
    studentPagination?.totalPages ?? studentPagination?.pages ?? 1,
  );
  const studentCurrentPage = Number(studentPagination?.page ?? page ?? 1);
  const filteredFilterBatches = useMemo(() => {
    if (!filters.departmentId) return filterBatches;
    return filterBatches.filter(
      (batch) => String(batch.departmentId) === String(filters.departmentId),
    );
  }, [filterBatches, filters.departmentId]);
  const filteredBatches = useMemo(() => {
    if (!studentForm.departmentId) return batches;
    return batches.filter(
      (batch) =>
        String(batch.departmentId) === String(studentForm.departmentId),
    );
  }, [batches, studentForm.departmentId]);

  const editDepartmentsQuery = useQuery({
    queryKey: ["super-edit-student-departments", editFormData.collegeId],
    queryFn: () => {
      const params = `?collegeId=${encodeURIComponent(editFormData.collegeId)}&limit=${collegeScopedLimit}`;
      return superAdminApi.getDepartments(params);
    },
    enabled: Boolean(editFormData.collegeId),
  });

  const editBatchesQuery = useQuery({
    queryKey: ["super-edit-student-batches", editFormData.collegeId],
    queryFn: () => {
      const params = `?collegeId=${encodeURIComponent(editFormData.collegeId)}&limit=${collegeScopedLimit}`;
      return superAdminApi.getBatches(params);
    },
    enabled: Boolean(editFormData.collegeId),
  });

  const editDepartments = useMemo(
    () => unwrapItems(editDepartmentsQuery.data),
    [editDepartmentsQuery.data],
  );
  const editBatches = useMemo(
    () => unwrapItems(editBatchesQuery.data),
    [editBatchesQuery.data],
  );
  const filteredEditBatches = useMemo(() => {
    if (!editFormData.departmentId) return editBatches;
    return editBatches.filter(
      (batch) =>
        String(batch.departmentId) === String(editFormData.departmentId),
    );
  }, [editBatches, editFormData.departmentId]);

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert
          variant={banner.type === "error" ? "destructive" : "default"}
          className={
            banner.type === "warning"
              ? "border-warning/30 bg-warning/10 text-warning"
              : ""
          }
        >
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Global Students</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-2 sm:grid-cols-6">
            <Input
              placeholder="Search"
              value={filters.search}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, search: e.target.value }))
              }
            />
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={filters.collegeId}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  collegeId: e.target.value,
                  departmentId: "",
                  batchId: "",
                }))
              }
            >
              <option value="">All colleges</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>
                  {college.name}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={filters.departmentId}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  departmentId: e.target.value,
                  batchId: "",
                }))
              }
              disabled={!filters.collegeId || filterDepartmentsQuery.isLoading}
            >
              <option value="">
                {filters.collegeId
                  ? filterDepartmentsQuery.isLoading
                    ? "Loading departments..."
                    : "All departments"
                  : "Select college first"}
              </option>
              {filters.collegeId &&
                filterDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={filters.batchId}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, batchId: e.target.value }))
              }
              disabled={!filters.collegeId || filterBatchesQuery.isLoading}
            >
              <option value="">
                {filters.collegeId
                  ? filterBatchesQuery.isLoading
                    ? "Loading batches..."
                    : "All batches"
                  : "Select college first"}
              </option>
              {filters.collegeId &&
                filteredFilterBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.name}
                  </option>
                ))}
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={filters.year}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, year: e.target.value }))
              }
            >
              <option value="">All years</option>
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>
                  {year} YEAR
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={runSearch}
              disabled={!filters.collegeId}
            >
              Search
            </Button>
          </div>
          <div className="space-y-2">
            {!filters.collegeId ? (
              <p className="text-sm text-text-secondary">
                Select a college to view students.
              </p>
            ) : null}
            {filters.collegeId && visibleStudents.length === 0 ? (
              <p className="text-sm text-text-secondary">No students found.</p>
            ) : null}
            {visibleStudents.map((student) => (
              <div
                key={student.id}
                className="flex flex-col gap-3 rounded-xl border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">
                    {student.fullName}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-text-secondary">
                    {student.email} • {student.studentId} •{" "}
                    {student.college?.name} • Year {student.year || "-"}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:flex sm:shrink-0 sm:items-center sm:justify-end">
                  <Button
                    className="w-full sm:w-auto"
                    size="sm"
                    variant="destructive"
                    onClick={() => openResetConfirm(student)}
                    disabled={resetPasswordMutation.isPending}
                  >
                    Reset Password
                  </Button>
                  <Button
                    size="sm"
                    className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 sm:w-auto"
                    onClick={() => openEditForm(student)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    className="w-full rounded-md bg-gray-600 px-4 py-2 text-white hover:bg-red-700 sm:w-auto"
                    onClick={() => setPendingDelete(student)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            {(studentTotalPages || 1) > 1 ? (
              <div className="flex flex-col gap-3 border-t border-border pt-3 text-xs text-text-secondary sm:flex-row sm:items-center sm:justify-between">
                <p>
                  Page {studentCurrentPage} of {studentTotalPages || 1}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                  <Button
                    className="w-full sm:w-auto"
                    variant="outline"
                    size="sm"
                    disabled={studentCurrentPage <= 1}
                    onClick={() => {
                      const nextPage = Math.max(studentCurrentPage - 1, 1);
                      setPage(nextPage);
                      loadStudents(nextPage);
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    className="w-full sm:w-auto"
                    variant="outline"
                    size="sm"
                    disabled={studentCurrentPage >= studentTotalPages}
                    onClick={() => {
                      const nextPage = studentCurrentPage + 1;
                      setPage(nextPage);
                      loadStudents(nextPage);
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Create Student Account</CardTitle>
          <CardDescription>
            Super Admin can create student accounts manually across colleges.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              placeholder="Full name"
              value={studentForm.fullName}
              onChange={(event) =>
                setStudentForm((prev) => ({
                  ...prev,
                  fullName: event.target.value,
                }))
              }
            />
            <Input
              type="email"
              placeholder="Email"
              value={studentForm.email}
              onChange={(event) =>
                setStudentForm((prev) => ({
                  ...prev,
                  email: event.target.value,
                }))
              }
            />
            <Input
              placeholder="Enroll number"
              value={studentForm.enrollNumber}
              onChange={(event) =>
                setStudentForm((prev) => ({
                  ...prev,
                  enrollNumber: event.target.value,
                }))
              }
            />
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={studentForm.year}
              onChange={(event) =>
                setStudentForm((prev) => ({
                  ...prev,
                  year: event.target.value,
                }))
              }
            >
              <option value="">Select Year</option>
              <option value="1">1 YEAR</option>
              <option value="2">2 YEAR</option>
              <option value="3">3 YEAR</option>
              <option value="4">4 YEAR</option>
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={studentForm.collegeId}
              onChange={(event) =>
                setStudentForm((prev) => ({
                  ...prev,
                  collegeId: event.target.value,
                  departmentId: "",
                  batchId: "",
                }))
              }
            >
              <option value="">Select college</option>
              {colleges
                .filter((college) => college?.isActive !== false)
                .map((college) => (
                  <option key={college.id} value={college.id}>
                    {college.name}
                  </option>
                ))}
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={studentForm.departmentId}
              onChange={(event) =>
                setStudentForm((prev) => ({
                  ...prev,
                  departmentId: event.target.value,
                  batchId: "",
                }))
              }
              disabled={!studentForm.collegeId || departmentsQuery.isLoading}
            >
              <option value="">
                {studentForm.collegeId
                  ? departmentsQuery.isLoading
                    ? "Loading departments..."
                    : "Select department"
                  : "Select college first"}
              </option>
              {studentForm.collegeId &&
                departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={studentForm.batchId}
              onChange={(event) =>
                setStudentForm((prev) => ({
                  ...prev,
                  batchId: event.target.value,
                }))
              }
              disabled={!studentForm.collegeId || batchesQuery.isLoading}
            >
              <option value="">
                {studentForm.collegeId
                  ? batchesQuery.isLoading
                    ? "Loading batches..."
                    : "Select batch (optional)"
                  : "Select college first"}
              </option>
              {studentForm.collegeId &&
                filteredBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.name}
                  </option>
                ))}
            </select>
          </div>
          <p className="text-xs text-text-secondary">
            Student ID uses the entered enroll number exactly. Password rule:
            first 3 letters of full name (first letter capitalized) + @ + last 3
            digits of enroll number.
          </p>
          <Button
            onClick={() =>
              createStudentMutation.mutate({
                fullName: studentForm.fullName,
                email: studentForm.email,
                enrollNumber: studentForm.enrollNumber,
                ...(studentForm.year ? { year: Number(studentForm.year) } : {}),
                collegeId: studentForm.collegeId,
                departmentId: studentForm.departmentId,
                ...(studentForm.batchId
                  ? { batchId: studentForm.batchId }
                  : {}),
              })
            }
            disabled={
              createStudentMutation.isPending ||
              !studentForm.fullName.trim() ||
              !studentForm.email.trim() ||
              !studentForm.enrollNumber.trim() ||
              !studentForm.year ||
              !studentForm.collegeId ||
              !studentForm.departmentId
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
          <CardDescription>
            Upload .xlsx/.csv file or paste CSV for the selected college.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={filters.collegeId}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  collegeId: event.target.value,
                }))
              }
            >
              <option value="">Select target college</option>
              {colleges
                .filter((college) => college?.isActive !== false)
                .map((college) => (
                  <option key={college.id} value={college.id}>
                    {college.name}
                  </option>
                ))}
            </select>
            <Input
              type="file"
              accept=".xlsx,.csv"
              onChange={handleImportFile}
            />
          </div>

          {importFileName ? (
            <p className="text-xs text-text-secondary">
              Loaded: {importFileName}
            </p>
          ) : null}
          <p className="text-xs text-text-secondary">
            Required columns: fullName, email, enrollNumber, department, year.
            Student ID will use enrollNumber exactly. Optional: batch.
          </p>

          <Textarea
            rows={8}
            value={csvData}
            onChange={(event) => setCsvData(event.target.value)}
          />

          <div className="flex items-center gap-2">
            <Button
              onClick={() =>
                importMutation.mutate({ csvData, collegeId: filters.collegeId })
              }
              disabled={
                importMutation.isPending ||
                !filters.collegeId ||
                !csvData.trim()
              }
            >
              {importMutation.isPending ? "Queueing..." : "Start Import"}
            </Button>
            {activeImportJobId ? (
              <p className="text-xs text-text-secondary">
                Job: {activeImportJobId}
              </p>
            ) : null}
          </div>

          {importJobQuery.data ? (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium text-text-primary">
                Status:{" "}
                {String(importJobQuery.data.status || "unknown").toUpperCase()}
              </p>
              {importJobQuery.data.result ? (
                <>
                  <p className="mt-1 text-text-secondary">
                    Created: {importJobQuery.data.result.created || 0} • Failed:{" "}
                    {importJobQuery.data.result.failed || 0} • Duplicates:{" "}
                    {importJobQuery.data.result.duplicates || 0}
                  </p>
                  {Array.isArray(importJobQuery.data.result.errors) &&
                  importJobQuery.data.result.errors.length > 0 ? (
                    <div className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-background p-2 text-xs text-text-secondary">
                      {importJobQuery.data.result.errors
                        .slice(0, 10)
                        .map((item, index) => (
                          <p key={`${item.row || "row"}-${index}`}>
                            Row {item.row || "?"}:{" "}
                            {item.reason || "Invalid data"}
                          </p>
                        ))}
                    </div>
                  ) : null}
                </>
              ) : null}
              {importJobQuery.data.error ? (
                <p className="mt-1 text-danger">
                  Error: {importJobQuery.data.error}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Promote Student Years</CardTitle>
          <CardDescription>
            Select a college and confirm before applying the year update.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={yearPromotionCollegeId}
              onChange={(event) =>
                setYearPromotionCollegeId(event.target.value)
              }
            >
              <option value="">Select college</option>
              {colleges
                .filter((college) => college?.isActive !== false)
                .map((college) => (
                  <option key={college.id} value={college.id}>
                    {college.name}
                  </option>
                ))}
            </select>
            <Input
              placeholder="Type PROMOTE STUDENTS YEAR"
              value={yearPromotionConfirmation}
              onChange={(event) =>
                setYearPromotionConfirmation(event.target.value)
              }
            />
            <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <Checkbox
                checked={yearPromotionVerified}
                onCheckedChange={(checked) =>
                  setYearPromotionVerified(Boolean(checked))
                }
              />
              <span className="text-sm text-text-secondary">
                I understand prior 4th-year accounts will move to alumni status.
              </span>
            </div>
          </div>

          <Button
            className="bg-danger/90 hover:bg-danger"
            disabled={
              promoteStudentsYearMutation.isPending ||
              !yearPromotionCollegeId ||
              !yearPromotionVerified ||
              yearPromotionConfirmation.trim() !== YEAR_PROMOTION_CONFIRMATION
            }
            onClick={() =>
              promoteStudentsYearMutation.mutate({
                collegeId: yearPromotionCollegeId,
                confirmationText: yearPromotionConfirmation,
              })
            }
          >
            {promoteStudentsYearMutation.isPending
              ? "Updating..."
              : "Promote Years for Selected College"}
          </Button>
        </CardContent>
      </Card>

      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-card border border-border shadow-lg">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card p-6 z-10">
              <div>
                <h2 className="text-xl font-semibold text-text-primary">
                  Edit Student - {editingStudent?.fullName}
                </h2>
                <p className="text-sm text-text-secondary mt-1">
                  Update student information
                </p>
              </div>
              <button
                onClick={() => setEditingStudent(null)}
                className="inline-flex items-center justify-center rounded-lg hover:bg-background p-2 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Input
                  placeholder="Full name"
                  value={editFormData.fullName}
                  onChange={(event) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      fullName: event.target.value,
                    }))
                  }
                />
                <Input
                  type="email"
                  placeholder="Email"
                  value={editFormData.email}
                  onChange={(event) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      email: event.target.value,
                    }))
                  }
                />
                <Input
                  placeholder="Enroll number"
                  value={editFormData.enrollNumber}
                  onChange={(event) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      enrollNumber: event.target.value,
                    }))
                  }
                />
                <select
                  className="h-10 rounded-md border border-border px-3 text-sm"
                  value={editFormData.year}
                  onChange={(event) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      year: event.target.value,
                    }))
                  }
                >
                  <option value="">Select Year</option>
                  <option value="1">1 YEAR</option>
                  <option value="2">2 YEAR</option>
                  <option value="3">3 YEAR</option>
                  <option value="4">4 YEAR</option>
                </select>
                <select
                  className="h-10 rounded-md border border-border px-3 text-sm"
                  value={editFormData.collegeId}
                  onChange={(event) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      collegeId: event.target.value,
                      departmentId: "",
                      batchId: "",
                    }))
                  }
                >
                  <option value="">Select college</option>
                  {colleges
                    .filter((college) => college?.isActive !== false)
                    .map((college) => (
                      <option key={college.id} value={college.id}>
                        {college.name}
                      </option>
                    ))}
                </select>
                <select
                  className="h-10 rounded-md border border-border px-3 text-sm"
                  value={editFormData.departmentId}
                  onChange={(event) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      departmentId: event.target.value,
                      batchId: "",
                    }))
                  }
                >
                  <option value="">Select department</option>
                  {editDepartments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
                <select
                  className="h-10 rounded-md border border-border px-3 text-sm"
                  value={editFormData.batchId}
                  onChange={(event) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      batchId: event.target.value,
                    }))
                  }
                >
                  <option value="">Select batch (optional)</option>
                  {filteredEditBatches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sticky bottom-0 border-t border-border bg-background p-6 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setEditingStudent(null)}
                disabled={updateStudentMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleEditSubmit}
                disabled={updateStudentMutation.isPending}
              >
                {updateStudentMutation.isPending
                  ? "Updating..."
                  : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <TypedConfirmDialog
        open={Boolean(pendingResetStudent)}
        onOpenChange={(open) => !open && setPendingResetStudent(null)}
        title="Reset Student Password"
        description={`Generate a new temporary password for ${pendingResetStudent?.fullName || "this student"}? The old password will stop working after refresh tokens are revoked.`}
        expectedText={`RESET ${pendingResetStudent?.studentId || pendingResetStudent?.id || ""}`}
        inputLabel="Type the exact phrase to confirm"
        confirmLabel="Reset Password"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (pendingResetStudent) {
            await resetPasswordMutation.mutateAsync(pendingResetStudent.id);
          }
        }}
      />

      <TypedConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete Student - Typed Confirmation Required"
        description={`Deleting ${pendingDelete?.fullName || "this student"} will permanently remove them and all associated data from the database. This action cannot be undone.`}
        expectedText={`DELETE ${pendingDelete?.studentId || pendingDelete?.id || ""}`}
        inputLabel="Type the exact phrase to confirm"
        confirmLabel="Permanently Delete Student"
        confirmVariant="destructive"
        onConfirm={async (typedText) => {
          if (pendingDelete) {
            await deleteStudentHandler(pendingDelete, typedText);
          }
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
