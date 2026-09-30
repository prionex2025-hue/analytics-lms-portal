import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import { parseSpreadsheetRows } from "@/lib/spreadsheet";
import { Building2, Check, FileUp, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  Callout,
  DataTable,
  DisclosureSection,
  EmptyState,
  FormField,
  MiniStat,
  PageHeader,
  PaginationBar,
  SearchInput,
  SectionCard,
} from "@/components/common/page-kit";
import { ui } from "@/styles/ui-tokens";

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

const IMPORT_SAMPLE = [
  "name,collegeCode",
  "Computer Science,NVC",
  "Mechanical Engineering,NVC",
].join("\n");

export default function DepartmentsPage() {
  const dispatch = useDispatch();
  const colleges = useSelector((state) => state.superAdminPanel.colleges);

  const [filters, setFilters] = useState({ search: "", collegeId: "" });
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ name: "", collegeId: "" });
  const [departmentsPayload, setDepartmentsPayload] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renamingId, setRenamingId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [importCsv, setImportCsv] = useState(IMPORT_SAMPLE);
  const [importDefaultCollegeId, setImportDefaultCollegeId] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    dispatch(fetchSuperColleges());
  }, [dispatch]);

  const activeColleges = useMemo(() => colleges.filter((college) => college?.isActive !== false), [colleges]);

  const loadDepartments = async (targetPage = page) => {
    if (!filters.collegeId) {
      setDepartmentsPayload({ data: [], pagination: null });
      setPage(1);
      return;
    }
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("limit", "100");
      params.set("page", String(targetPage));
      if (filters.collegeId) params.set("collegeId", filters.collegeId);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      const query = `?${params.toString()}`;
      const payload = await superAdminApi.getDepartments(query);
      setDepartmentsPayload({ data: payload?.data || [], pagination: payload?.pagination || null });
      setPage(targetPage);
    } catch (error) {
      toast.error(error?.message || "Failed to load departments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDepartments(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.collegeId]);

  const createDepartment = async () => {
    if (!form.name.trim() || !form.collegeId) {
      toast.error("Department name and college are required.");
      return;
    }

    try {
      setSaving(true);
      await superAdminApi.createDepartment({
        name: form.name.trim(),
        collegeId: form.collegeId,
      });
      toast.success("Department created");
      setForm({ name: "", collegeId: "" });
      await loadDepartments(1);
    } catch (error) {
      toast.error(error?.message || "Unable to create department");
    } finally {
      setSaving(false);
    }
  };

  const saveRename = async (departmentId) => {
    if (!renameValue.trim()) {
      toast.error("Department name cannot be empty.");
      return;
    }

    try {
      setSaving(true);
      await superAdminApi.updateDepartment(departmentId, { name: renameValue.trim() });
      toast.success("Department updated");
      setRenamingId("");
      setRenameValue("");
      await loadDepartments(page);
    } catch (error) {
      toast.error(error?.message || "Unable to update department");
    } finally {
      setSaving(false);
    }
  };

  const removeDepartment = async (department, confirmationText) => {
    try {
      setSaving(true);
      await superAdminApi.deleteDepartment(department.id, { confirmationText });
      toast.success("Department deleted");
      await loadDepartments(page);
    } catch (error) {
      const linked = error?.details?.linkedCounts;
      if (linked) {
        toast.error(
          `Cannot delete: linked records exist (batches: ${linked.batches || 0}, students: ${linked.students || 0}, tests: ${linked.tests || 0})`
        );
      } else {
        toast.error(error?.message || "Unable to delete department");
      }
    } finally {
      setSaving(false);
    }
  };

  const rowsToCsv = (rows) => {
    const header = ["name", "collegeId", "collegeCode", "collegeName"];
    const lines = rows.map((row) => {
      const normalized = {
        name: getRowValue(row, ["name", "department", "departmentName", "department_name"]),
        collegeId: getRowValue(row, ["collegeId", "college_id"]),
        collegeCode: getRowValue(row, ["collegeCode", "college_code", "code"]),
        collegeName: getRowValue(row, ["collegeName", "college_name", "college"]),
      };
      return [normalized.name, normalized.collegeId, normalized.collegeCode, normalized.collegeName]
        .map((value) => String(value || "").replace(/,/g, " ").trim())
        .join(",");
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
      toast.success("Department import file loaded");
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
      setImporting(true);
      const payload = await superAdminApi.bulkImportDepartments({
        csvData: importCsv,
        ...(importDefaultCollegeId ? { defaultCollegeId: importDefaultCollegeId } : {}),
      });
      setImportResult(payload?.result || null);
      toast.success("Department import completed");
      await loadDepartments(1);
    } catch (error) {
      toast.error(error?.message || "Department import failed");
    } finally {
      setImporting(false);
    }
  };

  const departments = departmentsPayload?.data || [];

  const pagination = departmentsPayload?.pagination;
  const currentPage = pagination?.page || page;
  const totalPages = pagination?.pages || 1;

  const columns = [
    {
      key: "name",
      header: "Department",
      primary: true,
      cell: (department) =>
        renamingId === department.id ? (
          <form
            className="flex max-w-md items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveRename(department.id);
            }}
          >
            <Input
              autoFocus
              aria-label="New department name"
              className="h-9 rounded-lg"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setRenamingId("");
                  setRenameValue("");
                }
              }}
            />
          </form>
        ) : (
          <span className="font-medium text-text-primary">{department.name}</span>
        ),
    },
    { key: "college", header: "College", className: "text-text-secondary", cell: (department) => department.college?.name || "-" },
    { key: "batches", header: "Batches", align: "right", className: "tabular-nums", cell: (department) => department._count?.batches || 0 },
    { key: "students", header: "Students", align: "right", className: "tabular-nums", cell: (department) => department._count?.students || 0 },
    {
      key: "actions",
      actions: true,
      align: "right",
      cell: (department) =>
        renamingId === department.id ? (
          <div className="flex justify-end gap-1.5">
            <Button size="lg" className="rounded-lg" onClick={() => saveRename(department.id)} disabled={saving}>
              <Check className="size-4" />
              Save
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-lg"
              onClick={() => {
                setRenamingId("");
                setRenameValue("");
              }}
            >
              <X className="size-4" />
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1.5">
            <Button
              size="lg"
              variant="outline"
              className="rounded-lg"
              onClick={() => {
                setRenamingId(department.id);
                setRenameValue(department.name || "");
              }}
            >
              <Pencil className="size-4" />
              Rename
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="rounded-lg text-danger hover:bg-danger/10 hover:text-danger"
              onClick={() => setPendingDelete(department)}
              disabled={saving}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Departments" description="Create, rename, and remove departments for each college." />

      <SectionCard title="Create department" description="Departments belong to exactly one college.">
        <form
          className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            createDepartment();
          }}
        >
          <FormField label="Department name" htmlFor="department-create-name" required>
            <Input
              id="department-create-name"
              className={ui.field}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </FormField>
          <FormField label="College" htmlFor="department-create-college" required>
            <select
              id="department-create-college"
              className="ui-select w-full"
              value={form.collegeId}
              onChange={(event) => setForm((prev) => ({ ...prev, collegeId: event.target.value }))}
            >
              <option value="">Select college</option>
              {activeColleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
          </FormField>
          <Button type="submit" disabled={saving} className={ui.btn}>
            <Plus className="size-4" />
            {saving ? "Saving..." : "Create Department"}
          </Button>
        </form>
      </SectionCard>

      <SectionCard
        flush
        title="Departments by college"
        description="Pick a college to list its departments."
        footer={
          filters.collegeId && totalPages > 1 ? (
            <PaginationBar page={currentPage} pages={totalPages} disabled={loading} onPageChange={(next) => loadDepartments(next)} />
          ) : null
        }
      >
        <form
          className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            loadDepartments(1);
          }}
        >
          <select
            className="ui-select min-w-56 flex-1 sm:flex-none"
            aria-label="College"
            value={filters.collegeId}
            onChange={(event) => setFilters((prev) => ({ ...prev, collegeId: event.target.value }))}
          >
            <option value="">Select a college…</option>
            {colleges.map((college) => (
              <option key={college.id} value={college.id}>{college.name}</option>
            ))}
          </select>
          <SearchInput
            className="min-w-0 flex-1 basis-52"
            placeholder="Search by name"
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          />
          <Button type="submit" variant="outline" className={ui.btn} disabled={loading || !filters.collegeId}>
            <Search className="size-4" />
            {loading ? "Loading..." : "Search"}
          </Button>
        </form>

        {!filters.collegeId ? (
          <EmptyState icon={Building2} title="Select a college" description="Departments are listed per college. Choose one above to get started." className="border-0" />
        ) : (
          <DataTable
            columns={columns}
            rows={departments}
            getRowKey={(department) => department.id}
            loading={loading}
            minWidth={760}
            caption="Departments"
            empty={<EmptyState icon={Building2} title="No departments found" description="Create one using the form above, or adjust your search." className="border-0" />}
          />
        )}
      </SectionCard>

      <DisclosureSection
        icon={FileUp}
        title="Bulk import departments"
        description="Upload an Excel/CSV file and create departments across colleges in one go."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Default college" htmlFor="department-import-college" hint="Only name is mandatory if a default college is selected.">
              <select
                id="department-import-college"
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
            <FormField label="Spreadsheet file" htmlFor="department-import-file" hint={importFileName ? `Loaded: ${importFileName}` : ".xlsx or .csv"}>
              <Input id="department-import-file" type="file" accept=".xlsx,.csv" className="h-10 rounded-lg" onChange={handleImportFile} />
            </FormField>
          </div>

          <FormField label="CSV data" htmlFor="department-import-csv" hint="Accepted columns: name, collegeId, collegeCode, collegeName">
            <Textarea id="department-import-csv" rows={8} className="rounded-lg font-mono text-xs" value={importCsv} onChange={(event) => setImportCsv(event.target.value)} />
          </FormField>

          <Button className={ui.btn} onClick={startBulkImport} disabled={importing}>
            <FileUp className="size-4" />
            {importing ? "Importing..." : "Start Department Import"}
          </Button>

          {importResult ? (
            <div className="space-y-3" role="status">
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Created" value={importResult.created || 0} tone="success" />
                <MiniStat label="Failed" value={importResult.failed || 0} tone={importResult.failed ? "danger" : undefined} />
                <MiniStat label="Duplicates" value={importResult.duplicates || 0} />
              </div>
              {Array.isArray(importResult.errors) && importResult.errors.length > 0 ? (
                <Callout tone="warning" title="Rows with errors">
                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs">
                    {importResult.errors.slice(0, 15).map((item, index) => (
                      <li key={`${item.row || "row"}-${index}`}>Row {item.row || "?"}: {item.reason || "Invalid data"}</li>
                    ))}
                  </ul>
                </Callout>
              ) : null}
            </div>
          ) : null}
        </div>
      </DisclosureSection>

      <TypedConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Typed Confirmation Required"
        description={`Delete ${pendingDelete?.name || "this department"}? This cannot be undone.`}
        expectedText={`DELETE ${pendingDelete?.name || ""}`}
        inputLabel="Type the exact phrase"
        confirmLabel="Delete Department"
        confirmVariant="destructive"
        onConfirm={async (typedText) => {
          if (pendingDelete) {
            await removeDepartment(pendingDelete, typedText);
          }
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
