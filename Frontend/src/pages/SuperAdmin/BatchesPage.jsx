import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import SkeletonBlock from "@/components/common/SkeletonBlock";

export default function BatchesPage() {
  const [filters, setFilters] = useState({ search: "", collegeId: "" });
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ testId: "" });
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [assignBatchSearch, setAssignBatchSearch] = useState("");
  const [batchForm, setBatchForm] = useState({ name: "", year: new Date().getFullYear(), collegeId: "", departmentId: "", departmentIds: [], isGlobal: false });
  const [editBatchId, setEditBatchId] = useState("");
  const [editCollegeId, setEditCollegeId] = useState("");
  const [editForm, setEditForm] = useState({ name: "", year: new Date().getFullYear(), departmentId: "" });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [selectedStudentRecords, setSelectedStudentRecords] = useState({});
  const [studentCollegeId, setStudentCollegeId] = useState("");
  const [studentDepartmentId, setStudentDepartmentId] = useState("");
  const [studentBatchFilterId, setStudentBatchFilterId] = useState("");
  const [bulkBatchId, setBulkBatchId] = useState("");
  const [search, setSearch] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [batchIdInput, setBatchIdInput] = useState("");

  const collegesQuery = useQuery({
    queryKey: ["super-colleges-for-batches"],
    queryFn: () => superAdminApi.getColleges("?limit=100"),
  });

  const testsQuery = useQuery({
    queryKey: ["super-tests-for-batches", filters.collegeId],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", "100");
      if (filters.collegeId) params.set("collegeId", filters.collegeId);
      return superAdminApi.getTests(`?${params.toString()}`);
    },
  });

  const createDepartmentsQuery = useQuery({
    queryKey: ["super-departments-for-create-batches", batchForm.collegeId],
    queryFn: () => superAdminApi.getDepartments(`?limit=100&collegeId=${encodeURIComponent(batchForm.collegeId)}`),
    enabled: Boolean(batchForm.collegeId),
  });

  const editDepartmentsQuery = useQuery({
    queryKey: ["super-departments-for-edit-batches", editCollegeId],
    queryFn: () => superAdminApi.getDepartments(`?limit=100&collegeId=${encodeURIComponent(editCollegeId)}`),
    enabled: Boolean(editCollegeId),
  });

  const batchesQuery = useQuery({
    queryKey: ["super-batches", page, filters.search, filters.collegeId],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.collegeId) params.set("collegeId", filters.collegeId);
      return superAdminApi.getBatches(`?${params.toString()}`);
    },
  });

  const assignBatchesQuery = useQuery({
    queryKey: ["super-batches-for-assignment", filters.collegeId],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", "100");
      if (filters.collegeId) params.set("collegeId", filters.collegeId);
      return superAdminApi.getBatches(`?${params.toString()}`);
    },
  });

  const studentsQuery = useQuery({
    queryKey: ["super-students-for-batches", studentPage, search, studentCollegeId, studentDepartmentId, studentBatchFilterId],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(studentPage));
      params.set("limit", "20");
      if (search.trim()) params.set("search", search.trim());
      params.set("collegeId", studentCollegeId);
      if (studentDepartmentId) params.set("departmentId", studentDepartmentId);
      if (studentBatchFilterId) params.set("batchId", studentBatchFilterId);
      return superAdminApi.getStudents(`?${params.toString()}`);
    },
    enabled: Boolean(studentCollegeId),
  });

  const studentDepartmentsQuery = useQuery({
    queryKey: ["super-student-directory-departments", studentCollegeId],
    queryFn: () => superAdminApi.getDepartments(`?page=1&limit=100&collegeId=${encodeURIComponent(studentCollegeId)}`),
    enabled: Boolean(studentCollegeId),
  });

  const studentBatchesQuery = useQuery({
    queryKey: ["super-student-directory-batches", studentCollegeId],
    queryFn: () => superAdminApi.getBatches(`?page=1&limit=100&collegeId=${encodeURIComponent(studentCollegeId)}`),
    enabled: Boolean(studentCollegeId),
  });

  const studentProfileQuery = useQuery({
    queryKey: ["super-student-profile", selectedStudentId],
    queryFn: () => superAdminApi.getStudents(`?studentId=${selectedStudentId}`),
    enabled: Boolean(selectedStudentId),
  });

  const createBatchMutation = useMutation({
    mutationFn: (payload) => superAdminApi.createBatch(payload),
    onSuccess: () => {
      toast.success("Batch created");
      setBatchForm({ name: "", year: new Date().getFullYear(), collegeId: "", departmentId: "", departmentIds: [], isGlobal: false });
      setPage(1);
      batchesQuery.refetch();
      assignBatchesQuery.refetch();
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to create batch.");
    },
  });

  const updateBatchMutation = useMutation({
    mutationFn: ({ batchId, payload }) => superAdminApi.updateBatch(batchId, payload),
    onSuccess: () => {
      toast.success("Batch updated");
      setEditBatchId("");
      setEditCollegeId("");
      batchesQuery.refetch();
      assignBatchesQuery.refetch();
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to update batch.");
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: ({ batchId, confirmationText }) => superAdminApi.deleteBatch(batchId, { confirmationText }),
    onSuccess: () => {
      toast.success("Batch deleted");
      setPendingDelete(null);
      batchesQuery.refetch();
      assignBatchesQuery.refetch();
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to delete batch.");
    },
  });

  const assignBatchMutation = useMutation({
    mutationFn: ({ studentId, batchId }) => superAdminApi.updateStudent(studentId, { batchId }),
    onSuccess: () => {
      toast.success("Student batch updated successfully");
      setBatchIdInput("");
      studentsQuery.refetch();
      studentProfileQuery.refetch();
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to assign batch to student.");
    },
  });

  const bulkAssignStudentsMutation = useMutation({
    mutationFn: ({ batchId, studentIds }) => superAdminApi.assignStudentsToBatch(batchId, { studentIds }),
    onSuccess: (payload) => {
      const updated = Number(payload?.updated || 0);
      const invalidCount = Array.isArray(payload?.invalidStudentIds) ? payload.invalidStudentIds.length : 0;
      if (updated > 0) {
        toast.success(`Added ${updated} student${updated === 1 ? "" : "s"} to the batch.`);
      }
      if (invalidCount > 0) {
        toast.warning(`${invalidCount} selected student${invalidCount === 1 ? " was" : "s were"} skipped.`);
      }
      setSelectedStudentIds([]);
      setSelectedStudentRecords({});
      setBulkBatchId("");
      studentsQuery.refetch();
      studentProfileQuery.refetch();
      studentBatchesQuery.refetch();
      batchesQuery.refetch();
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to add selected students to batch.");
    },
  });

  const assignMutation = useMutation({
    mutationFn: (payload) => superAdminApi.assignTestToBatches(payload),
    onSuccess: (payload) => {
      const assigned = Number(payload?.assigned || 0);
      const alreadyAssigned = Number(payload?.alreadyAssigned || 0);
      const invalidCount = Array.isArray(payload?.invalidBatchIds) ? payload.invalidBatchIds.length : 0;

      if (assigned > 0) {
        toast.success(`Assigned to ${assigned} batch${assigned === 1 ? "" : "es"}.`);
      }
      if (alreadyAssigned > 0) {
        toast.info(`${alreadyAssigned} batch${alreadyAssigned === 1 ? " was" : "es were"} already assigned.`);
      }
      if (invalidCount > 0) {
        toast.warning(`${invalidCount} invalid batch id${invalidCount === 1 ? "" : "s"} were ignored.`);
      }
      if (assigned === 0 && alreadyAssigned === 0 && invalidCount === 0) {
        toast.info("No assignments were made.");
      }

      setSelectedBatchIds([]);
      batchesQuery.refetch();
      assignBatchesQuery.refetch();
    },
    onError: (error) => {
      const invalidBatchIds = error?.details?.invalidBatchIds;
      if (Array.isArray(invalidBatchIds) && invalidBatchIds.length > 0) {
        toast.error(`No valid batches found. Invalid IDs: ${invalidBatchIds.join(", ")}`);
        return;
      }

      toast.error(error?.message || "Failed to assign test to batches.");
    },
  });

  const collegesData = collegesQuery.data?.data;
  const testsData = testsQuery.data?.data;
  const createDepartmentData = createDepartmentsQuery.data?.data;
  const editDepartmentData = editDepartmentsQuery.data?.data;
  const batchesData = batchesQuery.data?.data;
  const assignBatchesData = assignBatchesQuery.data?.data;
  const studentDepartmentData = studentDepartmentsQuery.data?.data;
  const studentBatchData = studentBatchesQuery.data?.data;
  const studentsData = studentsQuery.data?.data;
  const colleges = useMemo(() => (Array.isArray(collegesData) ? collegesData : []), [collegesData]);
  const tests = useMemo(() => (Array.isArray(testsData) ? testsData : []), [testsData]);
  const createDepartmentOptions = useMemo(() => (Array.isArray(createDepartmentData) ? createDepartmentData : []), [createDepartmentData]);
  const editDepartmentOptions = useMemo(() => (Array.isArray(editDepartmentData) ? editDepartmentData : []), [editDepartmentData]);
  const batches = useMemo(() => (Array.isArray(batchesData) ? batchesData : []), [batchesData]);
  const assignBatches = useMemo(() => (Array.isArray(assignBatchesData) ? assignBatchesData : []), [assignBatchesData]);
  const studentDepartmentOptions = useMemo(() => (Array.isArray(studentDepartmentData) ? studentDepartmentData : []), [studentDepartmentData]);
  const studentBatchOptions = useMemo(() => (Array.isArray(studentBatchData) ? studentBatchData : []), [studentBatchData]);
  const pagination = batchesQuery.data?.pagination;
  const students = useMemo(() => (Array.isArray(studentsData) ? studentsData : []), [studentsData]);
  const studentPagination = studentsQuery.data?.pagination;
  const selectedStudentProfile = studentProfileQuery.data?.data?.[0] || null;
  const selectedStudent = selectedStudentId ? students.find((s) => s.id === selectedStudentId) || selectedStudentProfile : null;

  const finalBatchIds = useMemo(() => [...new Set(selectedBatchIds)], [selectedBatchIds]);
  const selectedTest = useMemo(() => tests.find((test) => String(test.id) === String(form.testId)), [form.testId, tests]);

  const selectedBatchMap = useMemo(
    () => new Map(assignBatches.map((batch) => [String(batch.id), batch])),
    [assignBatches]
  );

  const selectedBatchDetails = useMemo(
    () => finalBatchIds.map((id) => selectedBatchMap.get(String(id))).filter(Boolean),
    [finalBatchIds, selectedBatchMap]
  );

  const studentFilterBatchOptions = useMemo(() => {
    if (!studentDepartmentId) return studentBatchOptions;
    return studentBatchOptions.filter((batch) => {
      const globalDepartmentIds = Array.isArray(batch.departmentIds) ? batch.departmentIds.map((id) => String(id)) : [];
      return String(batch.departmentId || "") === String(studentDepartmentId)
        || globalDepartmentIds.includes(String(studentDepartmentId));
    });
  }, [studentBatchOptions, studentDepartmentId]);

  const selectedStudentDepartmentIds = useMemo(() => {
    const ids = selectedStudentIds
      .map((studentId) => selectedStudentRecords[studentId]?.departmentId)
      .filter(Boolean)
      .map((departmentId) => String(departmentId));
    return [...new Set(ids)];
  }, [selectedStudentIds, selectedStudentRecords]);

  const bulkBatchOptions = useMemo(() => {
    if (selectedStudentDepartmentIds.length === 0) return studentBatchOptions;

    if (selectedStudentDepartmentIds.length > 1) {
      return studentBatchOptions.filter((batch) => {
        if (!batch.isGlobal) return false;
        const globalDepartmentIds = Array.isArray(batch.departmentIds) ? batch.departmentIds.map((id) => String(id)) : [];
        return selectedStudentDepartmentIds.every((departmentId) => globalDepartmentIds.includes(departmentId));
      });
    }

    const [departmentId] = selectedStudentDepartmentIds;
    return studentBatchOptions.filter((batch) => {
      const globalDepartmentIds = Array.isArray(batch.departmentIds) ? batch.departmentIds.map((id) => String(id)) : [];
      return String(batch.departmentId || "") === departmentId || globalDepartmentIds.includes(departmentId);
    });
  }, [selectedStudentDepartmentIds, studentBatchOptions]);

  const filteredAssignBatches = useMemo(() => {
    const term = assignBatchSearch.trim().toLowerCase();
    const sameCollegeBatches = selectedTest?.collegeId
      ? assignBatches.filter((batch) => String(batch.collegeId) === String(selectedTest.collegeId))
      : assignBatches;

    if (!term) return sameCollegeBatches;

    return sameCollegeBatches.filter((batch) => {
      const text = `${batch.name || ""} ${batch.year || ""} ${batch.college?.name || ""} ${batch.department?.name || ""}`.toLowerCase();
      return text.includes(term);
    });
  }, [assignBatches, assignBatchSearch, selectedTest?.collegeId]);

  useEffect(() => {
    setSelectedBatchIds([]);
    setAssignBatchSearch("");
  }, [filters.collegeId]);

  useEffect(() => {
    setSelectedStudentId("");
    setSelectedStudentIds([]);
    setSelectedStudentRecords({});
    setStudentDepartmentId("");
    setStudentBatchFilterId("");
    setBatchIdInput("");
    setBulkBatchId("");
    setSearch("");
    setStudentPage(1);
  }, [studentCollegeId]);

  useEffect(() => {
    if (!studentBatchFilterId) return;
    const isStillAvailable = studentFilterBatchOptions.some((batch) => String(batch.id) === String(studentBatchFilterId));
    if (!isStillAvailable) {
      setStudentBatchFilterId("");
    }
  }, [studentBatchFilterId, studentFilterBatchOptions]);

  useEffect(() => {
    if (!bulkBatchId) return;
    const isStillAvailable = bulkBatchOptions.some((batch) => String(batch.id) === String(bulkBatchId));
    if (!isStillAvailable) {
      setBulkBatchId("");
    }
  }, [bulkBatchId, bulkBatchOptions]);

  const toggleAssignBatchSelection = (batchId) => {
    setSelectedBatchIds((prev) =>
      prev.includes(batchId) ? prev.filter((id) => id !== batchId) : [...prev, batchId]
    );
  };

  const visibleStudentIds = useMemo(() => students.map((student) => student.id), [students]);
  const allVisibleStudentsSelected = visibleStudentIds.length > 0 && visibleStudentIds.every((id) => selectedStudentIds.includes(id));

  const toggleStudentSelection = (student) => {
    const studentId = student.id;
    setSelectedStudentIds((prev) => {
      const isSelected = prev.includes(studentId);
      setSelectedStudentRecords((records) => {
        const next = { ...records };
        if (isSelected) {
          delete next[studentId];
        } else {
          next[studentId] = {
            id: student.id,
            departmentId: student.departmentId,
            fullName: student.fullName,
          };
        }
        return next;
      });

      return isSelected ? prev.filter((id) => id !== studentId) : [...prev, studentId];
    });
  };

  const toggleVisibleStudentSelection = () => {
    setSelectedStudentIds((prev) => {
      if (allVisibleStudentsSelected) {
        setSelectedStudentRecords((records) => {
          const next = { ...records };
          visibleStudentIds.forEach((id) => {
            delete next[id];
          });
          return next;
        });
        return prev.filter((id) => !visibleStudentIds.includes(id));
      }
      setSelectedStudentRecords((records) => {
        const next = { ...records };
        students.forEach((student) => {
          next[student.id] = {
            id: student.id,
            departmentId: student.departmentId,
            fullName: student.fullName,
          };
        });
        return next;
      });
      return [...new Set([...prev, ...visibleStudentIds])];
    });
  };

  const clearStudentFilters = () => {
    setStudentDepartmentId("");
    setStudentBatchFilterId("");
    setSearch("");
    setStudentPage(1);
    setSelectedStudentId("");
    setSelectedStudentIds([]);
    setSelectedStudentRecords({});
  };

  const bulkAssignStudents = () => {
    if (!studentCollegeId) {
      toast.error("Select a college first.");
      return;
    }
    if (!bulkBatchId) {
      toast.error("Select a batch.");
      return;
    }
    if (!selectedStudentIds.length) {
      toast.error("Select at least one student.");
      return;
    }

    bulkAssignStudentsMutation.mutate({ batchId: bulkBatchId, studentIds: selectedStudentIds });
  };

  const assign = async () => {
    if (!form.testId) {
      toast.error("Select a test before assignment.");
      return;
    }

    if (!finalBatchIds.length) {
      toast.error("Select at least one batch.");
      return;
    }

    if (selectedTest?.collegeId && selectedBatchDetails.some((batch) => String(batch.collegeId) !== String(selectedTest.collegeId))) {
      toast.error("Selected batches must belong to the same college as the test.");
      return;
    }

    assignMutation.mutate({ testId: form.testId, batchIds: finalBatchIds });
  };

  const createBatch = () => {
    const departmentIds = batchForm.isGlobal ? [...new Set(batchForm.departmentIds)] : [batchForm.departmentId].filter(Boolean);
    if (!batchForm.name.trim() || !batchForm.collegeId || !batchForm.year || departmentIds.length === 0) {
      toast.error("Name, year, college, and department selection are required.");
      return;
    }

    if (batchForm.isGlobal && departmentIds.length < 2) {
      toast.error("Select at least two departments for a global batch.");
      return;
    }

    createBatchMutation.mutate({
      name: batchForm.name.trim(),
      year: Number(batchForm.year),
      collegeId: batchForm.collegeId,
      departmentId: departmentIds[0],
      departmentIds,
      isGlobal: batchForm.isGlobal,
    });
  };

  const openEdit = (batch) => {
    setEditBatchId(batch.id);
    setEditCollegeId(batch.collegeId || "");
    setEditForm({
      name: batch.name || "",
      year: Number(batch.year || new Date().getFullYear()),
      departmentId: batch.departmentId || "",
    });
  };

  const saveEdit = (batch) => {
    if (!editForm.name.trim() || !editForm.departmentId || !editForm.year) {
      toast.error("Name, year, and department are required.");
      return;
    }

    updateBatchMutation.mutate({
      batchId: batch.id,
      payload: {
        name: editForm.name.trim(),
        year: Number(editForm.year),
        departmentId: editForm.departmentId,
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Create Batch</CardTitle>
          <CardDescription>Super Admin can create and manage batches across colleges.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-5">
            <Input
              placeholder="Batch name"
              value={batchForm.name}
              onChange={(e) => setBatchForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <Input
              type="number"
              min={2000}
              max={2100}
              placeholder="Year"
              value={batchForm.year}
              onChange={(e) => setBatchForm((prev) => ({ ...prev, year: Number(e.target.value) || "" }))}
            />
            <select
              className="h-10 rounded-lg border border-border px-2"
              value={batchForm.collegeId}
              onChange={(e) => setBatchForm((prev) => ({ ...prev, collegeId: e.target.value, departmentId: "", departmentIds: [] }))}
            >
              <option value="">Select college</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
            <select
              className="h-10 rounded-lg border border-border px-2"
              value={batchForm.departmentId}
              disabled={batchForm.isGlobal}
              onChange={(e) => setBatchForm((prev) => ({ ...prev, departmentId: e.target.value }))}
            >
              <option value="">Select department</option>
              {createDepartmentOptions.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
            <Button className="bg-primary/100 hover:bg-primary" onClick={createBatch} disabled={createBatchMutation.isPending}>
              {createBatchMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              className="size-4"
              checked={batchForm.isGlobal}
              onChange={(e) => setBatchForm((prev) => ({ ...prev, isGlobal: e.target.checked, departmentId: "", departmentIds: [] }))}
            />
            Global batch across departments
          </label>
          {batchForm.isGlobal ? (
            <div className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-2 lg:grid-cols-3">
              {createDepartmentOptions.map((department) => {
                const checked = batchForm.departmentIds.includes(department.id);
                return (
                  <label key={department.id} className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <span>{department.name}</span>
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={checked}
                      onChange={() => setBatchForm((prev) => ({
                        ...prev,
                        departmentIds: checked
                          ? prev.departmentIds.filter((id) => id !== department.id)
                          : [...prev.departmentIds, department.id],
                      }))}
                    />
                  </label>
                );
              })}
              {!createDepartmentsQuery.isLoading && createDepartmentOptions.length === 0 ? (
                <p className="text-xs text-text-secondary">No departments available for this college.</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
            

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Assign Test to Batches</CardTitle>
          <CardDescription>Select a test and one or more batches from the same college.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_auto]">
            <select
              className="h-10 rounded-lg border border-border px-2"
              value={form.testId}
              onChange={(event) => {
                setForm({ testId: event.target.value });
                setSelectedBatchIds([]);
              }}
            >
              <option value="">Select test</option>
              {tests.map((test) => (
                <option key={test.id} value={test.id}>{test.title} ({test.college?.name || test.collegeName || "College"})</option>
              ))}
            </select>
            <Input
              value={assignBatchSearch}
              onChange={(event) => setAssignBatchSearch(event.target.value)}
              placeholder="Search batches"
              disabled={!form.testId}
            />
            <Button
              type="button"
              className="bg-primary/100 hover:bg-primary"
              disabled={assignMutation.isPending || !form.testId || finalBatchIds.length === 0}
              onClick={assign}
            >
              {assignMutation.isPending ? "Assigning..." : `Assign ${finalBatchIds.length || ""}`.trim()}
            </Button>
          </div>

          {!form.testId ? (
            <p className="text-sm text-text-secondary">Choose a test to load eligible batches.</p>
          ) : null}
          {form.testId && filteredAssignBatches.length === 0 ? (
            <p className="text-sm text-text-secondary">No batches match the selected test and search.</p>
          ) : null}
          {form.testId && filteredAssignBatches.length > 0 ? (
            <div className="grid max-h-72 gap-2 overflow-y-auto rounded-xl border border-border p-2 sm:grid-cols-2 xl:grid-cols-3">
              {filteredAssignBatches.map((batch) => {
                const batchId = String(batch.id);
                const checked = finalBatchIds.includes(batchId);
                return (
                  <label key={batch.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${checked ? "border-primary/40 bg-primary/10" : "border-border"}`}>
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={checked}
                      onChange={() => toggleAssignBatchSelection(batchId)}
                    />
                    <span>
                      <span className="block font-medium text-text-primary">{batch.name} ({batch.year || "-"})</span>
                      <span className="block text-xs text-text-secondary">{batch.college?.name || "-"} • {batch.department?.name || (batch.isGlobal ? "Global" : "-")}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      

      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Filter Batches</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-4">
          <Input
            placeholder="Search by batch/department/college"
            value={filters.search}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, search: e.target.value }));
              setPage(1);
            }}
          />
          <select
            className="h-10 rounded-lg border border-border px-2"
            value={filters.collegeId}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, collegeId: e.target.value }));
              setPage(1);
            }}
          >
            <option value="">All colleges</option>
            {colleges.map((college) => (
              <option key={college.id} value={college.id}>{college.name}</option>
            ))}
          </select>
          <Button variant="outline" onClick={() => { setPage(1); batchesQuery.refetch(); }}>Apply Filter</Button>
          <Button variant="outline" onClick={() => { setFilters({ search: "", collegeId: "" }); setPage(1); }}>
            Reset
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>All Batches</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {batchesQuery.isLoading ? <p className="text-sm text-text-secondary">Loading batches from backend...</p> : null}
          {batchesQuery.isError ? <p className="text-sm text-danger">{batchesQuery.error?.message || "Failed to load batches."}</p> : null}
          {!batchesQuery.isLoading && !batchesQuery.isError && batches.length === 0 ? (
            <p className="text-sm text-text-secondary">No batches found for selected filters.</p>
          ) : null}

          {batches.map((batch) => {
            const isEditing = editBatchId === batch.id;

            return (
              <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
                <div className="min-w-70 flex-1">
                  {isEditing ? (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input
                        value={editForm.name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="Batch name"
                      />
                      <Input
                        type="number"
                        min={2000}
                        max={2100}
                        value={editForm.year}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, year: Number(e.target.value) || "" }))}
                        placeholder="Year"
                      />
                      <select
                        className="h-10 rounded-lg border border-border px-2"
                        value={editForm.departmentId}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, departmentId: e.target.value }))}
                      >
                        <option value="">Select department</option>
                        {editDepartmentOptions.map((department) => (
                          <option key={department.id} value={department.id}>{department.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <>
                      <p className="font-medium text-text-primary">{batch.name} ({batch.year})</p>
                      <p className="text-xs text-text-secondary">
                        {batch.college?.name || "-"} • {batch.isGlobal ? `Global (${batch.departments?.map((department) => department.name).join(", ") || `${batch.departmentIds?.length || 0} departments`})` : batch.department?.name || "-"} • Students: {batch._count?.students || 0} • Tests: {batch._count?.tests || 0}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <Button size="sm" onClick={() => saveEdit(batch)} disabled={updateBatchMutation.isPending}>Save</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditBatchId("")}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => openEdit(batch)}>Edit</Button>
                      <Button size="sm" variant="destructive" onClick={() => setPendingDelete(batch)} disabled={deleteBatchMutation.isPending}>Delete</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {(pagination?.pages || 1) > 1 ? (
            <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
              <p>Page {pagination?.page || page} of {pagination?.pages || 1}</p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(pagination?.page || page) <= 1 || batchesQuery.isFetching}
                  onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(pagination?.page || page) >= (pagination?.pages || 1) || batchesQuery.isFetching}
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="rounded-2xl border-border">
                    <CardHeader>
                      <CardTitle>Student Directory</CardTitle>
                      <CardDescription>Select a college first, then choose students and add them to a batch.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4 rounded-xl border border-border bg-background p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-text-primary">Filters</p>
                          <Button variant="outline" size="sm" disabled={!studentCollegeId && !search && !studentDepartmentId && !studentBatchFilterId} onClick={clearStudentFilters}>Reset</Button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1.2fr_auto]">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">College</label>
                            <select
                              className="h-10 w-full rounded-lg border border-border px-2"
                              value={studentCollegeId}
                              onChange={(event) => setStudentCollegeId(event.target.value)}
                            >
                              <option value="">Select college</option>
                              {colleges.map((college) => (
                                <option key={college.id} value={college.id}>{college.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">Department</label>
                            <select
                              className="h-10 w-full rounded-lg border border-border px-2"
                              value={studentDepartmentId}
                              disabled={!studentCollegeId}
                              onChange={(event) => { setStudentDepartmentId(event.target.value); setStudentPage(1); setSelectedStudentIds([]); setSelectedStudentRecords({}); }}
                            >
                              <option value="">All departments</option>
                              {studentDepartmentOptions.map((department) => (
                                <option key={department.id} value={department.id}>{department.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">Batch</label>
                            <select
                              className="h-10 w-full rounded-lg border border-border px-2"
                              value={studentBatchFilterId}
                              disabled={!studentCollegeId}
                              onChange={(event) => { setStudentBatchFilterId(event.target.value); setStudentPage(1); setSelectedStudentIds([]); setSelectedStudentRecords({}); }}
                            >
                              <option value="">All batches</option>
                              {studentFilterBatchOptions.map((batch) => (
                                <option key={batch.id} value={batch.id}>{batch.name} ({batch.isGlobal ? "Global" : batch.department?.name || "-"})</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">Search</label>
                            <Input placeholder="Name or email" value={search} disabled={!studentCollegeId} onChange={(event) => { setSearch(event.target.value); setStudentPage(1); }} />
                          </div>
                          <div className="flex items-end">
                            <Button className="w-full" variant="outline" disabled={!studentCollegeId} onClick={() => studentsQuery.refetch()}>Apply</Button>
                          </div>
                        </div>
                      </div>
                      <div className="mb-4 grid gap-3 rounded-xl border border-border bg-muted/20 p-3 lg:grid-cols-[1fr_auto_auto_auto]">
                        <select
                          className="h-10 rounded-lg border border-border px-2"
                          value={bulkBatchId}
                          disabled={!studentCollegeId}
                          onChange={(event) => setBulkBatchId(event.target.value)}
                        >
                          <option value="">Batch for selected students</option>
                          {bulkBatchOptions.map((batch) => (
                            <option key={batch.id} value={batch.id}>{batch.name} ({batch.isGlobal ? "Global" : batch.department?.name || "-"})</option>
                          ))}
                        </select>
                        <p className="flex items-center text-sm text-text-secondary">
                          Selected: <span className="ml-1 font-semibold text-text-primary">{selectedStudentIds.length}</span>
                        </p>
                        <Button variant="outline" disabled={!studentCollegeId || students.length === 0} onClick={toggleVisibleStudentSelection}>
                          {allVisibleStudentsSelected ? "Clear Visible" : "Select Visible"}
                        </Button>
                        <Button className="bg-primary/100 hover:bg-primary" disabled={bulkAssignStudentsMutation.isPending || !bulkBatchId || selectedStudentIds.length === 0} onClick={bulkAssignStudents}>
                          {bulkAssignStudentsMutation.isPending ? "Adding..." : "Add to Batch"}
                        </Button>
                        {selectedStudentDepartmentIds.length > 1 ? (
                          <p className="text-xs text-text-secondary lg:col-span-4">Multiple departments selected. Only global batches that include all selected departments are available.</p>
                        ) : null}
                      </div>
                      
                      {!studentCollegeId ? <p className="mb-4 text-sm text-text-secondary">Choose a college to load its students.</p> : null}
                      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
                        <div className="space-y-2">
                          {studentsQuery.isLoading ? (
                            <div className="space-y-2">
                              <SkeletonBlock className="h-16" />
                              <SkeletonBlock className="h-16" />
                              <SkeletonBlock className="h-16" />
                            </div>
                          ) : null}
                          {studentCollegeId && !studentsQuery.isLoading && students.length === 0 ? <p className="text-sm text-text-secondary">No students found for this college.</p> : null}
                          {students.map((student) => (
                            <div
                              key={student.id}
                              onClick={() => {
                                setSelectedStudentId(student.id);
                                setBatchIdInput("");
                              }}
                              className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left ${selectedStudentId === student.id ? "border-primary/40 bg-primary/10" : "border-border"}`}
                            >
                              <input
                                type="checkbox"
                                className="size-4"
                                checked={selectedStudentIds.includes(student.id)}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => toggleStudentSelection(student)}
                              />
                              <div>
                                <p className="font-medium text-text-primary">{student.fullName}</p>
                                <p className="text-xs text-text-secondary">{student.email} • {student.studentId}</p>
                              </div>
                              <div className="text-right text-xs text-text-secondary">
                                <p>{student.department?.name || "-"}</p>
                                <p>{Array.isArray(student.batchIds) && student.batchIds.length > 0 ? `${student.batchIds.length} batch(es)` : "No batches"}</p>
                              </div>
                            </div>
                          ))}
                          {(studentPagination?.pages || 1) > 1 ? (
                            <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
                              <p>Page {studentPagination?.page || studentPage} of {studentPagination?.pages || 1}</p>
                              <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" disabled={(studentPagination?.page || studentPage) <= 1} onClick={() => setStudentPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                                <Button variant="outline" size="sm" disabled={(studentPagination?.page || 1) >= (studentPagination?.pages || 1)} onClick={() => setStudentPage((prev) => prev + 1)}>Next</Button>
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
                              
                              {Array.isArray(selectedStudent.batchIds) && selectedStudent.batchIds.length > 0 ? (
                                <div className="border-t border-border pt-2">
                                  <p className="text-xs font-medium text-text-primary mb-2">Assigned Batches:</p>
                                  <div className="space-y-1">
                                    {selectedStudent.batchIds.map((batchId) => {
                                      const batch = studentBatchOptions.find(b => b.id === batchId);
                                      return batch ? (
                                        <div key={batchId} className="flex items-center justify-between rounded-md bg-primary/5 px-2 py-1 text-xs">
                                          <span className="text-text-primary">{batch.name}</span>
                                        </div>
                                      ) : null;
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-text-secondary italic">No batches assigned yet</p>
                              )}
            
                              <div className="grid gap-2 sm:grid-cols-3 border-t border-border pt-2">
                                <select className="h-10 rounded-md border border-border px-3 text-sm sm:col-span-2" value={batchIdInput} onChange={(event) => setBatchIdInput(event.target.value)}>
                                  <option value="">Select batch to add</option>
                                  {studentBatchOptions.map((batch) => (
                                    <option key={batch.id} value={batch.id}>{batch.name} ({batch.isGlobal ? "Global" : batch.department?.name || "-"})</option>
                                  ))}
                                </select>
                                <Button
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

      <TypedConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Typed Confirmation Required"
        description={`Delete ${pendingDelete?.name || "this batch"}? This will detach linked students and tests.`}
        expectedText={`DELETE ${pendingDelete?.name || ""}`}
        inputLabel="Type the exact phrase"
        confirmLabel="Delete Batch"
        confirmVariant="destructive"
        onConfirm={async (typedText) => {
          if (pendingDelete?.id) {
            deleteBatchMutation.mutate({ batchId: pendingDelete.id, confirmationText: typedText });
          }
        }}
      />
    </div>
  );
}
