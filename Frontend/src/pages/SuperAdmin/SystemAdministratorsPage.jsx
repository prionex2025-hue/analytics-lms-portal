import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Plus, RotateCcw, ShieldCheck, ShieldOff, UserCheck, UserCog, UserX, Users } from "lucide-react";
import { superAdminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import { DataTable, EmptyState, FormField, PageHeader, SearchInput, SectionCard, StatTile, StatusBadge, Toolbar } from "@/components/common/page-kit";
import { ui } from "@/styles/ui-tokens";

const initialForm = {
  name: "",
  email: "",
  password: "",
};

const initialFilters = {
  search: "",
  status: "all",
};

const passwordIsStrong = (value) =>
  value.length >= 8 &&
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /\d/.test(value) &&
  /[^A-Za-z0-9]/.test(value);

const formatDate = (value) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function SystemAdministratorsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [pendingAction, setPendingAction] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: "1", limit: "100" });
    if (appliedFilters.search.trim()) params.set("search", appliedFilters.search.trim());
    if (appliedFilters.status !== "all") params.set("status", appliedFilters.status);
    return `?${params.toString()}`;
  }, [appliedFilters]);

  const adminsQuery = useQuery({
    queryKey: ["superadmin-system-admins", queryString],
    queryFn: () => superAdminApi.getSystemAdmins(queryString),
  });

  const systemAdmins = adminsQuery.data?.data || [];
  const counts = adminsQuery.data?.counts || {};
  const activeCount = Number(counts.activeSuperAdmins || 0);
  const totalCount = Number(counts.totalSuperAdmins || systemAdmins.length || 0);
  const remainingSlots = Number(counts.remainingSlots || 0);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["superadmin-system-admins"] });

  const createMutation = useMutation({
    mutationFn: superAdminApi.createSystemAdmin,
    onSuccess: () => {
      toast.success("System administrator created.");
      setForm(initialForm);
      invalidate();
    },
    onError: (error) => toast.error(error?.message || "Unable to create system administrator."),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }) => superAdminApi.updateSystemAdminStatus(id, { isActive }),
    onSuccess: (_, variables) => {
      toast.success(variables.isActive ? "System administrator reactivated." : "System administrator deactivated.");
      setPendingAction(null);
      invalidate();
    },
    onError: (error) => toast.error(error?.message || "Unable to update system administrator."),
  });

  const resetMutation = useMutation({
    mutationFn: ({ id, password }) => superAdminApi.resetSystemAdminPassword(id, { password }),
    onSuccess: () => {
      toast.success("Password reset.");
      setPendingAction(null);
      setResetPasswordValue("");
      invalidate();
    },
    onError: (error) => toast.error(error?.message || "Unable to reset password."),
  });

  const createAdmin = () => {
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
    };

    if (!payload.name || !payload.email || !payload.password) {
      toast.error("Name, email, and password are required.");
      return;
    }

    if (!passwordIsStrong(payload.password)) {
      toast.error("Password must include uppercase, lowercase, number, and special character.");
      return;
    }

    createMutation.mutate(payload);
  };

  const openReset = (admin) => {
    setResetPasswordValue("");
    setPendingAction({ type: "reset", admin });
  };

  const openDeactivate = (admin) => {
    setPendingAction({ type: "deactivate", admin });
  };

  const openReactivate = (admin) => {
    setPendingAction({ type: "reactivate", admin });
  };

  const confirmReset = () => {
    if (!passwordIsStrong(resetPasswordValue)) {
      toast.error("Password must include uppercase, lowercase, number, and special character.");
      return;
    }
    resetMutation.mutate({ id: pendingAction.admin.id, password: resetPasswordValue });
  };

  const applyFilters = () => setAppliedFilters(filters);

  const resetFilters = () => {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
  };

  const passwordHint = "8+ characters with upper and lower case, a number, and a symbol.";

  const columns = [
    {
      key: "name",
      header: "Administrator",
      primary: true,
      cell: (admin) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-text-primary">{admin.fullName || admin.name}</p>
          <p className="truncate text-xs text-text-secondary">{admin.email}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (admin) => <StatusBadge tone={admin.isActive ? "success" : "danger"}>{admin.isActive ? "Active" : "Inactive"}</StatusBadge>,
    },
    { key: "created", header: "Created", className: "whitespace-nowrap text-text-secondary", cell: (admin) => formatDate(admin.createdAt) },
    { key: "lastLogin", header: "Last login", className: "whitespace-nowrap text-text-secondary", cell: (admin) => formatDate(admin.lastLoginAt) },
    {
      key: "actions",
      actions: true,
      align: "right",
      cell: (admin) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="lg" variant="outline" className="rounded-lg" onClick={() => openReset(admin)}>
            <KeyRound className="size-4" />
            Reset password
          </Button>
          {admin.isActive ? (
            <Button
              size="lg"
              variant="ghost"
              className="rounded-lg text-danger hover:bg-danger/10 hover:text-danger"
              onClick={() => openDeactivate(admin)}
              disabled={activeCount <= 1}
              title={activeCount <= 1 ? "At least one active system administrator is required" : undefined}
            >
              <ShieldOff className="size-4" />
              Deactivate
            </Button>
          ) : (
            <Button size="lg" variant="outline" className="rounded-lg" onClick={() => openReactivate(admin)}>
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
      <PageHeader
        title="System administrators"
        description="Super admin accounts with full platform access. At least one must remain active."
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile icon={Users} label="Total" value={totalCount} />
        <StatTile icon={UserCheck} label="Active" value={activeCount} tone="success" />
        <StatTile icon={UserX} label="Inactive" value={Number(counts.inactiveSuperAdmins || 0)} tone="danger" />
        <StatTile icon={UserCog} label="Remaining slots" value={remainingSlots} tone={remainingSlots > 0 ? "neutral" : "warning"} />
      </div>

      <SectionCard
        title="Create system administrator"
        description={remainingSlots <= 0 ? "All slots are in use. Deactivate an account to free a slot." : `${remainingSlots} slot${remainingSlots === 1 ? "" : "s"} available.`}
      >
        <form
          className="grid gap-4 lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            createAdmin();
          }}
        >
          <FormField label="Full name" htmlFor="sysadmin-name" required>
            <Input id="sysadmin-name" className={ui.field} autoComplete="off" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </FormField>
          <FormField label="Email" htmlFor="sysadmin-email" required>
            <Input id="sysadmin-email" className={ui.field} type="email" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </FormField>
          <FormField label="Password" htmlFor="sysadmin-password" hint={passwordHint} required>
            <Input id="sysadmin-password" className={ui.field} type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          </FormField>
          <div className="lg:col-span-3">
            <Button type="submit" className={ui.btn} disabled={createMutation.isPending || remainingSlots <= 0}>
              <Plus className="size-4" />
              {createMutation.isPending ? "Creating..." : "Create System Administrator"}
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        flush
        title="All system administrators"
        actions={
          <form
            className="flex w-full flex-wrap gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters();
            }}
          >
            <SearchInput
              className="min-w-0 flex-1 sm:w-64 sm:flex-none"
              placeholder="Search by name or email"
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            />
            <select
              className="ui-select"
              aria-label="Status"
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <Button type="submit" className={ui.btn}>Search</Button>
            <Button type="button" variant="ghost" className={ui.btn} onClick={resetFilters}>
              <RotateCcw className="size-4" />
              Reset
            </Button>
          </form>
        }
      >
        <DataTable
          columns={columns}
          rows={systemAdmins}
          getRowKey={(admin) => admin.id}
          loading={adminsQuery.isLoading}
          minWidth={820}
          caption="System administrators"
          empty={<EmptyState icon={UserCog} title="No system administrators found" description="Try a different search or status filter." className="border-0" />}
        />
      </SectionCard>

      <AlertDialog open={pendingAction?.type === "reset"} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset System Administrator Password</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new password for {pendingAction?.admin?.fullName || pendingAction?.admin?.email || "this account"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormField label="New password" htmlFor="sysadmin-reset-password" hint={passwordHint}>
            <Input
              id="sysadmin-reset-password"
              type="password"
              autoComplete="new-password"
              className={ui.field}
              value={resetPasswordValue}
              onChange={(event) => setResetPasswordValue(event.target.value)}
            />
          </FormField>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setResetPasswordValue("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={resetMutation.isPending || !passwordIsStrong(resetPasswordValue)} onClick={confirmReset}>
              Change Password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TypedConfirmDialog
        open={pendingAction?.type === "deactivate"}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title="Typed Confirmation Required"
        description={`This will immediately disable ${pendingAction?.admin?.fullName || "this system administrator"}. Type the confirmation text to proceed.`}
        expectedText={`DEACTIVATE ${pendingAction?.admin?.email || ""}`}
        inputLabel="Type the exact phrase"
        confirmLabel="Deactivate"
        confirmVariant="destructive"
        onConfirm={() => statusMutation.mutate({ id: pendingAction.admin.id, isActive: false })}
      />

      <AlertDialog open={pendingAction?.type === "reactivate"} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate System Administrator</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.admin?.fullName || pendingAction?.admin?.email || "This account"} will be able to sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => statusMutation.mutate({ id: pendingAction.admin.id, isActive: true })}>
              Reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
