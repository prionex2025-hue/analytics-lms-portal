import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { fetchAdminTests, transitionAdminTestStatus, deleteAdminTest } from "@/features/Admin/adminPanelSlice";
import { openTestCreationDialog, openTestEditDialog, setTestCreationContext } from "@/features/Admin/testCreationSlice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import TestCreationDialog from "@/components/Admin/TestCreationDialog";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
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
import { adminApi } from "@/services/api";
import { Copy } from "lucide-react";
import { ASSESSMENT_FORMATS, normalizeAssessmentFormat } from "@/lib/testConfig";

const STATUS_TONE = {
  DRAFT: "bg-muted text-text-secondary border-border",
  SCHEDULED: "bg-primary/10 text-primary border-primary/30",
  LIVE: "bg-success/10 text-success border-success/30",
  COMPLETED: "bg-teal-50 text-teal-700 border-teal-200",
  ARCHIVED: "bg-background text-text-secondary border-border",
};

const normalizeStatus = (status) => {
  if (status === "UPCOMING") return "SCHEDULED";
  if (status === "PUBLISHED") return "LIVE";
  return status || "DRAFT";
};

const STATUS_FILTERS = ["ALL", "DRAFT", "SCHEDULED", "LIVE", "COMPLETED", "ARCHIVED"];
const SORT_FIELDS = [
  { value: "createdAt", label: "Created Date" },
  { value: "startsAt", label: "Start Date" },
  { value: "title", label: "Test Name" },
  { value: "status", label: "Status" },
];

const transitionsForStatus = (status) => {
  switch (status) {
    case "DRAFT":
      return [
        { action: "SCHEDULE", label: "Schedule" },
        { action: "GO_LIVE", label: "Go Live" },
      ];
    case "SCHEDULED":
      return [
        { action: "GO_LIVE", label: "Go Live" },
        { action: "ARCHIVE", label: "Archive" },
      ];
    case "LIVE":
      return [
        { action: "COMPLETE", label: "Mark Complete" },
        { action: "ARCHIVE", label: "Archive" },
      ];
    case "COMPLETED":
      return [{ action: "ARCHIVE", label: "Archive" }];
    default:
      return [];
  }
};

const isAdminReadOnlyTest = (test) => {
  if (!test) return false;
  if (test.canAdminOperate === false) return true;
  if (test.canAdminControl === false) return true;
  if (test.managedBy === "SUPER_ADMIN") return true;
  if (test.managedBy === "COLLEGE_ADMIN") return true;
  return Boolean(test.isGlobal);
};

const managedByLabel = (test) => {
  if (test?.managedBy === "SUPER_ADMIN" || test?.isGlobal) return "Super admin managed";
  if (test?.managedBy === "COLLEGE_ADMIN") return "College admin managed";
  return "Department managed";
};

const transitionConfirmationText = (testTitle, action) => {
  switch (action) {
    case "SCHEDULE":
      return `Schedule "${testTitle}" as upcoming? Students will see it before start time.`;
    case "GO_LIVE":
      return `Go live now for "${testTitle}"? Questions become locked for editing after publish.`;
    case "COMPLETE":
      return `Mark "${testTitle}" as completed? This will stop it from remaining active.`;
    case "ARCHIVE":
      return `Archive "${testTitle}"? It will be hidden from active workflows but retained for reports.`;
    default:
      return `Apply transition ${action} for "${testTitle}"?`;
  }
};

const writeClipboardText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
};

export default function ManageTestsPage() {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const handledCreateTriggerRef = useRef("");
  const tests = useSelector((state) => state.adminPanel.tests.data);
  const loading = useSelector((state) => state.adminPanel.tests.loading);
  const pagination = useSelector((state) => state.adminPanel.tests.pagination || {});
  const serverStatusCounts = useSelector((state) => state.adminPanel.tests.statusCounts || {});
  const canCreate = usePermission(ADMIN_PERMISSIONS.CREATE_TEST);
  const canViewTests = usePermission(ADMIN_PERMISSIONS.VIEW_TESTS);
  const canViewReports = usePermission(ADMIN_PERMISSIONS.VIEW_REPORTS);
  const canEdit = usePermission(ADMIN_PERMISSIONS.EDIT_TEST);
  const canDelete = usePermission(ADMIN_PERMISSIONS.DELETE_TEST);
  const canManageQuestions = usePermission(ADMIN_PERMISSIONS.MANAGE_QUESTIONS);
  const [activeStatus, setActiveStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState("ARCHIVE");
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteDialog, setDeleteDialog] = useState({ open: false, test: null });
  const [editingTestId, setEditingTestId] = useState("");

  const basePath = location.pathname.startsWith("/college-admin") ? "/college-admin" : "/admin";
  const canListTests = canViewTests || canEdit || canManageQuestions;
  const canCreateTest = canCreate && canManageQuestions;
  const canTransition = canEdit;
  const canMonitor = canViewTests || canEdit;

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("limit", "20");
    query.set("sortBy", sortBy);
    query.set("sortOrder", sortOrder);
    if (activeStatus !== "ALL") query.set("status", activeStatus);
    if (search.trim().length >= 2) query.set("search", search.trim());
    return `?${query.toString()}`;
  }, [activeStatus, page, search, sortBy, sortOrder]);

  useEffect(() => {
    if (canListTests) {
      dispatch(fetchAdminTests(queryString));
    }
  }, [canListTests, dispatch, queryString]);

  useEffect(() => {
    const isCreateRoute = /\/tests\/create\/?$/.test(location.pathname);
    const currentSearchParams = new URLSearchParams(location.search);
    const isCreateQuery = currentSearchParams.get("create") === "1";

    if ((!isCreateRoute && !isCreateQuery) || !canCreateTest) {
      return;
    }

    const triggerKey = `${location.pathname}${location.search}`;
    if (handledCreateTriggerRef.current === triggerKey) {
      return;
    }
    handledCreateTriggerRef.current = triggerKey;

    dispatch(setTestCreationContext("admin"));
    dispatch(openTestCreationDialog());

    if (isCreateRoute) {
      navigate(`${basePath}/tests`, { replace: true });
      return;
    }

    const nextSearchParams = new URLSearchParams(currentSearchParams);
    nextSearchParams.delete("create");
    setSearchParams(nextSearchParams, { replace: true });
  }, [basePath, canCreateTest, dispatch, location.pathname, location.search, navigate, setSearchParams]);

  useEffect(() => {
    setSelectedIds([]);
  }, [tests]);

  const fallbackStatusCounts = useMemo(() => {
    const base = {
      DRAFT: 0,
      SCHEDULED: 0,
      LIVE: 0,
      COMPLETED: 0,
      ARCHIVED: 0,
    };

    tests.forEach((test) => {
      const status = normalizeStatus(test.status);
      if (typeof base[status] === "number") {
        base[status] += 1;
      }
    });

    return base;
  }, [tests]);

  const statusCounts = {
    ALL: Number(serverStatusCounts.ALL ?? tests.length),
    DRAFT: Number(serverStatusCounts.DRAFT ?? fallbackStatusCounts.DRAFT),
    SCHEDULED: Number(serverStatusCounts.SCHEDULED ?? fallbackStatusCounts.SCHEDULED),
    LIVE: Number(serverStatusCounts.LIVE ?? fallbackStatusCounts.LIVE),
    COMPLETED: Number(serverStatusCounts.COMPLETED ?? fallbackStatusCounts.COMPLETED),
    ARCHIVED: Number(serverStatusCounts.ARCHIVED ?? fallbackStatusCounts.ARCHIVED),
  };

  const onTransition = (test, action) => {
    setPendingAction({
      type: "transition",
      test,
      action,
      description: transitionConfirmationText(test.title, action),
    });
  };

  const onDeleteDraft = (test) => {
    setDeleteConfirmName("");
    setDeleteDialog({ open: true, test });
  };

  const confirmPendingAction = () => {
    if (!pendingAction?.test?.id) {
      setPendingAction(null);
      return;
    }

    if (pendingAction.type === "transition") {
      if (pendingAction.action === "DELETE") {
        dispatch(deleteAdminTest(pendingAction.test.id));
      } else {
        dispatch(
          transitionAdminTestStatus({
            testId: pendingAction.test.id,
            action: pendingAction.action,
          })
        );
      }
    }

    setPendingAction(null);
  };

  const selectedTests = tests.filter((test) => selectedIds.includes(test.id));
  const bulkPreview = useMemo(() => {
    if (bulkAction === "ARCHIVE") {
      const valid = selectedTests.filter(
        (test) => !isAdminReadOnlyTest(test) && normalizeStatus(test.status) !== "ARCHIVED"
      ).length;
      return { valid, skipped: selectedTests.length - valid };
    }

    const valid = selectedTests.filter(
      (test) => !isAdminReadOnlyTest(test)
        && normalizeStatus(test.status) === "DRAFT"
        && Number(test?._count?.submissions || 0) === 0
    ).length;
    return { valid, skipped: selectedTests.length - valid };
  }, [bulkAction, selectedTests]);

  const runBulkAction = async () => {
    const actionPromises = selectedTests.map(async (test) => {
      if (isAdminReadOnlyTest(test)) return false;

      if (bulkAction === "ARCHIVE") {
        if (normalizeStatus(test.status) === "ARCHIVED") return false;
        await dispatch(transitionAdminTestStatus({ testId: test.id, action: "ARCHIVE" }));
        return true;
      }

      if (normalizeStatus(test.status) === "DRAFT" && Number(test?._count?.submissions || 0) === 0) {
        await dispatch(deleteAdminTest(test.id));
        return true;
      }

      return false;
    });

    const results = await Promise.all(actionPromises);
    const valid = results.filter(Boolean).length;
    const skipped = results.length - valid;
    toast.success(`${valid} processed, ${skipped} skipped.`);
    setBulkOpen(false);
  };

  const onOpenEdit = async (testId) => {
    if (!testId) return;

    const selectedTest = tests.find((item) => item.id === testId);
    if (isAdminReadOnlyTest(selectedTest)) {
      toast.error(`${managedByLabel(selectedTest)} tests are read-only here.`);
      return;
    }

    try {
      setEditingTestId(testId);
      const testDetail = await adminApi.getTestById(testId);
      dispatch(openTestEditDialog({ test: testDetail }));
    } catch (error) {
      toast.error(error?.message || "Failed to load test for editing.");
    } finally {
      setEditingTestId("");
    }
  };

  const copyShareLink = async (test) => {
    try {
      const payload = test?.shareLink ? test : await adminApi.getTestShareLink(test.id);
      const link = payload?.shareLink;
      if (!link) {
        throw new Error("Share link is not available");
      }
      await writeClipboardText(link);
      toast.success("Test link copied.");
    } catch (error) {
      toast.error(error?.message || "Unable to copy test link.");
    }
  };

  const openCreateDialog = () => {
    dispatch(setTestCreationContext("admin"));
    dispatch(openTestCreationDialog());
  };

  if (!canListTests && !canCreateTest) {
    return <PermissionDenied action="view or manage tests" />;
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-border">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Create Test</CardTitle>
            <CardDescription>Open the multi-step modal to create, validate, and publish tests.</CardDescription>
          </div>
          {canCreateTest ? (
            <>
              <Button onClick={openCreateDialog} className="bg-primary hover:bg-primary-dark">
                Create Test
              </Button>
              <TestCreationDialog hideTrigger />
            </>
          ) : <PermissionDenied action="create tests" />}
        </CardHeader>
      </Card>

      {canListTests ? (
        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>Existing Tests</CardTitle>
            <CardDescription>Use lifecycle filters and transition actions to manage test state safely.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-4">
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search by name or description" />
              <select className="h-10 rounded-md border border-border px-3 text-sm" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                {SORT_FIELDS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <select className="h-10 rounded-md border border-border px-3 text-sm" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
              <Button variant="outline" onClick={() => setBulkOpen(true)} disabled={selectedIds.length === 0}>Bulk Actions ({selectedIds.length})</Button>
            </div>

          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((status) => {
              const isActive = activeStatus === status;
              const count = statusCounts[status] || 0;
              return (
                <Button
                  key={status}
                  type="button"
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  onClick={() => { setActiveStatus(status); setPage(1); }}
                >
                  {status} ({count})
                </Button>
              );
            })}
          </div>

          {loading ? <p className="text-sm text-text-secondary">Loading tests...</p> : null}
          {!loading && tests.length === 0 ? <p className="text-sm text-text-secondary">No tests available.</p> : null}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-background">
                <tr>
                  <th className="px-3 py-2 text-left"><input type="checkbox" checked={tests.length > 0 && selectedIds.length === tests.length} onChange={(event) => setSelectedIds(event.target.checked ? tests.filter((item) => !isAdminReadOnlyTest(item)).map((item) => item.id) : [])} /></th>
                  <th className="px-3 py-2 text-left">Test Name</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-left">Date Range</th>
                  <th className="px-3 py-2 text-left">Attempts</th>
                  <th className="px-3 py-2 text-left">Avg Score</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-card">
                {tests.map((test) => {
                  const totalAttempts = Number(test?._count?.submissions || 0);
                  const adminReadOnly = isAdminReadOnlyTest(test);
                  const canOpenFullEditor = normalizeStatus(test.status) === "DRAFT";
                  const isModuleTest = normalizeAssessmentFormat(test?.assessmentFormat ?? test?.assessment_format) === ASSESSMENT_FORMATS.MODULE_TEST;
                  const moduleSectionCount = isModuleTest ? (Array.isArray(test?.modules) ? test.modules.filter((mod) => Number(mod?.durationMins) > 0).length : 0) : 0;
                  return (
                    <tr key={test.id}>
                      <td className="px-3 py-2"><input type="checkbox" checked={selectedIds.includes(test.id)} disabled={adminReadOnly} onChange={(event) => setSelectedIds((prev) => event.target.checked ? [...new Set([...prev, test.id])] : prev.filter((id) => id !== test.id))} /></td>
                      <td className="px-3 py-2 font-medium text-text-primary">
                        {test.title}
                        {isModuleTest ? (
                          <span className="ml-2 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            Module Test{moduleSectionCount > 0 ? ` · ${moduleSectionCount} sections` : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2"><span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[normalizeStatus(test.status)] || STATUS_TONE.DRAFT}`}>{normalizeStatus(test.status)}</span></td>
                      <td className="px-3 py-2 text-text-secondary">
                        {test?.department?.name || "Department"} / {test?.batchAssignments?.length || 0} batches
                        {adminReadOnly ? <span className="ml-2 text-xs text-amber-700">({managedByLabel(test)})</span> : null}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{new Date(test.startsAt).toLocaleDateString()} - {new Date(test.endsAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-text-secondary">{totalAttempts}</td>
                      <td className="px-3 py-2 text-text-secondary">{totalAttempts > 0 ? "Computed" : "-"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {canViewReports ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => navigate(`${basePath}/reports?test=${encodeURIComponent(test.id)}`)}
                            >
                              Reports
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyShareLink(test)}
                            disabled={!test.id}
                          >
                            <Copy className="mr-1 size-3.5" />
                            Link
                          </Button>
                          {canMonitor && normalizeStatus(test.status) === "LIVE" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => navigate(`${basePath}/tests/${test.id}/monitoring`)}
                            >
                              Monitor
                            </Button>
                          ) : null}
                          {canEdit && !adminReadOnly && canOpenFullEditor ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onOpenEdit(test.id)}
                              disabled={editingTestId === test.id}
                            >
                              {editingTestId === test.id ? "Opening..." : "Edit Test"}
                            </Button>
                          ) : null}
                          {canTransition && !adminReadOnly ? transitionsForStatus(normalizeStatus(test.status)).map((transition) => (
                            <Button key={`${test.id}-${transition.action}`} type="button" size="sm" variant={transition.action === "DELETE" ? "destructive" : "outline"} onClick={() => onTransition(test, transition.action)}>{transition.label}</Button>
                          )) : null}
                          {canDelete && !adminReadOnly && normalizeStatus(test.status) === "DRAFT" ? <Button size="sm" variant="destructive" onClick={() => onDeleteDraft(test)}>Delete</Button> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-text-secondary">Page {pagination.page || page} of {pagination.totalPages || 1}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={(pagination.page || page) <= 1}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setPage((prev) => prev + 1)} disabled={(pagination.page || page) >= (pagination.totalPages || 1)}>Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmActionDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction?.type === "delete" ? "Confirm Draft Deletion" : "Confirm Status Transition"}
        description={pendingAction?.description || "Please confirm this action."}
        confirmLabel={pendingAction?.type === "delete" ? "Delete" : "Confirm"}
        confirmVariant={pendingAction?.type === "delete" ? "destructive" : "default"}
        onConfirm={confirmPendingAction}
      />

      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Draft Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              Type <strong>{deleteDialog.test?.title}</strong> to permanently delete this draft test.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-name">Test name</Label>
            <Input id="delete-name" value={deleteConfirmName} onChange={(event) => setDeleteConfirmName(event.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteConfirmName.trim() !== String(deleteDialog.test?.title || "")}
              onClick={() => {
                if (deleteDialog.test?.id) dispatch(deleteAdminTest(deleteDialog.test.id));
                setDeleteDialog({ open: false, test: null });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmActionDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Bulk Action Confirmation"
        description={`You are about to ${bulkAction === "ARCHIVE" ? "archive" : "delete"} ${selectedTests.length} tests. ${bulkPreview.valid} valid, ${bulkPreview.skipped} skipped.`}
        confirmLabel="Proceed"
        onConfirm={runBulkAction}
      />

      {bulkOpen ? (
        <div className="fixed right-6 bottom-6 z-50 rounded-xl border border-border bg-card p-3 shadow-lg">
          <p className="mb-2 text-xs text-text-secondary">Choose bulk action</p>
          <div className="flex gap-2">
            <Button size="sm" variant={bulkAction === "ARCHIVE" ? "default" : "outline"} onClick={() => setBulkAction("ARCHIVE")}>Archive</Button>
            <Button size="sm" variant={bulkAction === "DELETE" ? "destructive" : "outline"} onClick={() => setBulkAction("DELETE")}>Delete</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
