import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";

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

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"} className={banner.type === "warning" ? "border-warning/30 bg-warning/10 text-warning" : ""}>
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      {canManageBatches ? (
        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>Create Batch</CardTitle>
            <CardDescription>Name + academic year; department is taken from your admin profile.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Input placeholder="Batch name (CSE-2027-A)" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            <Input type="number" value={form.year} onChange={(event) => setForm((prev) => ({ ...prev, year: Number(event.target.value) }))} />
            <Button
              onClick={() => createBatchMutation.mutate(form)}
              disabled={createBatchMutation.isPending || !form.name || !form.departmentId}
            >
              {createBatchMutation.isPending ? "Creating..." : "Create Batch"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card className="rounded-2xl border-border">
          <CardHeader><CardTitle>Batch List</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {batchesQuery.isLoading ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-18" />
                <SkeletonBlock className="h-18" />
                <SkeletonBlock className="h-18" />
              </div>
            ) : null}
            {!batchesQuery.isLoading && pagedBatches.length === 0 ? <p className="text-sm text-text-secondary">No batches found. Create your first batch above.</p> : null}
            {pagedBatches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => setSelectedBatchId(batch.id)}
                className={`w-full rounded-xl border px-3 py-2 text-left ${selectedBatchId === batch.id ? "border-primary/40 bg-primary/10" : "border-border"}`}
              >
                <p className="font-medium text-text-primary">{batch.name}</p>
                <p className="text-xs text-text-secondary">Year: {batch.year} • {batch.department?.name || "-"} • Students: {batch._count?.students || 0}</p>
                {batch.isArchived ? <p className="mt-1 text-xs font-semibold text-warning">Archived</p> : null}
              </button>
            ))}
            {batches.length > PAGE_SIZE ? (
              <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
                <p>Page {batchPage} of {totalPages}</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={batchPage <= 1} onClick={() => setBatchPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={batchPage >= totalPages} onClick={() => setBatchPage((prev) => Math.min(prev + 1, totalPages))}>Next</Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Batch Detail</CardTitle>
            {selectedBatch && canManageBatches ? (
              <Button
                variant="outline"
                onClick={() => {
                  const shouldDelete = window.confirm("Delete this batch permanently?");
                  if (shouldDelete) {
                    deleteBatchMutation.mutate(selectedBatch.id);
                  }
                }}
                disabled={deleteBatchMutation.isPending}
              >
                {deleteBatchMutation.isPending ? "Deleting..." : "Delete Batch"}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedBatchQuery.isLoading ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-16" />
                <SkeletonBlock className="h-40" />
                <SkeletonBlock className="h-24" />
              </div>
            ) : null}
            {!selectedBatch ? <p className="text-sm text-text-secondary">Select a batch to view detail.</p> : null}
            {selectedBatch ? (
              <>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-sm font-semibold text-text-primary">{selectedBatch.name}</p>
                  <p className="text-xs text-text-secondary">{selectedBatch.department?.name} • Academic year {selectedBatch.year}</p>
                </div>

                {canManageBatchStudents ? (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-text-secondary">Add Students (CSV)</p>
                    <Textarea rows={5} value={bulkCsv} onChange={(event) => setBulkCsv(event.target.value)} />
                    <Button
                      onClick={() => bulkStudentsMutation.mutate({ batchId: selectedBatch.id, payload: { csvData: bulkCsv } })}
                      disabled={bulkStudentsMutation.isPending}
                    >
                      {bulkStudentsMutation.isPending ? "Importing..." : "Import Students"}
                    </Button>
                  </div>
                ) : null}

                {canAssignTests ? (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-text-secondary">Assign Test to {selectedBatch.department?.name}</p>
                    <div className="space-y-2">
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="assignmentType"
                            value="department"
                            checked={assignTest.assignmentType === "department"}
                            onChange={(e) => setAssignTest((prev) => ({ ...prev, assignmentType: e.target.value }))}
                            className="h-4 w-4"
                          />
                          <span className="text-sm">Entire Department (Default)</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="assignmentType"
                            value="batch"
                            checked={assignTest.assignmentType === "batch"}
                            onChange={(e) => setAssignTest((prev) => ({ ...prev, assignmentType: e.target.value }))}
                            className="h-4 w-4"
                          />
                          <span className="text-sm">This Batch Only</span>
                        </label>
                      </div>
                      <select className="h-10 rounded-md border border-border px-3 text-sm" value={assignTest.testId} onChange={(event) => setAssignTest((prev) => ({ ...prev, testId: event.target.value }))}>
                        <option value="">Select test</option>
                        {(testsQuery.data?.data || []).map((test) => <option key={test.id} value={test.id}>{test.title}</option>)}
                      </select>
                      <Button
                        onClick={() => assignTestMutation.mutate({
                          testId: assignTest.testId,
                          batchId: selectedBatch.id,
                          departmentId: selectedBatch.departmentId,
                          assignmentType: assignTest.assignmentType
                        })}
                        disabled={assignTestMutation.isPending || !assignTest.testId}
                      >{assignTestMutation.isPending ? "Assigning..." : "Assign"}</Button>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-text-secondary">Students</p>
                  {(selectedBatch.students || []).map((student) => (
                    <div key={student.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-text-primary">{student.fullName}</p>
                        <p className="text-xs text-text-secondary">{student.email} • Attempts: {student._count?.submissions || 0}</p>
                      </div>
                      {canManageBatchStudents ? (
                        <Button variant="outline" size="sm" onClick={() => removeStudentMutation.mutate({ batchId: selectedBatch.id, studentId: student.id })}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

      </div>
      {canViewStudents ? (
        <Card className="rounded-2xl border-border">
              <CardHeader>
                <CardTitle>Student Directory</CardTitle>
                <CardDescription>Search/filter, inspect profile, reassign batch, and monitor bulk-import jobs.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex gap-2">
                  <Input placeholder="Search by name/email" value={search} onChange={(event) => { setSearch(event.target.value); setStudentPage(1); }} />
                  <Button variant="outline" onClick={() => studentsQuery.refetch()}>Search</Button>
                </div>
                  {canManageBatchStudents ? (
                    <div className="mb-4 rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-text-secondary">Bulk assign students</p>
                      <p className="text-xs text-text-secondary">Selected: {selectedStudentIds.length}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" onClick={toggleSelectAllOnPage} disabled={students.length === 0}>
                        {allStudentsOnPageSelected ? "Unselect page" : "Select page"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setSelectedStudentIds([])} disabled={selectedStudentIds.length === 0}>
                        Clear
                      </Button>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <select
                        className="h-10 rounded-md border border-border px-3 text-sm sm:col-span-2"
                        value={bulkBatchId}
                        onChange={(event) => setBulkBatchId(event.target.value)}
                      >
                        <option value="">Select batch to add</option>
                        {batches.map((batch) => (
                          <option key={batch.id} value={batch.id}>{batch.name} ({batch.department?.name || "-"})</option>
                        ))}
                      </select>
                      <Button
                        onClick={() => bulkAssignMutation.mutate({ batchId: bulkBatchId, studentIds: selectedStudentIds })}
                        disabled={bulkAssignMutation.isPending || !bulkBatchId || selectedStudentIds.length === 0}
                      >
                        {bulkAssignMutation.isPending ? "Adding..." : "Add Selected"}
                      </Button>
                    </div>
                  </div>
                  ) : null}
                <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
                  <div className="space-y-2">
                    {studentsQuery.isLoading ? (
                      <div className="space-y-2">
                        <SkeletonBlock className="h-16" />
                        <SkeletonBlock className="h-16" />
                        <SkeletonBlock className="h-16" />
                      </div>
                    ) : null}
                    {!studentsQuery.isLoading && students.length === 0 ? <p className="text-sm text-text-secondary">No students found for current filters.</p> : null}
                    {students.map((student) => {
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
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${selectedStudentId === student.id ? "border-primary/40 bg-primary/10" : "border-border"}`}
                        >
                          <div className="flex items-start gap-3">
                            {canManageBatchStudents ? (
                              <input
                                type="checkbox"
                                checked={selectedStudentIds.includes(student.id)}
                                onChange={() => toggleStudentSelection(student.id)}
                                onClick={(event) => event.stopPropagation()}
                                className="mt-1 h-4 w-4"
                              />
                            ) : null}
                            <div>
                              <p className="font-medium text-text-primary">{student.fullName}</p>
                              <p className="text-xs text-text-secondary">{student.email} • {student.studentId}</p>
                            </div>
                          </div>
                          <div className="text-right text-xs text-text-secondary">
                            <p>{student.department?.name || "-"}</p>
                            <p className="max-w-[140px] truncate">{batchLabel}</p>
                          </div>
                        </button>
                      );
                    })}
                    {(studentPagination?.totalPages || 1) > 1 ? (
                      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
                        <p>Page {studentPagination?.page || studentPage} of {studentPagination?.totalPages || 1}</p>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" disabled={(studentPagination?.page || studentPage) <= 1} onClick={() => setStudentPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                          <Button variant="outline" size="sm" disabled={(studentPagination?.page || 1) >= (studentPagination?.totalPages || 1)} onClick={() => setStudentPage((prev) => prev + 1)}>Next</Button>
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
                        <p className="text-xs text-text-secondary">{selectedStudent.email} • {selectedStudent.studentId}</p>
                        <p className="text-xs text-text-secondary">Department: {selectedStudent.department?.name || "-"}</p>
                        <p className="text-xs text-text-secondary">Total submissions: {selectedStudent._count?.submissions || 0}</p>

                        {Array.isArray(selectedStudent.batches) && selectedStudent.batches.length > 0 ? (
                          <div className="border-t border-border pt-2">
                            <p className="mb-2 text-xs font-medium text-text-primary">Assigned batches:</p>
                            <div className="space-y-1">
                              {selectedStudent.batches.map((batch) => (
                                <div key={batch.id} className="flex items-center justify-between rounded-md bg-primary/5 px-2 py-1 text-xs">
                                  <span className="text-text-primary">{batch.name}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-text-secondary italic">No batches assigned yet</p>
                        )}
      
                        {canManageBatchStudents ? (
                          <div className="grid gap-2 border-t border-border pt-2 sm:grid-cols-3">
                            <select className="h-10 rounded-md border border-border px-3 text-sm sm:col-span-2" value={batchIdInput} onChange={(event) => setBatchIdInput(event.target.value)}>
                              <option value="">Select batch to add</option>
                              {batches.map((batch) => (
                                <option key={batch.id} value={batch.id}>{batch.name} ({batch.department?.name || "-"})</option>
                              ))}
                            </select>
                            <Button
                              onClick={() => assignBatchMutation.mutate({ studentId: selectedStudent.id, batchId: batchIdInput })}
                              disabled={assignBatchMutation.isPending || !batchIdInput}
                            >
                              Add Batch
                            </Button>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
      ) : null}
    </div>
  );
}
