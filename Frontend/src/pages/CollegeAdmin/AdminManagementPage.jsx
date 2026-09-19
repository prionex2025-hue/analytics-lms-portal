import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchDepartments } from "@/features/Admin/adminPanelSlice";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const initialForm = {
  fullName: "",
  email: "",
  employeeId: "",
  password: "",
  departmentId: "",
  accessProfile: "EDITOR",
};

export default function AdminManagementPage() {
  const dispatch = useDispatch();
  const departments = useSelector((state) => state.adminPanel.departments.data || []);
  const [form, setForm] = useState(initialForm);
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    departmentId: "",
  });
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [resetDialog, setResetDialog] = useState({ open: false, admin: null, password: "" });
  const [pendingDeactivate, setPendingDeactivate] = useState(null);
  const [pendingReactivate, setPendingReactivate] = useState(null);

  useEffect(() => {
    dispatch(fetchDepartments());
  }, [dispatch]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("limit", "100");
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.departmentId) params.set("departmentId", filters.departmentId);
    return `?${params.toString()}`;
  }, [filters]);

  const adminsQuery = useQuery({
    queryKey: ["college-admin-managed-admins", query, refreshNonce],
    queryFn: () => adminApi.getManagedAdmins(query),
  });

  const admins = adminsQuery.data?.data || [];

  const reload = () => {
    setRefreshNonce((value) => value + 1);
    adminsQuery.refetch();
  };

  const handleCreate = async () => {
    const payload = {
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      employeeId: form.employeeId.trim(),
      password: form.password,
      departmentId: form.departmentId,
      accessProfile: form.accessProfile,
    };

    if (!payload.fullName || !payload.email || !payload.employeeId || !payload.password || !payload.departmentId) {
      toast.error("Please fill all required fields.");
      return;
    }

    try {
      setLoading(true);
      await adminApi.createManagedAdmin(payload);
      toast.success("Admin created successfully");
      setForm(initialForm);
      reload();
    } catch (error) {
      toast.error(error?.message || "Failed to create admin");
    } finally {
      setLoading(false);
    }
  };

  const handleProfileChange = async (adminId, accessProfile) => {
    try {
      await adminApi.updateManagedAdmin(adminId, { accessProfile });
      toast.success("Access profile updated");
      reload();
    } catch (error) {
      toast.error(error?.message || "Failed to update access profile");
    }
  };

  const handleResetPassword = async () => {
    if (!resetDialog.admin?.id || resetDialog.password.trim().length < 8) return;
    try {
      await adminApi.resetManagedAdminPassword(resetDialog.admin.id, { password: resetDialog.password.trim() });
      toast.success("Password reset successfully");
      setResetDialog({ open: false, admin: null, password: "" });
    } catch (error) {
      toast.error(error?.message || "Failed to reset password");
    }
  };

  const reactivateAdmin = async () => {
    if (!pendingReactivate?.id) return;
    try {
      await adminApi.updateManagedAdmin(pendingReactivate.id, { isActive: true });
      toast.success("Admin reactivated");
      setPendingReactivate(null);
      reload();
    } catch (error) {
      toast.error(error?.message || "Failed to reactivate admin");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Create Department Admin</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Input placeholder="Full Name" value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} />
          <Input placeholder="Email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
          <Input placeholder="Employee ID" value={form.employeeId} onChange={(event) => setForm((prev) => ({ ...prev, employeeId: event.target.value }))} />
          <Input type="password" placeholder="Password" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
          <select className="h-10 rounded-lg border border-border px-2" value={form.departmentId} onChange={(event) => setForm((prev) => ({ ...prev, departmentId: event.target.value }))}>
            <option value="">Select department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
          <select className="h-10 rounded-lg border border-border px-2" value={form.accessProfile} onChange={(event) => setForm((prev) => ({ ...prev, accessProfile: event.target.value }))}>
            <option value="EDITOR">Can Edit</option>
            <option value="VIEW_ONLY">View Only</option>
          </select>
          <Button className="sm:col-span-3 bg-primary hover:bg-primary/90" disabled={loading} onClick={handleCreate}>
            {loading ? "Creating..." : "Create Admin"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Manage Admins</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              placeholder="Search by name, email, or employee id"
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            />
            <select className="h-10 rounded-lg border border-border px-2" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select className="h-10 rounded-lg border border-border px-2" value={filters.departmentId} onChange={(event) => setFilters((prev) => ({ ...prev, departmentId: event.target.value }))}>
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={reload}>Apply Filters</Button>
            <Button
              variant="outline"
              onClick={() => {
                setFilters({ search: "", status: "all", departmentId: "" });
                setRefreshNonce((value) => value + 1);
              }}
            >
              Reset
            </Button>
          </div>

          {adminsQuery.isLoading ? <p className="text-sm text-text-secondary">Loading admins...</p> : null}
          {!adminsQuery.isLoading && admins.length === 0 ? <p className="text-sm text-text-secondary">No admins found.</p> : null}

          {admins.map((admin) => (
            <div key={admin.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
              <div>
                <p className="font-medium text-text-primary">{admin.fullName}</p>
                <p className="text-xs text-text-secondary">{admin.email} • {admin.employeeId} • {admin.department?.name || "No department"}</p>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${admin.isActive ? "bg-green-500/10 text-green-700" : "bg-red-500/10 text-red-700"}`}>
                  {admin.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-8 rounded-lg border border-border px-2 text-xs"
                  value={admin.accessProfile || "EDITOR"}
                  onChange={(event) => handleProfileChange(admin.id, event.target.value)}
                >
                  <option value="EDITOR">Can Edit</option>
                  <option value="VIEW_ONLY">View Only</option>
                </select>
                <Button size="sm" onClick={() => setResetDialog({ open: true, admin, password: "" })}>Reset Password</Button>
                {admin.isActive ? (
                  <Button size="sm" variant="destructive" onClick={() => setPendingDeactivate(admin)}>Deactivate</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setPendingReactivate(admin)}>Reactivate</Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={resetDialog.open} onOpenChange={(open) => setResetDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Admin Password</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new password for {resetDialog.admin?.fullName || "this admin"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="password"
            value={resetDialog.password}
            onChange={(event) => setResetDialog((prev) => ({ ...prev, password: event.target.value }))}
            placeholder="Minimum 8 characters"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setResetDialog({ open: false, admin: null, password: "" })}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={resetDialog.password.trim().length < 8} onClick={handleResetPassword}>Reset Password</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TypedConfirmDialog
        open={Boolean(pendingDeactivate)}
        onOpenChange={(open) => !open && setPendingDeactivate(null)}
        title="Deactivate Admin"
        description={`Type the phrase to deactivate ${pendingDeactivate?.fullName || "this admin"}.`}
        expectedText={`DEACTIVATE ${pendingDeactivate?.employeeId || pendingDeactivate?.id || ""}`}
        inputLabel="Confirmation"
        confirmLabel="Deactivate"
        confirmVariant="destructive"
        onConfirm={async (confirmationText) => {
          if (!pendingDeactivate?.id) return;
          try {
            await adminApi.deactivateManagedAdmin(pendingDeactivate.id, { confirmationText });
            toast.success("Admin deactivated");
            setPendingDeactivate(null);
            reload();
          } catch (error) {
            toast.error(error?.message || "Failed to deactivate admin");
          }
        }}
      />

      <ConfirmActionDialog
        open={Boolean(pendingReactivate)}
        onOpenChange={(open) => !open && setPendingReactivate(null)}
        title="Reactivate Admin"
        description={`Reactivate ${pendingReactivate?.fullName || "this admin"}? They will regain portal access.`}
        confirmLabel="Reactivate"
        confirmVariant="default"
        onConfirm={reactivateAdmin}
      />
    </div>
  );
}
