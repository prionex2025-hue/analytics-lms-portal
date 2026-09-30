import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchSuperColleges,
  fetchSuperStudents,
} from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, FileUp, GraduationCap, KeyRound, Pencil, Search, Trash2, UserPlus, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Callout, CredentialList, CredentialPanel, DataTable, EmptyState, FormField, MiniStat, Modal, PageHeader, PaginationBar, SearchInput, SectionCard, StatusBadge } from "@/components/common/page-kit";
import { ui } from "@/styles/ui-tokens";

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
  const [importCredentials, setImportCredentials] = useState(null);
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
      setImportCredentials(importJobQuery.data.result?.credentials || null);
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

  const bannerTone = banner.type === "error" ? "danger" : banner.type === "warning" ? "warning" : "success";
  const activeColleges = colleges.filter((college) => college?.isActive !== false);
  const yearSelect = (id, value, onChange) => (
    <select id={id} className="ui-select w-full" value={value} onChange={onChange}>
      <option value="">Select Year</option>
      <option value="1">1 YEAR</option>
      <option value="2">2 YEAR</option>
      <option value="3">3 YEAR</option>
      <option value="4">4 YEAR</option>
    </select>
  );

  const studentColumns = [
    {
      key: "student",
      header: "Student",
      primary: true,
      cell: (student) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-text-primary">{student.fullName}</p>
          <p className="truncate text-xs text-text-secondary">{student.email}</p>
        </div>
      ),
    },
    { key: "studentId", header: "Student ID", className: "font-mono text-xs text-text-secondary", cell: (student) => student.studentId || "—" },
    { key: "college", header: "College", className: "max-w-56 truncate text-text-secondary", cell: (student) => student.college?.name || "—" },
    { key: "year", header: "Year", cell: (student) => (student.year ? <StatusBadge tone="neutral">Year {student.year}</StatusBadge> : "—") },
    {
      key: "actions",
      actions: true,
      align: "right",
      cell: (student) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button size="lg" variant="outline" className="rounded-lg" onClick={() => openEditForm(student)}>
            <Pencil className="size-4" />
            Edit
          </Button>
          <Button size="lg" variant="ghost" className="rounded-lg" onClick={() => openResetConfirm(student)} disabled={resetPasswordMutation.isPending}>
            <KeyRound className="size-4" />
            Reset Password
          </Button>
          <Button size="lg" variant="ghost" className="rounded-lg text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setPendingDelete(student)}>
            <Trash2 className="size-4" />
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Students" description="Find, create, import, and promote student accounts across every college." />

      {banner.type ? (
        <Callout tone={bannerTone} title={banner.title}>
          {banner.message}
        </Callout>
      ) : null}

      <Tabs defaultValue="directory" className="gap-5">
        <div className="relative -mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">
        <TabsList variant="line" className="h-auto! w-full min-w-max justify-start gap-6 rounded-none border-b border-border p-0">
          <TabsTrigger value="directory" className="flex-none rounded-none px-0.5 pt-1 pb-3 text-text-secondary data-active:text-primary after:!bottom-[-1px] after:!bg-primary">
            <Users className="size-4" />
            Directory
          </TabsTrigger>
          <TabsTrigger value="create" className="flex-none rounded-none px-0.5 pt-1 pb-3 text-text-secondary data-active:text-primary after:!bottom-[-1px] after:!bg-primary">
            <UserPlus className="size-4" />
            Add student
          </TabsTrigger>
          <TabsTrigger value="import" className="flex-none rounded-none px-0.5 pt-1 pb-3 text-text-secondary data-active:text-primary after:!bottom-[-1px] after:!bg-primary">
            <FileUp className="size-4" />
            Bulk import
          </TabsTrigger>
          <TabsTrigger value="promote" className="flex-none rounded-none px-0.5 pt-1 pb-3 text-text-secondary data-active:text-primary after:!bottom-[-1px] after:!bg-primary">
            <GraduationCap className="size-4" />
            Year promotion
          </TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="directory">
          <SectionCard
            flush
            title="Global students"
            description="Students are listed per college."
            footer={
              (studentTotalPages || 1) > 1 ? (
                <PaginationBar
                  page={studentCurrentPage}
                  pages={studentTotalPages || 1}
                  onPageChange={(nextPage) => {
                    setPage(nextPage);
                    loadStudents(nextPage);
                  }}
                />
              ) : null
            }
          >
            <form
              className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                if (filters.collegeId) runSearch();
              }}
            >
              <SearchInput
                className="sm:col-span-2 lg:col-span-1"
                label="Search students"
                placeholder="Search"
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              />
              <select
                aria-label="College"
                className="ui-select w-full"
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
                aria-label="Department"
                className="ui-select w-full"
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
                  {filters.collegeId ? (filterDepartmentsQuery.isLoading ? "Loading departments..." : "All departments") : "Select college first"}
                </option>
                {filters.collegeId &&
                  filterDepartments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Batch"
                className="ui-select w-full"
                value={filters.batchId}
                onChange={(e) => setFilters((prev) => ({ ...prev, batchId: e.target.value }))}
                disabled={!filters.collegeId || filterBatchesQuery.isLoading}
              >
                <option value="">
                  {filters.collegeId ? (filterBatchesQuery.isLoading ? "Loading batches..." : "All batches") : "Select college first"}
                </option>
                {filters.collegeId &&
                  filteredFilterBatches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.name}
                    </option>
                  ))}
              </select>
              <select aria-label="Year" className="ui-select w-full" value={filters.year} onChange={(e) => setFilters((prev) => ({ ...prev, year: e.target.value }))}>
                <option value="">All years</option>
                {YEAR_OPTIONS.map((year) => (
                  <option key={year} value={year}>
                    {year} YEAR
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" className={ui.btn} disabled={!filters.collegeId}>
                <Search className="size-4" />
                Search
              </Button>
            </form>

            {!filters.collegeId ? (
              <EmptyState icon={Users} title="Select a college" description="Choose a college in the filters above to view its students." className="border-0" />
            ) : (
              <DataTable
                columns={studentColumns}
                rows={visibleStudents}
                getRowKey={(student) => student.id}
                minWidth={880}
                caption="Students"
                empty={<EmptyState icon={Users} title="No students found" description="Try adjusting the department, batch, year, or search." className="border-0" />}
              />
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="create">
          <SectionCard title="Create student account" description="Super Admin can create student accounts manually across colleges.">
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                createStudentMutation.mutate({
                  fullName: studentForm.fullName,
                  email: studentForm.email,
                  enrollNumber: studentForm.enrollNumber,
                  ...(studentForm.year ? { year: Number(studentForm.year) } : {}),
                  collegeId: studentForm.collegeId,
                  departmentId: studentForm.departmentId,
                  ...(studentForm.batchId ? { batchId: studentForm.batchId } : {}),
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <FormField label="Full name" htmlFor="student-create-name" required>
                  <Input id="student-create-name" className={ui.field} value={studentForm.fullName} onChange={(event) => setStudentForm((prev) => ({ ...prev, fullName: event.target.value }))} />
                </FormField>
                <FormField label="Email" htmlFor="student-create-email" required>
                  <Input id="student-create-email" type="email" autoComplete="off" className={ui.field} value={studentForm.email} onChange={(event) => setStudentForm((prev) => ({ ...prev, email: event.target.value }))} />
                </FormField>
                <FormField label="Enroll number" htmlFor="student-create-enroll" hint="Used exactly as the Student ID." required>
                  <Input id="student-create-enroll" className={ui.field} value={studentForm.enrollNumber} onChange={(event) => setStudentForm((prev) => ({ ...prev, enrollNumber: event.target.value }))} />
                </FormField>
                <FormField label="Year" htmlFor="student-create-year" required>
                  {yearSelect("student-create-year", studentForm.year, (event) => setStudentForm((prev) => ({ ...prev, year: event.target.value })))}
                </FormField>
                <FormField label="College" htmlFor="student-create-college" required>
                  <select
                    id="student-create-college"
                    className="ui-select w-full"
                    value={studentForm.collegeId}
                    onChange={(event) => setStudentForm((prev) => ({ ...prev, collegeId: event.target.value, departmentId: "", batchId: "" }))}
                  >
                    <option value="">Select college</option>
                    {activeColleges.map((college) => (
                      <option key={college.id} value={college.id}>
                        {college.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Department" htmlFor="student-create-department" required>
                  <select
                    id="student-create-department"
                    className="ui-select w-full"
                    value={studentForm.departmentId}
                    onChange={(event) => setStudentForm((prev) => ({ ...prev, departmentId: event.target.value, batchId: "" }))}
                    disabled={!studentForm.collegeId || departmentsQuery.isLoading}
                  >
                    <option value="">
                      {studentForm.collegeId ? (departmentsQuery.isLoading ? "Loading departments..." : "Select department") : "Select college first"}
                    </option>
                    {studentForm.collegeId &&
                      departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                  </select>
                </FormField>
                <FormField label="Batch" htmlFor="student-create-batch" hint="Optional">
                  <select
                    id="student-create-batch"
                    className="ui-select w-full"
                    value={studentForm.batchId}
                    onChange={(event) => setStudentForm((prev) => ({ ...prev, batchId: event.target.value }))}
                    disabled={!studentForm.collegeId || batchesQuery.isLoading}
                  >
                    <option value="">
                      {studentForm.collegeId ? (batchesQuery.isLoading ? "Loading batches..." : "Select batch (optional)") : "Select college first"}
                    </option>
                    {studentForm.collegeId &&
                      filteredBatches.map((batch) => (
                        <option key={batch.id} value={batch.id}>
                          {batch.name}
                        </option>
                      ))}
                  </select>
                </FormField>
              </div>

              <Callout tone="info" icon={KeyRound}>
                Student ID uses the entered enroll number exactly. Password rule: first 3 letters of full name (first letter capitalized) + @ + last 3 digits of enroll number.
              </Callout>

              <Button
                type="submit"
                className={ui.btn}
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
                <UserPlus className="size-4" />
                {createStudentMutation.isPending ? "Creating..." : "Create Student"}
              </Button>
            </form>

            <CredentialPanel className="mt-5" title="Student created — share these credentials securely" credentials={createdCredentials} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="import">
          <SectionCard title="Bulk import (Excel/CSV)" description="Upload .xlsx/.csv file or paste CSV for the selected college.">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Target college" htmlFor="student-import-college" required>
                  <select
                    id="student-import-college"
                    className="ui-select w-full"
                    value={filters.collegeId}
                    onChange={(event) => setFilters((prev) => ({ ...prev, collegeId: event.target.value }))}
                  >
                    <option value="">Select target college</option>
                    {activeColleges.map((college) => (
                      <option key={college.id} value={college.id}>
                        {college.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Spreadsheet file" htmlFor="student-import-file" hint={importFileName ? `Loaded: ${importFileName}` : ".xlsx or .csv"}>
                  <Input id="student-import-file" type="file" accept=".xlsx,.csv" className="h-10 rounded-lg" onChange={handleImportFile} />
                </FormField>
              </div>

              <FormField
                label="CSV data"
                htmlFor="student-import-csv"
                hint="Required columns: fullName, email, enrollNumber, department, year. Student ID will use enrollNumber exactly. Optional: batch."
              >
                <Textarea id="student-import-csv" rows={8} className="rounded-lg font-mono text-xs" value={csvData} onChange={(event) => setCsvData(event.target.value)} />
              </FormField>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  className={ui.btn}
                  onClick={() => importMutation.mutate({ csvData, collegeId: filters.collegeId })}
                  disabled={importMutation.isPending || !filters.collegeId || !csvData.trim()}
                >
                  <FileUp className="size-4" />
                  {importMutation.isPending ? "Queueing..." : "Start Import"}
                </Button>
                {activeImportJobId ? <p className="font-mono text-xs text-text-secondary">Job: {activeImportJobId}</p> : null}
              </div>

              {importJobQuery.data ? (
                <div className="space-y-3 rounded-lg border border-border p-4" role="status">
                  <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    Status
                    <StatusBadge
                      tone={
                        String(importJobQuery.data.status || "").toLowerCase() === "completed"
                          ? "success"
                          : String(importJobQuery.data.status || "").toLowerCase() === "failed"
                            ? "danger"
                            : "info"
                      }
                    >
                      {String(importJobQuery.data.status || "unknown").toUpperCase()}
                    </StatusBadge>
                  </p>
                  {importJobQuery.data.result ? (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <MiniStat label="Created" value={importJobQuery.data.result.created || 0} tone="success" />
                        <MiniStat label="Failed" value={importJobQuery.data.result.failed || 0} tone={importJobQuery.data.result.failed ? "danger" : undefined} />
                        <MiniStat label="Duplicates" value={importJobQuery.data.result.duplicates || 0} />
                      </div>
                      {Array.isArray(importJobQuery.data.result.errors) && importJobQuery.data.result.errors.length > 0 ? (
                        <Callout tone="warning" title="Rows with errors">
                          <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs">
                            {importJobQuery.data.result.errors.slice(0, 10).map((item, index) => (
                              <li key={`${item.row || "row"}-${index}`}>
                                Row {item.row || "?"}: {item.reason || "Invalid data"}
                              </li>
                            ))}
                          </ul>
                        </Callout>
                      ) : null}
                    </>
                  ) : null}
                  {importJobQuery.data.error ? <Callout tone="danger">Error: {importJobQuery.data.error}</Callout> : null}
                  <CredentialList entries={importCredentials} />
                </div>
              ) : null}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="promote">
          <SectionCard title="Promote student years" description="Moves every student in the selected college up one year.">
            <div className="max-w-2xl space-y-4">
              <Callout tone="danger" icon={AlertTriangle} title="This affects every student in the college">
                Prior 4th-year accounts will move to alumni status. Double-check the college before confirming.
              </Callout>
              <FormField label="College" htmlFor="promote-college" required>
                <select id="promote-college" className="ui-select w-full" value={yearPromotionCollegeId} onChange={(event) => setYearPromotionCollegeId(event.target.value)}>
                  <option value="">Select college</option>
                  {activeColleges.map((college) => (
                    <option key={college.id} value={college.id}>
                      {college.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                label="Confirmation phrase"
                htmlFor="promote-confirmation"
                hint={`Type ${YEAR_PROMOTION_CONFIRMATION} exactly.`}
                required
              >
                <Input
                  id="promote-confirmation"
                  autoComplete="off"
                  spellCheck={false}
                  className={`${ui.field} font-mono`}
                  placeholder="Type PROMOTE STUDENTS YEAR"
                  value={yearPromotionConfirmation}
                  onChange={(event) => setYearPromotionConfirmation(event.target.value)}
                />
              </FormField>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                <Checkbox className="mt-0.5" checked={yearPromotionVerified} onCheckedChange={(checked) => setYearPromotionVerified(Boolean(checked))} />
                <span className="text-sm text-text-primary">I understand prior 4th-year accounts will move to alumni status.</span>
              </label>
              <Button
                variant="destructive"
                className={ui.btn}
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
                <GraduationCap className="size-4" />
                {promoteStudentsYearMutation.isPending ? "Updating..." : "Promote Years for Selected College"}
              </Button>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <Modal
        open={Boolean(editingStudent)}
        onOpenChange={(open) => {
          if (!open) setEditingStudent(null);
        }}
        size="xl"
        title={`Edit Student - ${editingStudent?.fullName || ""}`}
        description="Update student information"
        footer={
          <>
            <Button variant="outline" className={ui.btn} onClick={() => setEditingStudent(null)} disabled={updateStudentMutation.isPending}>
              Cancel
            </Button>
            <Button className={ui.btn} onClick={handleEditSubmit} disabled={updateStudentMutation.isPending}>
              {updateStudentMutation.isPending ? "Updating..." : "Save Changes"}
            </Button>
          </>
        }
      >
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            handleEditSubmit();
          }}
        >
          <FormField label="Full name" htmlFor="student-edit-name">
            <Input id="student-edit-name" className={ui.field} value={editFormData.fullName} onChange={(event) => setEditFormData((prev) => ({ ...prev, fullName: event.target.value }))} />
          </FormField>
          <FormField label="Email" htmlFor="student-edit-email">
            <Input id="student-edit-email" type="email" className={ui.field} value={editFormData.email} onChange={(event) => setEditFormData((prev) => ({ ...prev, email: event.target.value }))} />
          </FormField>
          <FormField label="Enroll number" htmlFor="student-edit-enroll">
            <Input id="student-edit-enroll" className={ui.field} value={editFormData.enrollNumber} onChange={(event) => setEditFormData((prev) => ({ ...prev, enrollNumber: event.target.value }))} />
          </FormField>
          <FormField label="Year" htmlFor="student-edit-year">
            {yearSelect("student-edit-year", editFormData.year, (event) => setEditFormData((prev) => ({ ...prev, year: event.target.value })))}
          </FormField>
          <FormField label="College" htmlFor="student-edit-college">
            <select
              id="student-edit-college"
              className="ui-select w-full"
              value={editFormData.collegeId}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, collegeId: event.target.value, departmentId: "", batchId: "" }))}
            >
              <option value="">Select college</option>
              {activeColleges.map((college) => (
                <option key={college.id} value={college.id}>
                  {college.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Department" htmlFor="student-edit-department">
            <select
              id="student-edit-department"
              className="ui-select w-full"
              value={editFormData.departmentId}
              onChange={(event) => setEditFormData((prev) => ({ ...prev, departmentId: event.target.value, batchId: "" }))}
            >
              <option value="">Select department</option>
              {editDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Batch" htmlFor="student-edit-batch" hint="Optional">
            <select id="student-edit-batch" className="ui-select w-full" value={editFormData.batchId} onChange={(event) => setEditFormData((prev) => ({ ...prev, batchId: event.target.value }))}>
              <option value="">Select batch (optional)</option>
              {filteredEditBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name}
                </option>
              ))}
            </select>
          </FormField>
        </form>
      </Modal>

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
