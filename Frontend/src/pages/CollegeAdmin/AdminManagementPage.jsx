import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchDepartments } from "@/features/Admin/adminPanelSlice";
import { adminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import { KeyRound, Plus, RotateCcw, ShieldCheck, ShieldOff, ShieldUser } from "lucide-react";
import { DataTable, EmptyState, FormField, PageHeader, SearchInput, SectionCard, StatusBadge } from "@/components/common/page-kit";
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

  const hasFilters = Boolean(filters.search || filters.status !== "all" || filters.departmentId);

  const columns = [
    {
      key: "admin",
      header: "Admin",
      primary: true,
      cell: (admin) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-text-primary">{admin.fullName}</p>
          <p className="truncate text-xs text-text-secondary">{admin.email}</p>
        </div>
      ),
    },
    { key: "employeeId", header: "Employee ID", className: "font-mono text-xs text-text-secondary", cell: (admin) => admin.employeeId || "—" },
    { key: "department", header: "Department", className: "text-text-secondary", cell: (admin) => admin.department?.name || "No department" },
    {
      key: "access",
      header: "Access",
      cell: (admin) => (
        <select
          aria-label={`Access profile for ${admin.fullName}`}
          className="ui-select h-9"
          value={admin.accessProfile || "EDITOR"}
          onChange={(event) => handleProfileChange(admin.id, event.target.value)}
        >
          <option value="EDITOR">Can Edit</option>
          <option value="VIEW_ONLY">View Only</option>
        </select>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (admin) => <StatusBadge tone={admin.isActive ? "success" : "danger"}>{admin.isActive ? "Active" : "Inactive"}</StatusBadge>,
    },
    {
      key: "actions",
      actions: true,
      align: "right",
      cell: (admin) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button size="lg" variant="outline" className="rounded-lg" onClick={() => setResetDialog({ open: true, admin, password: "" })}>
            <KeyRound className="size-4" />
            Reset Password
          </Button>
          {admin.isActive ? (
            <Button size="lg" variant="ghost" className="rounded-lg text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setPendingDeactivate(admin)}>
              <ShieldOff className="size-4" />
              Deactivate
            </Button>
          ) : (
            <Button size="lg" variant="ghost" className="rounded-lg text-success hover:bg-success/10 hover:text-success" onClick={() => setPendingReactivate(admin)}>
              <ShieldCheck className="size-4" />
              Reactivate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Admin management" description="Create department admins for your college and control their access." />

      <SectionCard title="Create department admin" description="Department admins manage students, batches, and tests for one department.">
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            handleCreate();
          }}
        >
          <FormField label="Full name" htmlFor="managed-admin-name" required>
            <Input id="managed-admin-name" className="h-10 rounded-lg" value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} />
          </FormField>
          <FormField label="Email" htmlFor="managed-admin-email" required>
            <Input id="managed-admin-email" type="email" autoComplete="off" className="h-10 rounded-lg" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
          </FormField>
          <FormField label="Employee ID" htmlFor="managed-admin-employee" required>
            <Input id="managed-admin-employee" className="h-10 rounded-lg" value={form.employeeId} onChange={(event) => setForm((prev) => ({ ...prev, employeeId: event.target.value }))} />
          </FormField>
          <FormField label="Password" htmlFor="managed-admin-password" required>
            <Input id="managed-admin-password" type="password" autoComplete="new-password" className="h-10 rounded-lg" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
          </FormField>
          <FormField label="Department" htmlFor="managed-admin-department" required>
            <select id="managed-admin-department" className="ui-select w-full" value={form.departmentId} onChange={(event) => setForm((prev) => ({ ...prev, departmentId: event.target.value }))}>
              <option value="">Select department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Access" htmlFor="managed-admin-access">
            <select id="managed-admin-access" className="ui-select w-full" value={form.accessProfile} onChange={(event) => setForm((prev) => ({ ...prev, accessProfile: event.target.value }))}>
              <option value="EDITOR">Can Edit</option>
              <option value="VIEW_ONLY">View Only</option>
            </select>
          </FormField>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button type="submit" className="h-10 rounded-lg px-4" disabled={loading}>
              <Plus className="size-4" />
              {loading ? "Creating..." : "Create Admin"}
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard flush title="Manage admins">
        <form
          className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            reload();
          }}
        >
          <SearchInput
            className="min-w-0 flex-1 basis-60"
            placeholder="Search by name, email, or employee id"
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          />
          <select aria-label="Status" className="ui-select" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select aria-label="Department" className="ui-select" value={filters.departmentId} onChange={(event) => setFilters((prev) => ({ ...prev, departmentId: event.target.value }))}>
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
          <Button type="submit" className="h-10 rounded-lg px-4">Apply Filters</Button>
          <Button
            type="button"
            variant="ghost"
            className="h-10 rounded-lg px-4"
            disabled={!hasFilters}
            onClick={() => {
              setFilters({ search: "", status: "all", departmentId: "" });
              setRefreshNonce((value) => value + 1);
            }}
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
        </form>

        <DataTable
          columns={columns}
          rows={admins}
          getRowKey={(admin) => admin.id}
          loading={adminsQuery.isLoading}
          minWidth={960}
          caption="Admins"
          rowClassName={(admin) => (admin.isActive ? "" : "bg-muted/30")}
          empty={
            <EmptyState
              icon={ShieldUser}
              title={hasFilters ? "No admins match these filters" : "No admins found"}
              description={hasFilters ? "Try clearing the filters." : "Create your first department admin above."}
              className="border-0"
            />
          }
        />
      </SectionCard>

      <AlertDialog open={resetDialog.open} onOpenChange={(open) => setResetDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Admin Password</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new password for {resetDialog.admin?.fullName || "this admin"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormField label="New password" htmlFor="managed-admin-reset" hint="Minimum 8 characters.">
            <Input
              id="managed-admin-reset"
              type="password"
              autoComplete="new-password"
              className="h-10 rounded-lg"
              value={resetDialog.password}
              onChange={(event) => setResetDialog((prev) => ({ ...prev, password: event.target.value }))}
            />
          </FormField>
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
