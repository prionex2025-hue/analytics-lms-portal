import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { fetchDepartments } from "@/features/Admin/adminPanelSlice";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";

export default function DepartmentsManagementPage() {
  const dispatch = useDispatch();
  const departments = useSelector((state) => state.adminPanel.departments.data || []);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [loading, setLoading] = useState(false);

  const reloadDepartments = useCallback(async () => {
    await dispatch(fetchDepartments());
  }, [dispatch]);

  useEffect(() => {
    reloadDepartments();
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

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Create Department</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input
            className="max-w-md"
            placeholder="Department name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button onClick={createDepartment} disabled={loading}>
            {loading ? "Creating..." : "Create"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Departments</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {departments.length === 0 ? <p className="text-sm text-text-secondary">No departments found.</p> : null}
          {departments.map((department) => (
            <div key={department.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
              <div className="flex-1">
                {editingId === department.id ? (
                  <Input
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    className="max-w-sm"
                  />
                ) : (
                  <p className="font-medium text-text-primary">{department.name}</p>
                )}
                <p className="text-xs text-text-secondary">
                  Students: {department?._count?.students || 0} | Batches: {department?._count?.batches || 0} | Tests: {department?._count?.tests || 0} | Admins: {department?._count?.admins || 0}
                </p>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${department.isActive !== false ? "bg-green-500/10 text-green-700" : "bg-red-500/10 text-red-700"}`}>
                  {department.isActive !== false ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {editingId === department.id ? (
                  <>
                    <Button size="sm" onClick={() => saveDepartment(department.id)}>Save</Button>
                    <Button size="sm" variant="outline" onClick={() => { setEditingId(""); setEditingName(""); }}>Cancel</Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(department.id);
                      setEditingName(department.name);
                    }}
                  >
                    Edit
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => toggleDepartment(department)}>
                  {department.isActive !== false ? "Deactivate" : "Activate"}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setPendingDelete(department)}>Delete</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

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
