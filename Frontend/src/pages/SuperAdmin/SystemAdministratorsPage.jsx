import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Plus, RotateCcw, ShieldCheck, ShieldOff } from "lucide-react";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl border-border">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase text-text-secondary">Total</p>
            <p className="mt-2 text-2xl font-semibold text-text-primary">{totalCount}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase text-text-secondary">Active</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-600">{activeCount}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase text-text-secondary">Inactive</p>
            <p className="mt-2 text-2xl font-semibold text-rose-600">{Number(counts.inactiveSuperAdmins || 0)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase text-text-secondary">Slots</p>
            <p className="mt-2 text-2xl font-semibold text-primary">{remainingSlots}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Create System Administrator</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-3">
          <Input placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input placeholder="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          <Input placeholder="Password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          <Button className="w-full gap-2 bg-primary hover:bg-primary lg:col-span-3" onClick={createAdmin} disabled={createMutation.isPending || remainingSlots <= 0}>
            <Plus className="size-4" />
            {createMutation.isPending ? "Creating..." : "Create System Administrator"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>System Administrators</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto_auto]">
            <Input
              placeholder="Search by name or email"
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            />
            <select
              className="h-10 rounded-lg border border-border px-2"
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <Button className="w-full bg-primary hover:bg-primary md:w-auto" onClick={applyFilters}>Search</Button>
            <Button variant="outline" className="w-full gap-2 md:w-auto" onClick={resetFilters}>
              <RotateCcw className="size-4" />
              Reset
            </Button>
          </div>

          <div className="space-y-3 md:hidden">
            {adminsQuery.isLoading ? (
              <div className="rounded-xl border border-border px-3 py-6 text-sm text-text-secondary">Loading system administrators...</div>
            ) : null}
            {!adminsQuery.isLoading && systemAdmins.length === 0 ? (
              <div className="rounded-xl border border-border px-3 py-6 text-sm text-text-secondary">No system administrators found.</div>
            ) : null}
            {systemAdmins.map((admin) => (
              <div key={admin.id} className="rounded-xl border border-border p-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate font-medium text-text-primary">{admin.fullName || admin.name}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${admin.isActive ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700"}`}>
                      {admin.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="break-words text-xs text-text-secondary">{admin.email}</p>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-text-secondary">
                  <div className="flex items-center justify-between gap-3">
                    <span>Created</span>
                    <span className="text-right">{formatDate(admin.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Last Login</span>
                    <span className="text-right">{formatDate(admin.lastLoginAt)}</span>
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  <Button size="sm" variant="outline" className="w-full gap-2" onClick={() => openReset(admin)}>
                    <KeyRound className="size-4" />
                    Reset Password
                  </Button>
                  {admin.isActive ? (
                    <Button size="sm" variant="destructive" className="w-full gap-2" onClick={() => openDeactivate(admin)} disabled={activeCount <= 1}>
                      <ShieldOff className="size-4" />
                      Deactivate
                    </Button>
                  ) : (
                    <Button size="sm" className="w-full gap-2 bg-primary hover:bg-primary" onClick={() => openReactivate(admin)}>
                      <ShieldCheck className="size-4" />
                      Reactivate
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
            <div className="grid min-w-[860px] grid-cols-[1.3fr_1.4fr_110px_170px_170px_250px] bg-muted/60 px-3 py-2 text-xs font-semibold uppercase text-text-secondary">
              <span>Name</span>
              <span>Email</span>
              <span>Status</span>
              <span>Created</span>
              <span>Last Login</span>
              <span>Actions</span>
            </div>
            {adminsQuery.isLoading ? (
              <div className="px-3 py-6 text-sm text-text-secondary">Loading system administrators...</div>
            ) : null}
            {!adminsQuery.isLoading && systemAdmins.length === 0 ? (
              <div className="px-3 py-6 text-sm text-text-secondary">No system administrators found.</div>
            ) : null}
            {systemAdmins.map((admin) => (
              <div key={admin.id} className="grid min-w-[860px] grid-cols-[1.3fr_1.4fr_110px_170px_170px_250px] items-center border-t border-border px-3 py-3 text-sm">
                <span className="truncate font-medium text-text-primary">{admin.fullName || admin.name}</span>
                <span className="truncate text-text-secondary">{admin.email}</span>
                <span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${admin.isActive ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700"}`}>
                    {admin.isActive ? "Active" : "Inactive"}
                  </span>
                </span>
                <span className="text-text-secondary">{formatDate(admin.createdAt)}</span>
                <span className="text-text-secondary">{formatDate(admin.lastLoginAt)}</span>
                <span className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => openReset(admin)}>
                    <KeyRound className="size-4" />
                    Reset
                  </Button>
                  {admin.isActive ? (
                    <Button size="sm" variant="destructive" className="gap-2" onClick={() => openDeactivate(admin)} disabled={activeCount <= 1}>
                      <ShieldOff className="size-4" />
                      Deactivate
                    </Button>
                  ) : (
                    <Button size="sm" className="gap-2 bg-primary hover:bg-primary" onClick={() => openReactivate(admin)}>
                      <ShieldCheck className="size-4" />
                      Reactivate
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={pendingAction?.type === "reset"} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset System Administrator Password</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new password for {pendingAction?.admin?.fullName || pendingAction?.admin?.email || "this account"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="password"
            value={resetPasswordValue}
            onChange={(event) => setResetPasswordValue(event.target.value)}
            placeholder="New password"
          />
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
