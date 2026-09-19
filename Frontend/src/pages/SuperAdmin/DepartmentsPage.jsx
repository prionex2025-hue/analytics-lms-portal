import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import { parseSpreadsheetRows } from "@/lib/spreadsheet";

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

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Create Department</CardTitle>
          <CardDescription>Create departments under specific colleges.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Input
            placeholder="Department Name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />
          <select
            className="h-10 rounded-md border border-border px-3 text-sm"
            value={form.collegeId}
            onChange={(event) => setForm((prev) => ({ ...prev, collegeId: event.target.value }))}
          >
            <option value="">Select college</option>
            {activeColleges.map((college) => (
              <option key={college.id} value={college.id}>{college.name}</option>
            ))}
          </select>
          <Button onClick={createDepartment} disabled={saving} className="bg-primary/100 hover:bg-primary">
            {saving ? "Saving..." : "Create Department"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Departments</CardTitle>
          <CardDescription>Rename or delete departments for each college.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              placeholder="Search by name"
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            />
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={filters.collegeId}
              onChange={(event) => setFilters((prev) => ({ ...prev, collegeId: event.target.value }))}
            >
              <option value="">All colleges</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
            <Button variant="outline" onClick={() => loadDepartments(1)} disabled={loading || !filters.collegeId}>
              {loading ? "Loading..." : "Search"}
            </Button>
          </div>

          <div className="space-y-2">
            {!filters.collegeId ? (
              <p className="text-sm text-text-secondary">Select a college to view departments.</p>
            ) : !loading && departments.length === 0 ? (
              <p className="text-sm text-text-secondary">No departments found.</p>
            ) : null}
            {departments.map((department) => {
              const isRenaming = renamingId === department.id;
              return (
                <div key={department.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                  <div>
                    {isRenaming ? (
                      <Input
                        className="h-8"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                    ) : (
                      <p className="font-medium text-text-primary">{department.name}</p>
                    )}
                    <p className="text-xs text-text-secondary">
                      {department.college?.name || "-"} • Batches: {department._count?.batches || 0} • Students: {department._count?.students || 0}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {isRenaming ? (
                      <>
                        <Button size="sm" onClick={() => saveRename(department.id)} disabled={saving}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => { setRenamingId(""); setRenameValue(""); }}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRenamingId(department.id);
                            setRenameValue(department.name || "");
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setPendingDelete(department)}
                          disabled={saving}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {(departmentsPayload?.pagination?.pages || 1) > 1 ? (
              <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
                <p>Page {departmentsPayload?.pagination?.page || page} of {departmentsPayload?.pagination?.pages || 1}</p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(departmentsPayload?.pagination?.page || page) <= 1 || loading}
                    onClick={() => loadDepartments(Math.max((departmentsPayload?.pagination?.page || page) - 1, 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(departmentsPayload?.pagination?.page || page) >= (departmentsPayload?.pagination?.pages || 1) || loading}
                    onClick={() => loadDepartments((departmentsPayload?.pagination?.page || page) + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Bulk Import Departments (Excel/CSV)</CardTitle>
          <CardDescription>Upload an Excel/CSV file and create departments across colleges in one go.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={importDefaultCollegeId}
              onChange={(event) => setImportDefaultCollegeId(event.target.value)}
            >
              <option value="">Default college (optional)</option>
              {activeColleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
            <Input type="file" accept=".xlsx,.csv" onChange={handleImportFile} />
          </div>

          {importFileName ? <p className="text-xs text-text-secondary">Loaded: {importFileName}</p> : null}

          <div className="rounded-lg border border-border bg-background p-3 text-xs text-text-secondary">
            <p className="font-semibold text-text-secondary">Accepted columns:</p>
            <p className="mt-1">name, collegeId, collegeCode, collegeName</p>
            <p className="mt-1">Only name is mandatory if default college is selected.</p>
          </div>

          <Textarea rows={8} value={importCsv} onChange={(event) => setImportCsv(event.target.value)} />

          <Button onClick={startBulkImport} disabled={importing}>
            {importing ? "Importing..." : "Start Department Import"}
          </Button>

          {importResult ? (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium text-text-primary">
                Created: {importResult.created || 0} • Failed: {importResult.failed || 0} • Duplicates: {importResult.duplicates || 0}
              </p>
              {Array.isArray(importResult.errors) && importResult.errors.length > 0 ? (
                <div className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-background p-2 text-xs text-text-secondary">
                  {importResult.errors.slice(0, 15).map((item, index) => (
                    <p key={`${item.row || "row"}-${index}`}>Row {item.row || "?"}: {item.reason || "Invalid data"}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

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
