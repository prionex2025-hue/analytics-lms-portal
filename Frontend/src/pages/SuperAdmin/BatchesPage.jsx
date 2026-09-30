import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { superAdminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, ClipboardList, GraduationCap, Layers3, Pencil, Plus, RotateCcw, Trash2, UserPlus, X } from "lucide-react";
import {
  Callout,
  DataTable,
  DetailList,
  EmptyState,
  ErrorState,
  FormField,
  PageHeader,
  PaginationBar,
  SearchInput,
  SectionCard,
  StatusBadge,
} from "@/components/common/page-kit";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

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
  }, [assignBatches, assignBatchSearch, selectedTest]);

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

  const batchScopeLabel = (batch) =>
    batch.isGlobal
      ? `Global (${batch.departments?.map((department) => department.name).join(", ") || `${batch.departmentIds?.length || 0} departments`})`
      : batch.department?.name || "-";

  const batchColumns = [
    {
      key: "batch",
      header: "Batch",
      primary: true,
      cell: (batch) =>
        editBatchId === batch.id ? (
          <div className="grid min-w-72 gap-2 sm:grid-cols-[minmax(0,1.4fr)_90px]">
            <Input aria-label="Batch name" className="h-9 rounded-lg" value={editForm.name} onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))} />
            <Input
              aria-label="Year"
              type="number"
              min={2000}
              max={2100}
              className="h-9 rounded-lg"
              value={editForm.year}
              onChange={(e) => setEditForm((prev) => ({ ...prev, year: Number(e.target.value) || "" }))}
            />
          </div>
        ) : (
          <div className="min-w-0">
            <p className="font-medium text-text-primary">
              {batch.name} <span className="font-normal text-text-secondary">({batch.year})</span>
            </p>
            {batch.isGlobal ? <StatusBadge tone="info" className="mt-1 h-5 px-2 text-[11px]">Global</StatusBadge> : null}
          </div>
        ),
    },
    { key: "college", header: "College", className: "text-text-secondary", cell: (batch) => batch.college?.name || "-" },
    {
      key: "department",
      header: "Department",
      className: "max-w-64",
      cell: (batch) =>
        editBatchId === batch.id && !batch.isGlobal ? (
          <select
            aria-label="Department"
            className="ui-select h-9 w-full"
            value={editForm.departmentId}
            onChange={(e) => setEditForm((prev) => ({ ...prev, departmentId: e.target.value }))}
          >
            <option value="">Select department</option>
            {editDepartmentOptions.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
        ) : (
          <span className="line-clamp-2 text-text-secondary" title={batchScopeLabel(batch)}>{batchScopeLabel(batch)}</span>
        ),
    },
    { key: "students", header: "Students", align: "right", className: "tabular-nums", cell: (batch) => batch._count?.students || 0 },
    { key: "tests", header: "Tests", align: "right", className: "tabular-nums", cell: (batch) => batch._count?.tests || 0 },
    {
      key: "actions",
      actions: true,
      align: "right",
      cell: (batch) =>
        editBatchId === batch.id ? (
          <div className="flex justify-end gap-1.5">
            <Button size="lg" className="rounded-lg" onClick={() => saveEdit(batch)} disabled={updateBatchMutation.isPending}>
              <Check className="size-4" />
              Save
            </Button>
            <Button size="lg" variant="outline" className="rounded-lg" onClick={() => setEditBatchId("")}>
              <X className="size-4" />
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1.5">
            <Button size="lg" variant="outline" className="rounded-lg" onClick={() => openEdit(batch)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="rounded-lg text-danger hover:bg-danger/10 hover:text-danger"
              onClick={() => setPendingDelete(batch)}
              disabled={deleteBatchMutation.isPending}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </div>
        ),
    },
  ];

  const hasBatchFilters = Boolean(filters.search || filters.collegeId);
  const hasStudentFilters = Boolean(studentCollegeId || search || studentDepartmentId || studentBatchFilterId);

  return (
    <div className="space-y-6">
      <PageHeader title="Batches" description="Create batches across colleges, assign tests to them, and manage which students belong to each batch." />

      <Tabs defaultValue="batches" className="gap-5">
        <div className="relative -mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">
        <TabsList variant="line" className="h-auto! w-full min-w-max justify-start gap-6 rounded-none border-b border-border p-0">
          <TabsTrigger value="batches" className="flex-none rounded-none px-0.5 pt-1 pb-3 text-text-secondary data-active:text-primary after:!bottom-[-1px] after:!bg-primary">
            <Layers3 className="size-4" />
            Batches
          </TabsTrigger>
          <TabsTrigger value="assign" className="flex-none rounded-none px-0.5 pt-1 pb-3 text-text-secondary data-active:text-primary after:!bottom-[-1px] after:!bg-primary">
            <ClipboardList className="size-4" />
            Assign tests
          </TabsTrigger>
          <TabsTrigger value="students" className="flex-none rounded-none px-0.5 pt-1 pb-3 text-text-secondary data-active:text-primary after:!bottom-[-1px] after:!bg-primary">
            <GraduationCap className="size-4" />
            Student membership
          </TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="batches" className="space-y-6">
          <SectionCard title="Create batch" description="Batches belong to one department, or span several departments as a global batch.">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                createBatch();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_110px_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                <FormField label="Batch name" htmlFor="batch-create-name" required>
                  <Input id="batch-create-name" className={ui.field} value={batchForm.name} onChange={(e) => setBatchForm((prev) => ({ ...prev, name: e.target.value }))} />
                </FormField>
                <FormField label="Year" htmlFor="batch-create-year" required>
                  <Input
                    id="batch-create-year"
                    type="number"
                    min={2000}
                    max={2100}
                    className={ui.field}
                    value={batchForm.year}
                    onChange={(e) => setBatchForm((prev) => ({ ...prev, year: Number(e.target.value) || "" }))}
                  />
                </FormField>
                <FormField label="College" htmlFor="batch-create-college" required>
                  <select
                    id="batch-create-college"
                    className="ui-select w-full"
                    value={batchForm.collegeId}
                    onChange={(e) => setBatchForm((prev) => ({ ...prev, collegeId: e.target.value, departmentId: "", departmentIds: [] }))}
                  >
                    <option value="">Select college</option>
                    {colleges.map((college) => (
                      <option key={college.id} value={college.id}>{college.name}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Department" htmlFor="batch-create-department" hint={batchForm.isGlobal ? "Choose departments below." : undefined}>
                  <select
                    id="batch-create-department"
                    className="ui-select w-full"
                    value={batchForm.departmentId}
                    disabled={batchForm.isGlobal}
                    onChange={(e) => setBatchForm((prev) => ({ ...prev, departmentId: e.target.value }))}
                  >
                    <option value="">Select department</option>
                    {createDepartmentOptions.map((department) => (
                      <option key={department.id} value={department.id}>{department.name}</option>
                    ))}
                  </select>
                </FormField>
                <Button type="submit" className={ui.btn} disabled={createBatchMutation.isPending}>
                  <Plus className="size-4" />
                  {createBatchMutation.isPending ? "Creating..." : "Create"}
                </Button>
              </div>

              <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm text-text-primary">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={batchForm.isGlobal}
                  onChange={(e) => setBatchForm((prev) => ({ ...prev, isGlobal: e.target.checked, departmentId: "", departmentIds: [] }))}
                />
                Global batch across departments
              </label>

              {batchForm.isGlobal ? (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-text-primary">
                    Departments <span className="font-normal text-text-secondary">· {batchForm.departmentIds.length} selected</span>
                  </legend>
                  {!batchForm.collegeId ? (
                    <p className="text-sm text-text-secondary">Choose a college first.</p>
                  ) : !createDepartmentsQuery.isLoading && createDepartmentOptions.length === 0 ? (
                    <p className="text-sm text-text-secondary">No departments available for this college.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {createDepartmentOptions.map((department) => {
                        const checked = batchForm.departmentIds.includes(department.id);
                        return (
                          <label
                            key={department.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                              checked ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40"
                            )}
                          >
                            <input
                              type="checkbox"
                              className="ui-checkbox"
                              checked={checked}
                              onChange={() => setBatchForm((prev) => ({
                                ...prev,
                                departmentIds: checked
                                  ? prev.departmentIds.filter((id) => id !== department.id)
                                  : [...prev.departmentIds, department.id],
                              }))}
                            />
                            <span className="text-text-primary">{department.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              ) : null}
            </form>
          </SectionCard>

          <SectionCard
            flush
            title="All batches"
            footer={
              (pagination?.pages || 1) > 1 ? (
                <PaginationBar
                  page={pagination?.page || page}
                  pages={pagination?.pages || 1}
                  disabled={batchesQuery.isFetching}
                  onPageChange={(next) => setPage(Math.max(next, 1))}
                />
              ) : null
            }
          >
            <form
              className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                batchesQuery.refetch();
              }}
            >
              <SearchInput
                className="min-w-0 flex-1 basis-60"
                placeholder="Search by batch/department/college"
                value={filters.search}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, search: e.target.value }));
                  setPage(1);
                }}
              />
              <select
                aria-label="College"
                className="ui-select"
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
              <Button type="submit" variant="outline" className={ui.btn}>Apply Filter</Button>
              <Button type="button" variant="ghost" className={ui.btn} disabled={!hasBatchFilters} onClick={() => { setFilters({ search: "", collegeId: "" }); setPage(1); }}>
                <RotateCcw className="size-4" />
                Reset
              </Button>
            </form>

            {batchesQuery.isError ? (
              <ErrorState className="m-4" title="Failed to load batches" description={batchesQuery.error?.message || "Failed to load batches."} onRetry={() => batchesQuery.refetch()} />
            ) : (
              <DataTable
                columns={batchColumns}
                rows={batches}
                getRowKey={(batch) => batch.id}
                loading={batchesQuery.isLoading}
                minWidth={900}
                caption="Batches"
                empty={
                  <EmptyState
                    icon={Layers3}
                    title={hasBatchFilters ? "No batches found for selected filters" : "No batches yet"}
                    description={hasBatchFilters ? "Try clearing the filters." : "Create the first batch using the form above."}
                    className="border-0"
                  />
                }
              />
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="assign">
          <SectionCard title="Assign test to batches" description="Select a test, then one or more batches from the same college.">
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-end">
                <FormField label="Test" htmlFor="batch-assign-test" required>
                  <select
                    id="batch-assign-test"
                    className="ui-select w-full"
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
                </FormField>
                <SearchInput
                  label="Search batches"
                  placeholder="Search batches"
                  value={assignBatchSearch}
                  onChange={(event) => setAssignBatchSearch(event.target.value)}
                  disabled={!form.testId}
                />
                <Button
                  type="button"
                  className={ui.btn}
                  disabled={assignMutation.isPending || !form.testId || finalBatchIds.length === 0}
                  onClick={assign}
                >
                  {assignMutation.isPending ? "Assigning..." : finalBatchIds.length ? `Assign to ${finalBatchIds.length} batch${finalBatchIds.length === 1 ? "" : "es"}` : "Assign"}
                </Button>
              </div>

              {!form.testId ? (
                <EmptyState icon={ClipboardList} title="Choose a test" description="Eligible batches load once a test is selected." className="py-8" />
              ) : filteredAssignBatches.length === 0 ? (
                <EmptyState icon={Layers3} title="No matching batches" description="No batches match the selected test and search." className="py-8" />
              ) : (
                <div className="grid max-h-96 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
                  {filteredAssignBatches.map((batch) => {
                    const batchId = String(batch.id);
                    const checked = finalBatchIds.includes(batchId);
                    return (
                      <label
                        key={batch.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                          checked ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40"
                        )}
                      >
                        <input type="checkbox" className="ui-checkbox mt-0.5" checked={checked} onChange={() => toggleAssignBatchSelection(batchId)} />
                        <span className="min-w-0">
                          <span className="block font-medium text-text-primary">{batch.name} ({batch.year || "-"})</span>
                          <span className="block truncate text-xs text-text-secondary">{batch.college?.name || "-"} • {batch.department?.name || (batch.isGlobal ? "Global" : "-")}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="students">
          <SectionCard flush title="Student directory" description="Select a college first, then choose students and add them to a batch.">
            <div className="space-y-4 border-b border-border px-4 py-4 sm:px-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto_auto] xl:items-end">
                <FormField label="College" htmlFor="batch-student-college" required>
                  <select id="batch-student-college" className="ui-select w-full" value={studentCollegeId} onChange={(event) => setStudentCollegeId(event.target.value)}>
                    <option value="">Select college</option>
                    {colleges.map((college) => (
                      <option key={college.id} value={college.id}>{college.name}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Department" htmlFor="batch-student-department">
                  <select
                    id="batch-student-department"
                    className="ui-select w-full"
                    value={studentDepartmentId}
                    disabled={!studentCollegeId}
                    onChange={(event) => { setStudentDepartmentId(event.target.value); setStudentPage(1); setSelectedStudentIds([]); setSelectedStudentRecords({}); }}
                  >
                    <option value="">All departments</option>
                    {studentDepartmentOptions.map((department) => (
                      <option key={department.id} value={department.id}>{department.name}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Batch" htmlFor="batch-student-batch">
                  <select
                    id="batch-student-batch"
                    className="ui-select w-full"
                    value={studentBatchFilterId}
                    disabled={!studentCollegeId}
                    onChange={(event) => { setStudentBatchFilterId(event.target.value); setStudentPage(1); setSelectedStudentIds([]); setSelectedStudentRecords({}); }}
                  >
                    <option value="">All batches</option>
                    {studentFilterBatchOptions.map((batch) => (
                      <option key={batch.id} value={batch.id}>{batch.name} ({batch.isGlobal ? "Global" : batch.department?.name || "-"})</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Search" htmlFor="batch-student-search">
                  <SearchInput id="batch-student-search" placeholder="Name or email" value={search} disabled={!studentCollegeId} onChange={(event) => { setSearch(event.target.value); setStudentPage(1); }} />
                </FormField>
                <Button className={ui.btn} variant="outline" disabled={!studentCollegeId} onClick={() => studentsQuery.refetch()}>Apply</Button>
                <Button variant="ghost" className={ui.btn} disabled={!hasStudentFilters} onClick={clearStudentFilters}>
                  <RotateCcw className="size-4" />
                  Reset
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2.5">
                <select
                  aria-label="Batch for selected students"
                  className="ui-select min-w-56 flex-1 sm:flex-none"
                  value={bulkBatchId}
                  disabled={!studentCollegeId}
                  onChange={(event) => setBulkBatchId(event.target.value)}
                >
                  <option value="">Batch for selected students</option>
                  {bulkBatchOptions.map((batch) => (
                    <option key={batch.id} value={batch.id}>{batch.name} ({batch.isGlobal ? "Global" : batch.department?.name || "-"})</option>
                  ))}
                </select>
                <Button className={ui.btn} disabled={bulkAssignStudentsMutation.isPending || !bulkBatchId || selectedStudentIds.length === 0} onClick={bulkAssignStudents}>
                  <UserPlus className="size-4" />
                  {bulkAssignStudentsMutation.isPending ? "Adding..." : "Add to Batch"}
                </Button>
                <Button variant="outline" className={ui.btn} disabled={!studentCollegeId || students.length === 0} onClick={toggleVisibleStudentSelection}>
                  {allVisibleStudentsSelected ? "Clear Visible" : "Select Visible"}
                </Button>
                <span className="ml-auto text-sm text-text-secondary" aria-live="polite">
                  <span className="font-semibold tabular-nums text-text-primary">{selectedStudentIds.length}</span> selected
                </span>
                {selectedStudentDepartmentIds.length > 1 ? (
                  <p className="w-full text-xs text-text-secondary">Multiple departments selected. Only global batches that include all selected departments are available.</p>
                ) : null}
              </div>
            </div>

            {!studentCollegeId ? (
              <EmptyState icon={GraduationCap} title="Choose a college" description="Pick a college above to load its students." className="border-0" />
            ) : (
              <div className="grid xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="min-w-0 xl:border-r xl:border-border">
                  {studentsQuery.isLoading ? (
                    <div className="space-y-2 p-4" aria-busy="true">
                      <SkeletonBlock className="h-14 rounded-lg" />
                      <SkeletonBlock className="h-14 rounded-lg" />
                      <SkeletonBlock className="h-14 rounded-lg" />
                    </div>
                  ) : students.length === 0 ? (
                    <EmptyState icon={GraduationCap} title="No students found" description="No students found for this college and filters." className="border-0" />
                  ) : (
                    <ul className="divide-y divide-border">
                      {students.map((student) => {
                        const isActive = selectedStudentId === student.id;
                        return (
                          <li key={student.id} className={cn("flex items-center gap-3 px-4 py-3 transition-colors sm:px-5", isActive ? "bg-primary/5" : "hover:bg-muted/40")}>
                            <input
                              type="checkbox"
                              className="ui-checkbox"
                              aria-label={`Select ${student.fullName}`}
                              checked={selectedStudentIds.includes(student.id)}
                              onChange={() => toggleStudentSelection(student)}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedStudentId(student.id);
                                setBatchIdInput("");
                              }}
                              aria-pressed={isActive}
                              className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-text-primary">{student.fullName}</span>
                                <span className="block truncate text-xs text-text-secondary">{student.email} • {student.studentId}</span>
                              </span>
                              <span className="shrink-0 text-right text-xs text-text-secondary">
                                <span className="block">{student.department?.name || "-"}</span>
                                <span className="block">{Array.isArray(student.batchIds) && student.batchIds.length > 0 ? `${student.batchIds.length} batch(es)` : "No batches"}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(studentPagination?.pages || 1) > 1 ? (
                    <PaginationBar
                      className="border-t border-border px-4 py-3 sm:px-5"
                      page={studentPagination?.page || studentPage}
                      pages={studentPagination?.pages || 1}
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
                  ) : null}
                  {!selectedStudent ? (
                    <p className="py-6 text-center text-sm text-text-secondary">Select a student to see their profile and batches.</p>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <p className="text-base font-semibold text-text-primary">{selectedStudent.fullName}</p>
                        <p className="text-xs text-text-secondary">{selectedStudent.email} • {selectedStudent.studentId}</p>
                      </div>
                      <DetailList
                        items={[
                          { label: "Department", value: selectedStudent.department?.name || "-" },
                          { label: "Total submissions", value: selectedStudent._count?.submissions || 0 },
                        ]}
                      />
                      <div>
                        <p className="mb-2 text-xs text-text-secondary">Assigned batches</p>
                        {Array.isArray(selectedStudent.batchIds) && selectedStudent.batchIds.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {selectedStudent.batchIds.map((batchId) => {
                              const batch = studentBatchOptions.find((b) => b.id === batchId);
                              return batch ? <StatusBadge key={batchId} tone="info">{batch.name}</StatusBadge> : null;
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-text-secondary italic">No batches assigned yet</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
                        <select aria-label="Batch to add" className="ui-select min-w-0 flex-1" value={batchIdInput} onChange={(event) => setBatchIdInput(event.target.value)}>
                          <option value="">Select batch to add</option>
                          {studentBatchOptions.map((batch) => (
                            <option key={batch.id} value={batch.id}>{batch.name} ({batch.isGlobal ? "Global" : batch.department?.name || "-"})</option>
                          ))}
                        </select>
                        <Button
                          className={ui.btn}
                          onClick={() => assignBatchMutation.mutate({ studentId: selectedStudent.id, batchId: batchIdInput })}
                          disabled={assignBatchMutation.isPending || !batchIdInput}
                        >
                          <Plus className="size-4" />
                          Add Batch
                        </Button>
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

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
