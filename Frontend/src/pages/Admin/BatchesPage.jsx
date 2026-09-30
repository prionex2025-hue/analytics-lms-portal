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
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronRight, ClipboardList, FileUp, GraduationCap, Layers3, Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import { Callout, DetailList, EmptyState, FormField, PageHeader, PaginationBar, SearchInput, SectionCard, StatusBadge } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";

const LINE_TAB = "flex-none rounded-none px-0.5 pt-1 pb-3 text-text-secondary data-active:text-primary after:!bottom-[-1px] after:!bg-primary";

const PAGE_SIZE = 8;

export default function BatchesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", year: new Date().getFullYear(), departmentId: "" });
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [bulkCsv, setBulkCsv] = useState("email,studentId\n");
  const [assignTest, setAssignTest] = useState({ testId: "", batchId: "", assignmentType: "department" });
  const [batchPage, setBatchPage] = useState(1);
  const [studentPage, setStudentPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [batchIdInput, setBatchIdInput] = useState("");
  const [bulkBatchId, setBulkBatchId] = useState("");
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(false);

  const admin = useAdminAuthState()?.admin;
  const adminDeptId = admin?.department?.id || admin?.departmentId || "";
  const canManageBatches = usePermission(ADMIN_PERMISSIONS.MANAGE_BATCHES);
  const canViewBatches = usePermission(ADMIN_PERMISSIONS.VIEW_BATCHES) || canManageBatches;
  const canManageStudents = usePermission(ADMIN_PERMISSIONS.MANAGE_STUDENTS);
  const canViewStudents = usePermission(ADMIN_PERMISSIONS.VIEW_STUDENTS) || canManageStudents;
  const canEditTests = usePermission(ADMIN_PERMISSIONS.EDIT_TEST);
  const canViewTests = usePermission(ADMIN_PERMISSIONS.VIEW_TESTS) || canEditTests;
  const canAssignTests = canManageBatches && canEditTests;
  const canManageBatchStudents = canManageBatches && canManageStudents;

  useEffect(() => {
    if (!adminDeptId) return;
    setForm((prev) => (prev.departmentId === adminDeptId ? prev : { ...prev, departmentId: adminDeptId }));
  }, [adminDeptId]);

  useEffect(() => {
    if (selectedBatchId && !bulkBatchId) {
      setBulkBatchId(selectedBatchId);
    }
  }, [selectedBatchId, bulkBatchId]);

  const batchesQuery = useQuery({
    queryKey: ["admin-batches"],
    queryFn: adminApi.getBatches,
    enabled: canViewBatches,
  });

  const testsQuery = useQuery({
    queryKey: ["admin-tests-for-batch"],
    queryFn: () => adminApi.getTests("?page=1&limit=100"),
    enabled: canAssignTests && canViewTests,
  });

  const selectedBatchQuery = useQuery({
    queryKey: ["admin-batch-detail", selectedBatchId],
    queryFn: () => adminApi.getBatchDetail(selectedBatchId),
    enabled: Boolean(selectedBatchId) && canViewBatches,
  });

  const studentsQuery = useQuery({
    queryKey: ["admin-students-directory", studentPage, search],
    queryFn: () => adminApi.getStudents(`?page=${studentPage}&limit=20&search=${encodeURIComponent(search)}`),
    enabled: canViewStudents,
  });

  const studentProfileQuery = useQuery({
    queryKey: ["admin-student-profile", selectedStudentId],
    queryFn: () => adminApi.getStudentProfile(selectedStudentId),
    enabled: Boolean(selectedStudentId) && canViewStudents,
  });

  const createBatchMutation = useMutation({
    mutationFn: adminApi.createBatch,
    onSuccess: () => {
      toast.success("Batch created successfully.");
      setBanner({ type: "success", title: "Batch created", message: "The new batch is now available in the list." });
      setForm({ name: "", year: new Date().getFullYear(), departmentId: adminDeptId });
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
    },
    onError: (error) => {
      if (error?.code === "BATCH_DUPLICATE_NAME") {
        toast.error("Duplicate batch name for this year/department.");
        setBanner({ type: "error", title: "Duplicate batch name", message: "Use a unique name for this year and department." });
        return;
      }
      setBanner({ type: "error", title: "Batch creation failed", message: error?.message || "Please review input fields and retry." });
      toast.error(error?.message || "Failed to create batch.");
    },
  });

  const bulkStudentsMutation = useMutation({
    mutationFn: ({ batchId, payload }) => adminApi.bulkBatchStudents(batchId, payload),
    onSuccess: () => {
      toast.success("Students added to batch.");
      setBanner({ type: "success", title: "Students imported", message: "Batch roster has been refreshed." });
      queryClient.invalidateQueries({ queryKey: ["admin-batch-detail", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Import failed", message: error?.message || "CSV data is invalid or incomplete." });
      toast.error(error?.message || "Failed to import students.");
    },
  });

  const removeStudentMutation = useMutation({
    mutationFn: ({ batchId, studentId }) => adminApi.removeBatchStudent(batchId, studentId),
    onSuccess: () => {
      toast.success("Student removed from batch.");
      setBanner({ type: "success", title: "Student removed", message: "Batch membership has been updated." });
      queryClient.invalidateQueries({ queryKey: ["admin-batch-detail", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
    },
    onError: (error) => {
      const warn = error?.details?.warning;
      if (warn?.type === "ACTIVE_TEST_PRESENT") {
        setBanner({ type: "warning", title: "Removal blocked", message: `Student has an active test: ${warn.testTitle || "in progress"}.` });
        toast.warning(`Cannot remove: active test ${warn.testTitle || "present"}.`);
        return;
      }
      setBanner({ type: "error", title: "Removal failed", message: error?.message || "Could not remove student from batch." });
      toast.error(error?.message || "Failed to remove student.");
    },
  });

  const assignTestMutation = useMutation({
    mutationFn: ({ testId, assignmentType, batchId, departmentId }) => {
      if (assignmentType === "batch") {
        return adminApi.assignTestToBatch(testId, { batchId });
      } else {
        return adminApi.assignTestToDepartment(testId, { departmentId });
      }
    },
    onSuccess: (data, { assignmentType }) => {
      const message = assignmentType === "batch" 
        ? "Test assigned to batch." 
        : `Test assigned to entire department (${data?.batchCount || 0} batches).`;
      toast.success(message);
      setBanner({ type: "success", title: "Test assigned", message });
      queryClient.invalidateQueries({ queryKey: ["admin-batch-detail", selectedBatchId] });
      setAssignTest({ testId: "", batchId: "", assignmentType: "department" });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Assignment failed", message: error?.message || "Unable to assign test." });
      toast.error(error?.message || "Failed to assign test.");
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: (batchId) => adminApi.deleteBatch(batchId),
    onSuccess: () => {
      toast.success("Batch deleted successfully.");
      setBanner({ type: "success", title: "Batch deleted", message: "The batch has been removed." });
      setSelectedBatchId("");
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
      queryClient.invalidateQueries({ queryKey: ["admin-batch-detail"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Delete failed", message: error?.message || "Batch could not be deleted." });
      toast.error(error?.message || "Failed to delete batch.");
    },
  });

  const assignBatchMutation = useMutation({
    mutationFn: ({ studentId, batchId }) => adminApi.assignStudentBatch(studentId, { batchId }),
    onSuccess: () => {
      toast.success("Student batch updated.");
      setBanner({ type: "success", title: "Student updated", message: "Student has been added to the selected batch." });
      queryClient.invalidateQueries({ queryKey: ["admin-students-directory"] });
      queryClient.invalidateQueries({ queryKey: ["admin-student-profile", selectedStudentId] });
      queryClient.invalidateQueries({ queryKey: ["admin-batch-detail"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Reassignment failed", message: error?.message || "Unable to assign student to selected batch." });
      toast.error(error?.message || "Failed to reassign student batch.");
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: ({ batchId, studentIds }) => adminApi.assignBatchStudents(batchId, { studentIds }),
    onSuccess: () => {
      toast.success("Students assigned to batch.");
      setBanner({ type: "success", title: "Batch updated", message: "Selected students have been added to the batch." });
      setSelectedStudentIds([]);
      queryClient.invalidateQueries({ queryKey: ["admin-students-directory"] });
      queryClient.invalidateQueries({ queryKey: ["admin-batch-detail"] });
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Bulk assign failed", message: error?.message || "Unable to assign selected students." });
      toast.error(error?.message || "Failed to assign students.");
    },
  });

  const batches = useMemo(() => batchesQuery.data || [], [batchesQuery.data]);
  const students = useMemo(() => studentsQuery.data?.data || [], [studentsQuery.data]);
  const pageStudentIds = useMemo(() => students.map((student) => student.id), [students]);
  const studentPagination = useMemo(
    () => studentsQuery.data?.pagination || { page: studentPage, totalPages: 1 },
    [studentPage, studentsQuery.data]
  );
  const pagedBatches = useMemo(() => {
    const start = (batchPage - 1) * PAGE_SIZE;
    return batches.slice(start, start + PAGE_SIZE);
  }, [batchPage, batches]);
  const totalPages = Math.max(1, Math.ceil(batches.length / PAGE_SIZE));
  const selectedBatch = selectedBatchQuery.data;
  const selectedStudent = studentProfileQuery.data;
  const allStudentsOnPageSelected = pageStudentIds.length > 0 && pageStudentIds.every((id) => selectedStudentIds.includes(id));

  const toggleStudentSelection = (studentId) => {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const toggleSelectAllOnPage = () => {
    setSelectedStudentIds((prev) => {
      if (allStudentsOnPageSelected) {
        return prev.filter((id) => !pageStudentIds.includes(id));
      }
      const merged = [...new Set([...prev, ...pageStudentIds])];
      return merged;
    });
  };

  if (!canViewBatches) {
    return <PermissionDenied action="access batches" />;
  }

  const bannerTone = banner.type === "error" ? "danger" : banner.type === "warning" ? "warning" : "success";

  const batchesPanel = (
    <div className="space-y-6">
      {canManageBatches ? (
        <SectionCard title="Create batch" description="Name + academic year; department is taken from your admin profile.">
          <form
            className="grid gap-4 sm:grid-cols-[minmax(0,1.5fr)_140px_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (!createBatchMutation.isPending && form.name && form.departmentId) createBatchMutation.mutate(form);
            }}
          >
            <FormField label="Batch name" htmlFor="batch-name" required>
              <Input id="batch-name" className="h-10 rounded-lg" placeholder="e.g. CSE-2027-A" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            </FormField>
            <FormField label="Year" htmlFor="batch-year" required>
              <Input id="batch-year" type="number" className="h-10 rounded-lg" value={form.year} onChange={(event) => setForm((prev) => ({ ...prev, year: Number(event.target.value) }))} />
            </FormField>
            <Button type="submit" className="h-10 rounded-lg px-4" disabled={createBatchMutation.isPending || !form.name || !form.departmentId}>
              <Plus className="size-4" />
              {createBatchMutation.isPending ? "Creating..." : "Create Batch"}
            </Button>
          </form>
        </SectionCard>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <SectionCard
          flush
          title="Batches"
          description={`${batches.length} total`}
          footer={batches.length > PAGE_SIZE ? <PaginationBar page={batchPage} pages={totalPages} onPageChange={(next) => setBatchPage(Math.min(Math.max(next, 1), totalPages))} /> : null}
        >
          {batchesQuery.isLoading ? (
            <div className="space-y-2 p-4" aria-busy="true">
              <SkeletonBlock className="h-14 rounded-lg" />
              <SkeletonBlock className="h-14 rounded-lg" />
              <SkeletonBlock className="h-14 rounded-lg" />
            </div>
          ) : pagedBatches.length === 0 ? (
            <EmptyState icon={Layers3} title="No batches found" description={canManageBatches ? "Create your first batch above." : "Batches will appear here once created."} className="border-0" />
          ) : (
            <ul className="divide-y divide-border">
              {pagedBatches.map((batch) => {
                const active = selectedBatchId === batch.id;
                return (
                  <li key={batch.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedBatchId(batch.id)}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5",
                        active ? "bg-primary/5" : "hover:bg-muted/40"
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate font-medium", active ? "text-primary" : "text-text-primary")}>{batch.name}</span>
                        <span className="block truncate text-xs text-text-secondary">
                          {batch.year} · {batch.department?.name || "-"} · {batch._count?.students || 0} students
                        </span>
                      </span>
                      {batch.isArchived ? <StatusBadge tone="warning">Archived</StatusBadge> : null}
                      <ChevronRight className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={selectedBatch ? selectedBatch.name : "Batch detail"}
          description={selectedBatch ? `${selectedBatch.department?.name || "-"} · Academic year ${selectedBatch.year}` : undefined}
          actions={
            selectedBatch && canManageBatches ? (
              <Button
                variant="ghost"
                className="h-9 rounded-lg text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => setConfirmDeleteBatch(true)}
                disabled={deleteBatchMutation.isPending}
              >
                <Trash2 className="size-4" />
                {deleteBatchMutation.isPending ? "Deleting..." : "Delete Batch"}
              </Button>
            ) : null
          }
        >
          {selectedBatchQuery.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-40" />
            </div>
          ) : !selectedBatch ? (
            <EmptyState icon={Layers3} title="Select a batch" description="Choose a batch from the list to see its students and assign tests." className="border-0 py-10" />
          ) : (
            <div className="space-y-6">
              {canAssignTests ? (
                <section className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <ClipboardList className="size-4 text-primary" aria-hidden="true" />
                    Assign test to {selectedBatch.department?.name}
                  </h3>
                  <fieldset className="flex flex-wrap gap-2">
                    <legend className="sr-only">Assignment scope</legend>
                    {[
                      { value: "department", label: "Entire Department (Default)" },
                      { value: "batch", label: "This Batch Only" },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/50",
                          assignTest.assignmentType === option.value ? "border-primary/40 bg-primary/5 text-text-primary" : "border-border text-text-secondary hover:bg-muted/40"
                        )}
                      >
                        <input
                          type="radio"
                          name="assignmentType"
                          value={option.value}
                          checked={assignTest.assignmentType === option.value}
                          onChange={(e) => setAssignTest((prev) => ({ ...prev, assignmentType: e.target.value }))}
                          className="size-4 accent-[var(--primary)]"
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select aria-label="Test to assign" className="ui-select min-w-0 flex-1" value={assignTest.testId} onChange={(event) => setAssignTest((prev) => ({ ...prev, testId: event.target.value }))}>
                      <option value="">Select test</option>
                      {(testsQuery.data?.data || []).map((test) => <option key={test.id} value={test.id}>{test.title}</option>)}
                    </select>
                    <Button
                      className="h-10 rounded-lg px-4"
                      onClick={() => assignTestMutation.mutate({
                        testId: assignTest.testId,
                        batchId: selectedBatch.id,
                        departmentId: selectedBatch.departmentId,
                        assignmentType: assignTest.assignmentType,
                      })}
                      disabled={assignTestMutation.isPending || !assignTest.testId}
                    >
                      {assignTestMutation.isPending ? "Assigning..." : "Assign"}
                    </Button>
                  </div>
                </section>
              ) : null}

              {canManageBatchStudents ? (
                <section className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <FileUp className="size-4 text-primary" aria-hidden="true" />
                    Add students (CSV)
                  </h3>
                  <FormField htmlFor="batch-bulk-csv" hint="Columns: email, studentId — one student per line.">
                    <Textarea id="batch-bulk-csv" rows={4} className="rounded-lg font-mono text-xs" value={bulkCsv} onChange={(event) => setBulkCsv(event.target.value)} />
                  </FormField>
                  <Button
                    variant="outline"
                    className="h-10 rounded-lg px-4"
                    onClick={() => bulkStudentsMutation.mutate({ batchId: selectedBatch.id, payload: { csvData: bulkCsv } })}
                    disabled={bulkStudentsMutation.isPending}
                  >
                    <FileUp className="size-4" />
                    {bulkStudentsMutation.isPending ? "Importing..." : "Import Students"}
                  </Button>
                </section>
              ) : null}

              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <GraduationCap className="size-4 text-primary" aria-hidden="true" />
                  Students <span className="font-normal text-text-secondary">({(selectedBatch.students || []).length})</span>
                </h3>
                {(selectedBatch.students || []).length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-text-secondary">No students in this batch yet.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {(selectedBatch.students || []).map((student) => (
                      <li key={student.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text-primary">{student.fullName}</p>
                          <p className="truncate text-xs text-text-secondary">{student.email} · {student._count?.submissions || 0} attempts</p>
                        </div>
                        {canManageBatchStudents ? (
                          <Button
                            variant="ghost"
                            className="h-9 shrink-0 rounded-lg text-text-secondary hover:text-danger"
                            onClick={() => removeStudentMutation.mutate({ batchId: selectedBatch.id, studentId: student.id })}
                          >
                            <UserMinus className="size-4" />
                            Remove
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );

  const directoryPanel = canViewStudents ? (
    <SectionCard flush title="Student directory" description="Search students, inspect a profile, and add students to batches.">
      <form
        className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5"
        onSubmit={(event) => {
          event.preventDefault();
          studentsQuery.refetch();
        }}
      >
        <SearchInput
          className="min-w-0 flex-1 basis-60"
          label="Search students"
          placeholder="Search by name/email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setStudentPage(1);
          }}
        />
        <Button type="submit" variant="outline" className="h-10 rounded-lg px-4">Search</Button>
      </form>

      {canManageBatchStudents ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5 sm:px-5">
          <Button variant="outline" className="h-9 rounded-lg" onClick={toggleSelectAllOnPage} disabled={students.length === 0}>
            {allStudentsOnPageSelected ? "Unselect page" : "Select page"}
          </Button>
          <select aria-label="Batch for selected students" className="ui-select h-9 min-w-52 flex-1 sm:flex-none" value={bulkBatchId} onChange={(event) => setBulkBatchId(event.target.value)}>
            <option value="">Select batch to add</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>{batch.name} ({batch.department?.name || "-"})</option>
            ))}
          </select>
          <Button
            className="h-9 rounded-lg"
            onClick={() => bulkAssignMutation.mutate({ batchId: bulkBatchId, studentIds: selectedStudentIds })}
            disabled={bulkAssignMutation.isPending || !bulkBatchId || selectedStudentIds.length === 0}
          >
            <UserPlus className="size-4" />
            {bulkAssignMutation.isPending ? "Adding..." : "Add Selected"}
          </Button>
          <span className="ml-auto text-sm text-text-secondary" aria-live="polite">
            <span className="font-semibold tabular-nums text-text-primary">{selectedStudentIds.length}</span> selected
          </span>
          {selectedStudentIds.length ? (
            <Button variant="ghost" className="h-9 rounded-lg text-text-secondary" onClick={() => setSelectedStudentIds([])}>Clear</Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 xl:border-r xl:border-border">
          {studentsQuery.isLoading ? (
            <div className="space-y-2 p-4" aria-busy="true">
              <SkeletonBlock className="h-14 rounded-lg" />
              <SkeletonBlock className="h-14 rounded-lg" />
              <SkeletonBlock className="h-14 rounded-lg" />
            </div>
          ) : students.length === 0 ? (
            <EmptyState icon={GraduationCap} title="No students found" description="No students found for current filters." className="border-0" />
          ) : (
            <ul className="divide-y divide-border">
              {students.map((student) => {
                const batchLabel = Array.isArray(student.batches) && student.batches.length > 0
                  ? student.batches.map((batch) => batch.name).join(", ")
                  : (student.batch?.name || "-");
                const active = selectedStudentId === student.id;
                return (
                  <li key={student.id} className={cn("flex items-center gap-3 px-4 py-3 transition-colors sm:px-5", active ? "bg-primary/5" : "hover:bg-muted/40")}>
                    {canManageBatchStudents ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${student.fullName}`}
                        checked={selectedStudentIds.includes(student.id)}
                        onChange={() => toggleStudentSelection(student.id)}
                        className="ui-checkbox"
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStudentId(student.id);
                        setBatchIdInput("");
                      }}
                      aria-pressed={active}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-text-primary">{student.fullName}</span>
                        <span className="block truncate text-xs text-text-secondary">{student.email} · {student.studentId}</span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-text-secondary">
                        <span className="block">{student.department?.name || "-"}</span>
                        <span className="block max-w-[140px] truncate">{batchLabel}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {(studentPagination?.totalPages || 1) > 1 ? (
            <PaginationBar
              className="border-t border-border px-4 py-3 sm:px-5"
              page={studentPagination?.page || studentPage}
              pages={studentPagination?.totalPages || 1}
              onPageChange={(next) => setStudentPage(Math.max(next, 1))}
            />
          ) : null}
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
              {canManageBatchStudents ? (
                <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
                  <select aria-label="Batch to add" className="ui-select min-w-0 flex-1" value={batchIdInput} onChange={(event) => setBatchIdInput(event.target.value)}>
                    <option value="">Select batch to add</option>
                    {batches.map((batch) => (
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
            </div>
          )}
        </aside>
      </div>
    </SectionCard>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Batches" description="Group students into batches, assign tests to them, and manage batch membership." />

      {banner.type ? (
        <Callout tone={bannerTone} title={banner.title}>
          {banner.message}
        </Callout>
      ) : null}

      {directoryPanel ? (
        <Tabs defaultValue="batches" className="gap-5">
          <div className="relative -mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">
            <TabsList variant="line" className="h-auto! w-full min-w-max justify-start gap-6 rounded-none border-b border-border p-0">
              <TabsTrigger value="batches" className={LINE_TAB}>
                <Layers3 className="size-4" />
                Batches
              </TabsTrigger>
              <TabsTrigger value="students" className={LINE_TAB}>
                <GraduationCap className="size-4" />
                Student directory
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="batches">{batchesPanel}</TabsContent>
          <TabsContent value="students">{directoryPanel}</TabsContent>
        </Tabs>
      ) : (
        batchesPanel
      )}

      <ConfirmActionDialog
        open={confirmDeleteBatch}
        onOpenChange={setConfirmDeleteBatch}
        title="Delete batch"
        description={`Delete “${selectedBatch?.name || "this batch"}” permanently? This cannot be undone.`}
        confirmLabel="Delete Batch"
        confirmVariant="destructive"
        onConfirm={() => {
          if (selectedBatch?.id) deleteBatchMutation.mutate(selectedBatch.id);
        }}
      />
    </div>
  );
}
