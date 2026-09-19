import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import { createSuperAdminUser, fetchSuperAdmins, fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import { parseSpreadsheetRows } from "@/lib/spreadsheet";

const IMPORT_SAMPLE = [
  "fullName,email,employeeId,collegeCode,password,department",
  "John Doe,john.doe@example.com,EMP1001,NVC,Use-a-unique-temporary-password,Computer Science",
].join("\n");

const normalizeColumnKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getRowValue = (row, aliases = []) => {
  const aliasSet = new Set(aliases.map(normalizeColumnKey));
  for (const [key, value] of Object.entries(row || {})) {
    if (aliasSet.has(normalizeColumnKey(key))) {
      return String(value ?? "").trim();
    }
  }
  return "";
};

export default function AdminsPage() {
  const dispatch = useDispatch();
  const admins = useSelector((state) => state.superAdminPanel.admins);
  const colleges = useSelector((state) => state.superAdminPanel.colleges);
  const [form, setForm] = useState({ fullName: "", email: "", employeeId: "", password: "", role: "ADMIN", collegeId: "", departmentId: "", accessProfile: "EDITOR" });
  const [pendingAction, setPendingAction] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importCsv, setImportCsv] = useState(IMPORT_SAMPLE);
  const [importDefaultCollegeId, setImportDefaultCollegeId] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [updatingProfileId, setUpdatingProfileId] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    collegeId: "",
    status: "all",
  });

  const buildAdminsQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("limit", "100");

    if (filters.search.trim()) {
      params.set("search", filters.search.trim());
    }
    if (filters.collegeId) {
      params.set("collegeId", filters.collegeId);
    }
    if (filters.status && filters.status !== "all") {
      params.set("status", filters.status);
    }

    return `?${params.toString()}`;
  }, [filters]);

  const loadAdmins = useCallback(() => dispatch(fetchSuperAdmins(buildAdminsQuery())), [buildAdminsQuery, dispatch]);

  useEffect(() => {
    loadAdmins();
    dispatch(fetchSuperColleges());
  }, [dispatch, loadAdmins]);

  const departmentsQuery = useQuery({
    queryKey: ["super-admins-departments", form.collegeId],
    queryFn: () => superAdminApi.getDepartments(`?limit=100&collegeId=${encodeURIComponent(form.collegeId)}`),
    enabled: Boolean(form.collegeId),
  });

  const departments = useMemo(() => departmentsQuery.data?.data || [], [departmentsQuery.data]);

  const getAdminId = (admin) => admin?._id || admin?.id || "";

  const save = async () => {
    const payload = {
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      employeeId: form.employeeId.trim(),
      password: form.password,
      role: form.role,
      collegeId: form.collegeId,
      departmentId: form.role === "COLLEGE_ADMIN" ? null : form.departmentId,
      accessProfile: form.accessProfile,
    };

    if (!payload.fullName || !payload.email || !payload.employeeId || !payload.password || !payload.collegeId) {
      toast.error("Please fill all required fields before creating admin.");
      return;
    }

    if (payload.role === "ADMIN" && !payload.departmentId) {
      toast.error("Please fill all required fields before creating admin.");
      return;
    }

    if (payload.password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    try {
      setIsSubmitting(true);
      await dispatch(createSuperAdminUser(payload)).unwrap();
      toast.success("Admin created successfully.");
      setForm({ fullName: "", email: "", employeeId: "", password: "", role: "ADMIN", collegeId: "", departmentId: "", accessProfile: "EDITOR" });
      loadAdmins();
    } catch (error) {
      toast.error(error?.message || "Unable to create admin.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const deactivate = async (adminId, confirmationText) => {
    await superAdminApi.deactivateAdmin(adminId, { confirmationText });
    loadAdmins();
  };

  const reactivate = async (adminId) => {
    await superAdminApi.updateAdmin(adminId, { isActive: true });
    loadAdmins();
  };

  const resetPassword = async (adminId) => {
    await superAdminApi.resetAdminPassword(adminId, { password: resetPasswordValue.trim() });
    toast.success("Admin password changed.");
    loadAdmins();
  };

  const updateAccessProfile = async (adminId, accessProfile) => {
    try {
      setUpdatingProfileId(adminId);
      await superAdminApi.updateAdmin(adminId, { accessProfile });
      toast.success("Admin access profile updated.");
      loadAdmins();
    } catch (error) {
      toast.error(error?.message || "Unable to update admin access profile.");
    } finally {
      setUpdatingProfileId("");
    }
  };

  const openResetConfirm = (admin) => {
    setResetPasswordValue("");
    setPendingAction({
      type: "reset",
      admin,
      title: "Reset Admin Password",
      description: `Enter a new password for ${admin.fullName}. The admin will use this password to sign in immediately after the reset.`,
    });
  };

  const closeResetDialog = () => {
    setPendingAction(null);
    setResetPasswordValue("");
  };

  const openDeactivateConfirm = (admin) => {
    setPendingAction({
      type: "deactivate",
      admin,
      title: "Deactivate Admin",
      description: `Deactivate ${admin.fullName}? They will lose admin access immediately.`,
    });
  };

  const openReactivateConfirm = (admin) => {
    setPendingAction({
      type: "reactivate",
      admin,
      title: "Reactivate Admin",
      description: `Reactivate ${admin.fullName}? They will be able to sign in again.`,
      confirmLabel: "Reactivate",
      confirmVariant: "default",
    });
  };

  const confirmPendingAction = async () => {
    const adminId = getAdminId(pendingAction?.admin);
    if (!adminId) {
      setPendingAction(null);
      return;
    }

    if (pendingAction.type === "reset") {
      await resetPassword(adminId);
    }

    if (pendingAction.type === "reactivate") {
      await reactivate(adminId);
    }

      closeResetDialog();
  };

  const toCell = (value) => String(value ?? "").replace(/,/g, " ").trim();

  const rowsToCsv = (rows) => {
    const header = ["fullName", "email", "employeeId", "password", "collegeId", "collegeCode", "collegeName", "department"];
    const lines = rows.map((row) => {
      const normalized = {
        fullName: getRowValue(row, ["fullName", "fullname", "name", "adminName"]),
        email: getRowValue(row, ["email", "emailAddress"]),
        employeeId: getRowValue(row, ["employeeId", "employee_id", "staffId", "staff_id"]),
        password: getRowValue(row, ["password"]),
        collegeId: getRowValue(row, ["collegeId", "college_id"]),
        collegeCode: getRowValue(row, ["collegeCode", "college_code", "code"]),
        collegeName: getRowValue(row, ["collegeName", "college_name", "college"]),
        department: getRowValue(row, ["department", "departmentName", "department_id", "departmentId"]),
      };

      return [
        toCell(normalized.fullName),
        toCell(normalized.email),
        toCell(normalized.employeeId),
        toCell(normalized.password),
        toCell(normalized.collegeId),
        toCell(normalized.collegeCode),
        toCell(normalized.collegeName),
        toCell(normalized.department),
      ].join(",");
    });

    return [header.join(","), ...lines].join("\n");
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const name = String(file.name || "").toLowerCase();
      let parsedCsv = "";

      if (name.endsWith(".csv")) {
        parsedCsv = await file.text();
      } else {
        const rows = await parseSpreadsheetRows(file);
        parsedCsv = rowsToCsv(rows);
      }

      setImportCsv(parsedCsv);
      setImportFileName(file.name);
      toast.success("Admin import file loaded");
    } catch (error) {
      toast.error(error?.message || "Unable to parse spreadsheet file");
    }

    event.target.value = "";
  };

  const startBulkImport = async () => {
    if (!importCsv.trim()) {
      toast.error("CSV data is required for import.");
      return;
    }

    try {
      setIsImporting(true);
      const payload = await superAdminApi.bulkImportAdmins({
        csvData: importCsv,
        ...(importDefaultCollegeId ? { defaultCollegeId: importDefaultCollegeId } : {}),
      });
      setImportResult(payload?.result || null);
      toast.success("Admin import completed");
      loadAdmins();
    } catch (error) {
      toast.error(error?.message || "Admin import failed");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Create Admin</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Input placeholder="Full Name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="Employee ID" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} />
          <Input placeholder="Password" value={form.password} type="password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="h-8 rounded-lg border border-border px-2" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, departmentId: "" })}>
            <option value="ADMIN">Department Admin</option>
            <option value="COLLEGE_ADMIN">College Admin</option>
          </select>
          <select
            className="h-8 rounded-lg border border-border px-2"
            value={form.collegeId}
            onChange={(e) => setForm({ ...form, collegeId: e.target.value, departmentId: "" })}
          >
            <option value="">Select college</option>
            {colleges.filter((college) => college?.isActive !== false).map((college) => (
              <option key={college.id} value={college.id}>{college.name}</option>
            ))}
          </select>
          {form.role === "ADMIN" ? (
            <select
              className="h-8 rounded-lg border border-border px-2"
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              disabled={!form.collegeId}
            >
              <option value="">Select department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          ) : (
            <div className="flex h-8 items-center rounded-lg border border-border px-2 text-xs text-text-secondary">
              College admins are college-scoped; up to 5 active admins per college
            </div>
          )}
          <select className="h-8 rounded-lg border border-border px-2" value={form.accessProfile} onChange={(e) => setForm({ ...form, accessProfile: e.target.value })}>
            <option value="EDITOR">Can Edit</option>
            <option value="VIEW_ONLY">View Only</option>
          </select>
          <Button className="sm:col-span-3 bg-primary hover:bg-primary" onClick={save} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Admin"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Bulk Import Admins</CardTitle>
          <CardDescription>Upload Excel/CSV and map each admin to a college by collegeId, collegeCode, or collegeName.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              className="h-10 rounded-lg border border-border px-2"
              value={importDefaultCollegeId}
              onChange={(event) => setImportDefaultCollegeId(event.target.value)}
            >
              <option value="">Default college (optional)</option>
              {colleges.filter((college) => college?.isActive !== false).map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
            <Input type="file" accept=".csv,.xlsx" onChange={handleImportFile} />
            <Button className="bg-primary py-5 text-white hover:bg-primary text-sm" onClick={() => { setImportCsv(IMPORT_SAMPLE); setImportFileName(""); setImportResult(null); }}>
              Reset Sample
            </Button>
          </div>

          <p className="text-xs text-text-secondary">
            Required columns: fullName, email, employeeId. Optional: password, department, collegeId, collegeCode, collegeName.
            {importFileName ? ` Loaded file: ${importFileName}` : ""}
          </p>

          <Textarea
            className="min-h-45 font-mono text-xs"
            value={importCsv}
            onChange={(event) => setImportCsv(event.target.value)}
          />

          <Button className="bg-primary hover:bg-primary" onClick={startBulkImport} disabled={isImporting}>
            {isImporting ? "Importing..." : "Start Import"}
          </Button>

          {importResult ? (
            <div className="rounded-xl border border-border p-3 text-sm text-text-secondary">
              <p>Created: {importResult.created || 0}</p>
              <p>Duplicates: {importResult.duplicates || 0}</p>
              <p>Failed: {importResult.failed || 0}</p>
              {Array.isArray(importResult.errors) && importResult.errors.length > 0 ? (
                <p className="mt-2 text-xs text-text-secondary">
                  Latest errors: {importResult.errors.slice(0, 5).map((item) => `Row ${item.row}: ${item.reason}`).join(" | ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Admins</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Input
              className="sm:col-span-2"
              placeholder="Search by name, email, or employee id"
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            />

            <select
              className="h-10 rounded-lg border border-border px-2"
              value={filters.collegeId}
              onChange={(event) => setFilters((prev) => ({ ...prev, collegeId: event.target.value }))}
            >
              <option value="">All colleges</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>

            <select
              className="h-10 rounded-lg border border-border px-2"
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button className="bg-primary hover:bg-primary" onClick={loadAdmins}>Search</Button>
            <Button
              className="bg-red-500 hover:bg-red-500 text-white"
              onClick={() => {
                setFilters({ search: "", collegeId: "", status: "all" });
                dispatch(fetchSuperAdmins("?page=1&limit=100"));
              }}
            >
              Reset Filters
            </Button>
          </div>

          {admins.map((admin) => (
            <div key={getAdminId(admin)} className="flex flex-wrap items-center justify-between rounded-xl border border-border px-3 py-2 gap-2">
              <div>
                <p className="font-medium text-text-primary">{admin.fullName}</p>
                <p className="text-xs text-text-secondary">{admin.email} • {admin.employeeId} • {admin.college?.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${admin.isActive ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                    {admin.isActive ? "Active" : "Inactive"}
                  </span>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${admin.role === "COLLEGE_ADMIN" ? "bg-emerald-500/10 text-emerald-700" : "bg-slate-500/10 text-slate-700"}`}>
                    {admin.role === "COLLEGE_ADMIN" ? "College Admin" : "Admin"}
                  </span>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${String(admin.accessProfile || "EDITOR") === "VIEW_ONLY" ? "bg-blue-500/10 text-blue-600" : "bg-amber-500/10 text-amber-700"}`}>
                    {String(admin.accessProfile || "EDITOR") === "VIEW_ONLY" ? "View Only" : "Can Edit"}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <select
                  className="h-8 rounded-lg border border-border px-2 text-xs"
                  value={admin.accessProfile || "EDITOR"}
                  disabled={updatingProfileId === getAdminId(admin)}
                  onChange={(event) => updateAccessProfile(getAdminId(admin), event.target.value)}
                >
                  <option value="EDITOR">Can Edit</option>
                  <option value="VIEW_ONLY">View Only</option>
                </select>
                <Button size="sm" className="bg-primary hover:bg-primary" onClick={() => openResetConfirm(admin)}>Reset Password</Button>
                {admin.isActive ? (
                  <Button size="sm" variant="destructive" onClick={() => openDeactivateConfirm(admin)}>Deactivate</Button>
                ) : (
                  <Button size="sm" className="bg-primary hover:bg-primary" onClick={() => openReactivateConfirm(admin)}>Reactivate</Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <ConfirmActionDialog
        open={Boolean(pendingAction && pendingAction.type === "reactivate")}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction?.title || "Confirm Action"}
        description={pendingAction?.description || "Please confirm this action."}
        confirmLabel={pendingAction?.confirmLabel || "Confirm"}
        confirmVariant={pendingAction?.confirmVariant || "default"}
        onConfirm={confirmPendingAction}
      />

      <AlertDialog open={Boolean(pendingAction && pendingAction.type === "reset")} onOpenChange={(open) => !open && closeResetDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction?.title || "Reset Admin Password"}</AlertDialogTitle>
            <AlertDialogDescription>{pendingAction?.description || "Enter a new password for this admin."}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-text-secondary">Password rule: at least 8 characters. This will replace the current password immediately.</p>
            <Input
              type="password"
              value={resetPasswordValue}
              onChange={(event) => setResetPasswordValue(event.target.value)}
              placeholder="Enter new password"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeResetDialog}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="default"
              disabled={resetPasswordValue.trim().length < 8}
              onClick={confirmPendingAction}
            >
              Change Password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TypedConfirmDialog
        open={Boolean(pendingAction && pendingAction.type === "deactivate")}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title="Typed Confirmation Required"
        description={`This will immediately disable ${pendingAction?.admin?.fullName || "this admin"}. Type the confirmation text to proceed.`}
        expectedText={`DEACTIVATE ${pendingAction?.admin?.employeeId || getAdminId(pendingAction?.admin) || ""}`}
        inputLabel="Type the exact phrase"
        confirmLabel="Deactivate"
        confirmVariant="destructive"
        onConfirm={async (typedText) => {
          const adminId = getAdminId(pendingAction?.admin);
          if (adminId) {
            await deactivate(adminId, typedText);
          }
          setPendingAction(null);
        }}
      />
    </div>
  );
}
