import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import { createSuperAdminUser, fetchSuperAdmins, fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
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
import { FileUp, KeyRound, Plus, RotateCcw, ShieldCheck, ShieldOff, ShieldUser } from "lucide-react";
import {
  Callout,
  DataTable,
  DisclosureSection,
  EmptyState,
  FormField,
  MiniStat,
  PageHeader,
  SearchInput,
  SectionCard,
  StatusBadge,
} from "@/components/common/page-kit";
import { ui } from "@/styles/ui-tokens";

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

  const [adminsLoading, setAdminsLoading] = useState(true);

  useEffect(() => {
    Promise.resolve(loadAdmins()).finally(() => setAdminsLoading(false));
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

  const activeColleges = colleges.filter((college) => college?.isActive !== false);
  const hasFilters = Boolean(filters.search || filters.collegeId || filters.status !== "all");

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
    { key: "college", header: "College", className: "max-w-56 truncate", cell: (admin) => admin.college?.name || "—" },
    {
      key: "role",
      header: "Role",
      cell: (admin) => (
        <StatusBadge tone={admin.role === "COLLEGE_ADMIN" ? "info" : "neutral"}>{admin.role === "COLLEGE_ADMIN" ? "College Admin" : "Admin"}</StatusBadge>
      ),
    },
    {
      key: "access",
      header: "Access",
      cell: (admin) => (
        <select
          className="ui-select h-9"
          aria-label={`Access profile for ${admin.fullName}`}
          value={admin.accessProfile || "EDITOR"}
          disabled={updatingProfileId === getAdminId(admin)}
          onChange={(event) => updateAccessProfile(getAdminId(admin), event.target.value)}
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
          <Button size="lg" variant="outline" className="rounded-lg" onClick={() => openResetConfirm(admin)}>
            <KeyRound className="size-4" />
            Reset password
          </Button>
          {admin.isActive ? (
            <Button size="lg" variant="ghost" className="rounded-lg text-danger hover:bg-danger/10 hover:text-danger" onClick={() => openDeactivateConfirm(admin)}>
              <ShieldOff className="size-4" />
              Deactivate
            </Button>
          ) : (
            <Button size="lg" variant="ghost" className="rounded-lg text-success hover:bg-success/10 hover:text-success" onClick={() => openReactivateConfirm(admin)}>
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
      <PageHeader title="Admins" description="Department and college admins across every college, with their access level." />

      <SectionCard title="Create admin" description="Department admins are scoped to one department; college admins manage a whole college.">
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <FormField label="Full name" htmlFor="admin-create-name" required>
            <Input id="admin-create-name" className={ui.field} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </FormField>
          <FormField label="Email" htmlFor="admin-create-email" required>
            <Input id="admin-create-email" type="email" autoComplete="off" className={ui.field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormField>
          <FormField label="Employee ID" htmlFor="admin-create-employee" required>
            <Input id="admin-create-employee" className={ui.field} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} />
          </FormField>
          <FormField label="Password" htmlFor="admin-create-password" required>
            <Input id="admin-create-password" type="password" autoComplete="new-password" className={ui.field} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </FormField>
          <FormField label="Role" htmlFor="admin-create-role">
            <select id="admin-create-role" className="ui-select w-full" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, departmentId: "" })}>
              <option value="ADMIN">Department Admin</option>
              <option value="COLLEGE_ADMIN">College Admin</option>
            </select>
          </FormField>
          <FormField label="College" htmlFor="admin-create-college" required>
            <select
              id="admin-create-college"
              className="ui-select w-full"
              value={form.collegeId}
              onChange={(e) => setForm({ ...form, collegeId: e.target.value, departmentId: "" })}
            >
              <option value="">Select college</option>
              {activeColleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
          </FormField>
          {form.role === "ADMIN" ? (
            <FormField label="Department" htmlFor="admin-create-department" hint={!form.collegeId ? "Choose a college first." : undefined} required>
              <select
                id="admin-create-department"
                className="ui-select w-full"
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                disabled={!form.collegeId}
              >
                <option value="">Select department</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </FormField>
          ) : (
            <FormField label="Scope">
              <p className="flex min-h-10 items-center rounded-lg bg-muted/50 px-3 text-xs text-text-secondary">
                College admins are college-scoped; up to 5 active admins per college
              </p>
            </FormField>
          )}
          <FormField label="Access" htmlFor="admin-create-access">
            <select id="admin-create-access" className="ui-select w-full" value={form.accessProfile} onChange={(e) => setForm({ ...form, accessProfile: e.target.value })}>
              <option value="EDITOR">Can Edit</option>
              <option value="VIEW_ONLY">View Only</option>
            </select>
          </FormField>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" className={ui.btn} disabled={isSubmitting}>
              <Plus className="size-4" />
              {isSubmitting ? "Creating..." : "Create Admin"}
            </Button>
          </div>
        </form>
      </SectionCard>

      <DisclosureSection
        icon={FileUp}
        title="Bulk import admins"
        description="Upload Excel/CSV and map each admin to a college by collegeId, collegeCode, or collegeName."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Default college" htmlFor="admin-import-college" hint="Used when a row has no college column.">
              <select
                id="admin-import-college"
                className="ui-select w-full"
                value={importDefaultCollegeId}
                onChange={(event) => setImportDefaultCollegeId(event.target.value)}
              >
                <option value="">Default college (optional)</option>
                {activeColleges.map((college) => (
                  <option key={college.id} value={college.id}>{college.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Spreadsheet file" htmlFor="admin-import-file" hint={importFileName ? `Loaded file: ${importFileName}` : ".csv or .xlsx"}>
              <Input id="admin-import-file" type="file" accept=".csv,.xlsx" className="h-10 rounded-lg" onChange={handleImportFile} />
            </FormField>
          </div>

          <FormField
            label="CSV data"
            htmlFor="admin-import-csv"
            hint="Required columns: fullName, email, employeeId. Optional: password, department, collegeId, collegeCode, collegeName."
          >
            <Textarea
              id="admin-import-csv"
              className="min-h-40 rounded-lg font-mono text-xs"
              value={importCsv}
              onChange={(event) => setImportCsv(event.target.value)}
            />
          </FormField>

          <div className="flex flex-wrap gap-2">
            <Button className={ui.btn} onClick={startBulkImport} disabled={isImporting}>
              <FileUp className="size-4" />
              {isImporting ? "Importing..." : "Start Import"}
            </Button>
            <Button
              variant="outline"
              className={ui.btn}
              onClick={() => {
                setImportCsv(IMPORT_SAMPLE);
                setImportFileName("");
                setImportResult(null);
              }}
            >
              <RotateCcw className="size-4" />
              Reset Sample
            </Button>
          </div>

          {importResult ? (
            <div className="space-y-3" role="status">
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Created" value={importResult.created || 0} tone="success" />
                <MiniStat label="Duplicates" value={importResult.duplicates || 0} />
                <MiniStat label="Failed" value={importResult.failed || 0} tone={importResult.failed ? "danger" : undefined} />
              </div>
              {Array.isArray(importResult.errors) && importResult.errors.length > 0 ? (
                <Callout tone="warning" title="Latest errors">
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {importResult.errors.slice(0, 5).map((item) => (
                      <li key={`${item.row}-${item.reason}`}>Row {item.row}: {item.reason}</li>
                    ))}
                  </ul>
                </Callout>
              ) : null}
            </div>
          ) : null}
        </div>
      </DisclosureSection>

      <SectionCard flush title="All admins">
        <form
          className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            loadAdmins();
          }}
        >
          <SearchInput
            className="min-w-0 flex-1 basis-60"
            placeholder="Search by name, email, or employee id"
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          />
          <select
            className="ui-select"
            aria-label="College"
            value={filters.collegeId}
            onChange={(event) => setFilters((prev) => ({ ...prev, collegeId: event.target.value }))}
          >
            <option value="">All colleges</option>
            {colleges.map((college) => (
              <option key={college.id} value={college.id}>{college.name}</option>
            ))}
          </select>
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
          <Button
            type="button"
            variant="ghost"
            className={ui.btn}
            disabled={!hasFilters}
            onClick={() => {
              setFilters({ search: "", collegeId: "", status: "all" });
              dispatch(fetchSuperAdmins("?page=1&limit=100"));
            }}
          >
            <RotateCcw className="size-4" />
            Reset Filters
          </Button>
        </form>

        <DataTable
          columns={columns}
          rows={admins}
          getRowKey={(admin) => getAdminId(admin)}
          loading={adminsLoading && admins.length === 0}
          minWidth={1040}
          caption="Admins"
          rowClassName={(admin) => (admin.isActive ? "" : "bg-muted/30")}
          empty={
            <EmptyState
              icon={ShieldUser}
              title={hasFilters ? "No admins match these filters" : "No admins yet"}
              description={hasFilters ? "Try clearing the filters." : "Create an admin using the form above."}
              className="border-0"
            />
          }
        />
      </SectionCard>

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
          <FormField
            label="New password"
            htmlFor="admin-reset-password"
            hint="At least 8 characters. This replaces the current password immediately."
          >
            <Input
              id="admin-reset-password"
              type="password"
              autoComplete="new-password"
              className={ui.field}
              value={resetPasswordValue}
              onChange={(event) => setResetPasswordValue(event.target.value)}
            />
          </FormField>
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
