import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { fetchDepartments } from "@/features/Admin/adminPanelSlice";
import { adminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import { Building2, Check, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { DataTable, EmptyState, FormField, PageHeader, SearchInput, SectionCard, StatusBadge } from "@/components/common/page-kit";

export default function DepartmentsManagementPage() {
  const dispatch = useDispatch();
  const departments = useSelector((state) => state.adminPanel.departments.data || []);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState("");

  const reloadDepartments = useCallback(async () => {
    await dispatch(fetchDepartments());
  }, [dispatch]);

  useEffect(() => {
    Promise.resolve(reloadDepartments()).finally(() => setListLoading(false));
  }, [reloadDepartments]);

  const createDepartment = async () => {
    if (!name.trim()) {
      toast.error("Department name is required");
      return;
    }

    try {
      setLoading(true);
      await adminApi.createDepartment({ name: name.trim() });
      toast.success("Department created");
      setName("");
      await reloadDepartments();
    } catch (error) {
      toast.error(error?.message || "Failed to create department");
    } finally {
      setLoading(false);
    }
  };

  const saveDepartment = async (departmentId) => {
    if (!editingName.trim()) {
      toast.error("Department name is required");
      return;
    }

    try {
      await adminApi.updateDepartment(departmentId, { name: editingName.trim() });
      toast.success("Department updated");
      setEditingId("");
      setEditingName("");
      await reloadDepartments();
    } catch (error) {
      toast.error(error?.message || "Failed to update department");
    }
  };

  const toggleDepartment = async (department) => {
    try {
      await adminApi.updateDepartment(department.id, { isActive: !department.isActive });
      toast.success(`Department ${department.isActive ? "deactivated" : "activated"}`);
      await reloadDepartments();
    } catch (error) {
      toast.error(error?.message || "Failed to update department status");
    }
  };

  const filteredDepartments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? departments.filter((department) => String(department.name || "").toLowerCase().includes(query)) : departments;
  }, [departments, search]);
  const activeCount = departments.filter((department) => department.isActive !== false).length;
  const cancelEdit = () => {
    setEditingId("");
    setEditingName("");
  };

  const columns = [
    {
      key: "name",
      header: "Department",
      primary: true,
      cell: (department) =>
        editingId === department.id ? (
          <form
            className="max-w-sm"
            onSubmit={(event) => {
              event.preventDefault();
              saveDepartment(department.id);
            }}
          >
            <Input
              autoFocus
              aria-label="Department name"
              className="h-9 rounded-lg"
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") cancelEdit();
              }}
            />
          </form>
        ) : (
          <span className="font-medium text-text-primary">{department.name}</span>
        ),
    },
    { key: "students", header: "Students", align: "right", className: "tabular-nums", cell: (department) => department?._count?.students || 0 },
    { key: "batches", header: "Batches", align: "right", className: "tabular-nums", cell: (department) => department?._count?.batches || 0 },
    { key: "tests", header: "Tests", align: "right", className: "tabular-nums", cell: (department) => department?._count?.tests || 0 },
    { key: "admins", header: "Admins", align: "right", className: "tabular-nums", cell: (department) => department?._count?.admins || 0 },
    {
      key: "status",
      header: "Status",
      cell: (department) => (
        <StatusBadge tone={department.isActive !== false ? "success" : "danger"}>{department.isActive !== false ? "Active" : "Inactive"}</StatusBadge>
      ),
    },
    {
      key: "actions",
      actions: true,
      align: "right",
      cell: (department) =>
        editingId === department.id ? (
          <div className="flex justify-end gap-1.5">
            <Button size="lg" className="rounded-lg" onClick={() => saveDepartment(department.id)}>
              <Check className="size-4" />
              Save
            </Button>
            <Button size="lg" variant="outline" className="rounded-lg" onClick={cancelEdit}>
              <X className="size-4" />
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button
              size="lg"
              variant="outline"
              className="rounded-lg"
              onClick={() => {
                setEditingId(department.id);
                setEditingName(department.name);
              }}
            >
              <Pencil className="size-4" />
              Edit
            </Button>
            <Button size="lg" variant="ghost" className="rounded-lg" onClick={() => toggleDepartment(department)}>
              <Power className="size-4" />
              {department.isActive !== false ? "Deactivate" : "Activate"}
            </Button>
            <Button size="lg" variant="ghost" className="rounded-lg text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setPendingDelete(department)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Departments" description={`${departments.length} departments · ${activeCount} active`} />

      <SectionCard title="Create department">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            createDepartment();
          }}
        >
          <FormField label="Department name" htmlFor="new-department-name" className="flex-1 sm:max-w-md" required>
            <Input id="new-department-name" className="h-10 rounded-lg" value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          <Button type="submit" className="h-10 rounded-lg px-4" disabled={loading}>
            <Plus className="size-4" />
            {loading ? "Creating..." : "Create"}
          </Button>
        </form>
      </SectionCard>

      <SectionCard
        flush
        title="All departments"
        actions={<SearchInput className="w-full sm:w-64" placeholder="Search departments" value={search} onChange={(event) => setSearch(event.target.value)} />}
      >
        <DataTable
          columns={columns}
          rows={filteredDepartments}
          getRowKey={(department) => department.id}
          loading={listLoading && departments.length === 0}
          minWidth={860}
          caption="Departments"
          rowClassName={(department) => (department.isActive === false ? "bg-muted/30" : "")}
          empty={
            <EmptyState
              icon={Building2}
              title={search ? "No departments match your search" : "No departments found"}
              description={search ? "Try a different name." : "Create your first department above."}
              className="border-0"
            />
          }
        />
      </SectionCard>

      <TypedConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete Department"
        description={`Delete ${pendingDelete?.name || "this department"} permanently? This works only when no linked admins, students, batches, or tests exist.`}
        expectedText={`DELETE ${pendingDelete?.name || ""}`}
        inputLabel="Type confirmation"
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async (confirmationText) => {
          if (!pendingDelete?.id) return;
          try {
            await adminApi.deleteDepartment(pendingDelete.id, { confirmationText });
            toast.success("Department deleted");
            setPendingDelete(null);
            await reloadDepartments();
          } catch (error) {
            toast.error(error?.message || "Failed to delete department");
          }
        }}
      />
    </div>
  );
}
