import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { fetchAdminTests, transitionAdminTestStatus, deleteAdminTest } from "@/features/Admin/adminPanelSlice";
import { openTestCreationDialog, openTestEditDialog, setTestCreationContext } from "@/features/Admin/testCreationSlice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Activity, Archive, BarChart3, FileCheck2, Layers, Link2, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, EmptyState, FormField, PageHeader, PaginationBar, SearchInput, SectionCard, StatusBadge } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";
import { ASSESSMENT_FORMATS, normalizeAssessmentFormat } from "@/lib/testConfig";

const STATUS_TONE = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  LIVE: "success",
  COMPLETED: "info",
  ARCHIVED: "neutral",
};

const STATUS_LABEL = {
  ALL: "All",
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  LIVE: "Live",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
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

  const selectableIds = tests.filter((item) => !isAdminReadOnlyTest(item)).map((item) => item.id);
  const allSelected = tests.length > 0 && selectedIds.length === tests.length;
  const openBulk = (action) => {
    setBulkAction(action);
    setBulkOpen(true);
  };

  const columns = [
    {
      key: "select",
      header: (
        <input
          className="ui-checkbox"
          type="checkbox"
          aria-label="Select all tests on this page"
          checked={allSelected}
          onChange={(event) => setSelectedIds(event.target.checked ? selectableIds : [])}
        />
      ),
      mobileLabel: "Select",
      headerClassName: "w-10",
      cell: (test) => (
        <input
          className="ui-checkbox"
          type="checkbox"
          aria-label={`Select ${test.title}`}
          checked={selectedIds.includes(test.id)}
          disabled={isAdminReadOnlyTest(test)}
          onChange={(event) => setSelectedIds((prev) => (event.target.checked ? [...new Set([...prev, test.id])] : prev.filter((id) => id !== test.id)))}
        />
      ),
    },
    {
      key: "test",
      header: "Test",
      primary: true,
      cell: (test) => {
        const isModuleTest = normalizeAssessmentFormat(test?.assessmentFormat ?? test?.assessment_format) === ASSESSMENT_FORMATS.MODULE_TEST;
        const moduleSectionCount = isModuleTest ? (Array.isArray(test?.modules) ? test.modules.filter((mod) => Number(mod?.durationMins) > 0).length : 0) : 0;
        return (
          <div className="min-w-0 max-w-sm">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-text-primary">
              <span className="truncate">{test.title}</span>
              {isModuleTest ? (
                <StatusBadge tone="info" icon={Layers} className="h-5 px-2 text-[11px]">
                  Module Test{moduleSectionCount > 0 ? ` · ${moduleSectionCount} sections` : ""}
                </StatusBadge>
              ) : null}
            </p>
            {isAdminReadOnlyTest(test) ? <p className="text-xs text-amber-700">{managedByLabel(test)}</p> : null}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (test) => {
        const status = normalizeStatus(test.status);
        return (
          <StatusBadge tone={STATUS_TONE[status] || "neutral"}>
            {status === "LIVE" ? <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" /> : null}
            {STATUS_LABEL[status] || status}
          </StatusBadge>
        );
      },
    },
    {
      key: "target",
      header: "Target",
      className: "text-text-secondary",
      cell: (test) => `${test?.department?.name || "Department"} · ${test?.batchAssignments?.length || 0} batches`,
    },
    {
      key: "dates",
      header: "Date range",
      className: "whitespace-nowrap text-text-secondary",
      cell: (test) => `${new Date(test.startsAt).toLocaleDateString()} – ${new Date(test.endsAt).toLocaleDateString()}`,
    },
    { key: "attempts", header: "Attempts", align: "right", className: "tabular-nums", cell: (test) => Number(test?._count?.submissions || 0) },
    {
      key: "actions",
      actions: true,
      align: "right",
      cell: (test) => {
        const status = normalizeStatus(test.status);
        const adminReadOnly = isAdminReadOnlyTest(test);
        const canOpenFullEditor = status === "DRAFT";
        const transitions = canTransition && !adminReadOnly ? transitionsForStatus(status) : [];
        const showDelete = canDelete && !adminReadOnly && status === "DRAFT";
        return (
          <div className="flex items-center justify-end gap-1.5">
            {canMonitor && status === "LIVE" ? (
              <Button size="lg" variant="outline" className="rounded-lg" onClick={() => navigate(`${basePath}/tests/${test.id}/monitoring`)}>
                <Activity className="size-4" />
                Monitor
              </Button>
            ) : null}
            {canEdit && !adminReadOnly && canOpenFullEditor ? (
              <Button size="lg" variant="outline" className="rounded-lg" onClick={() => onOpenEdit(test.id)} disabled={editingTestId === test.id}>
                <Pencil className="size-4" />
                {editingTestId === test.id ? "Opening..." : "Edit Test"}
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-lg" variant="ghost" className="rounded-lg text-text-secondary">
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">More actions for {test.title}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {canViewReports ? (
                  <DropdownMenuItem className="h-9 gap-2 px-2" onSelect={() => navigate(`${basePath}/reports?test=${encodeURIComponent(test.id)}`)}>
                    <BarChart3 className="size-4" /> Reports
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem className="h-9 gap-2 px-2" disabled={!test.id} onSelect={() => copyShareLink(test)}>
                  <Link2 className="size-4" /> Copy Link
                </DropdownMenuItem>
                {transitions.length ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs font-normal text-text-secondary">Change status</DropdownMenuLabel>
                    {transitions.map((transition) => (
                      <DropdownMenuItem key={`${test.id}-${transition.action}`} className="h-9 gap-2 px-2" onSelect={() => onTransition(test, transition.action)}>
                        {transition.label}
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
                {showDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="h-9 gap-2 px-2" variant="destructive" onSelect={() => onDeleteDraft(test)}>
                      <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tests"
        description="Create tests with the multi-step builder, then manage their lifecycle from draft to archive."
        actions={
          canCreateTest ? (
            <Button onClick={openCreateDialog} className="h-10 rounded-lg px-4">
              <Plus className="size-4" />
              Create Test
            </Button>
          ) : null
        }
      />
      {canCreateTest ? <TestCreationDialog hideTrigger /> : <PermissionDenied action="create tests" />}

      {canListTests ? (
        <SectionCard
          flush
          footer={
            (pagination.totalPages || 1) > 1 ? (
              <PaginationBar
                page={pagination.page || page}
                pages={pagination.totalPages || 1}
                total={typeof pagination.total === "number" ? pagination.total : undefined}
                disabled={loading}
                onPageChange={(next) => setPage(Math.max(1, next))}
              />
            ) : null
          }
        >
          <div className="relative -mb-px overflow-x-auto overflow-y-hidden border-b border-border px-4 sm:px-5">
            <div role="tablist" aria-label="Filter by status" className="flex min-w-max gap-5">
              {STATUS_FILTERS.map((status) => {
                const isActive = activeStatus === status;
                const count = statusCounts[status] || 0;
                return (
                  <button
                    key={status}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => {
                      setActiveStatus(status);
                      setPage(1);
                    }}
                    className={cn(
                      "relative flex h-12 items-center gap-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      isActive ? "text-primary" : "text-text-secondary hover:text-text-primary"
                    )}
                  >
                    {STATUS_LABEL[status] || status}
                    <span className={cn("rounded-full px-1.5 text-xs tabular-nums", isActive ? "bg-primary/10" : "bg-muted")}>{count}</span>
                    {isActive ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
            <SearchInput
              className="min-w-0 flex-1 basis-60"
              label="Search tests"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search by name or description"
            />
            <select aria-label="Sort by" className="ui-select" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              {SORT_FIELDS.map((item) => (
                <option key={item.value} value={item.value}>Sort: {item.label}</option>
              ))}
            </select>
            <select aria-label="Sort order" className="ui-select" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>

          {selectedIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-4 py-2.5 sm:px-5" role="region" aria-label="Bulk actions">
              <span className="text-sm font-medium text-text-primary">{selectedIds.length} selected</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="outline" className="h-9 rounded-lg" onClick={() => openBulk("ARCHIVE")}>
                  <Archive className="size-4" />
                  Archive
                </Button>
                {canDelete ? (
                  <Button variant="ghost" className="h-9 rounded-lg text-danger hover:bg-danger/10 hover:text-danger" onClick={() => openBulk("DELETE")}>
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                ) : null}
                <Button variant="ghost" className="h-9 rounded-lg text-text-secondary" onClick={() => setSelectedIds([])}>
                  <X className="size-4" />
                  Clear
                </Button>
              </div>
            </div>
          ) : null}

          <DataTable
            columns={columns}
            rows={tests}
            getRowKey={(test) => test.id}
            loading={loading}
            minWidth={980}
            caption="Tests"
            rowClassName={(test) => (selectedIds.includes(test.id) ? "bg-primary/5" : "")}
            empty={
              <EmptyState
                icon={FileCheck2}
                title={search || activeStatus !== "ALL" ? "No tests match these filters" : "No tests available"}
                description={canCreateTest ? "Create your first test with the button above." : "Tests assigned to you will appear here."}
                className="border-0"
              />
            }
          />
        </SectionCard>
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
          <FormField label="Test name" htmlFor="delete-name">
            <Input id="delete-name" autoComplete="off" className="h-10 rounded-lg" value={deleteConfirmName} onChange={(event) => setDeleteConfirmName(event.target.value)} />
          </FormField>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
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
        title={bulkAction === "ARCHIVE" ? "Archive selected tests" : "Delete selected tests"}
        description={`You are about to ${bulkAction === "ARCHIVE" ? "archive" : "delete"} ${selectedTests.length} tests. ${bulkPreview.valid} valid, ${bulkPreview.skipped} skipped.`}
        confirmLabel={bulkAction === "ARCHIVE" ? "Archive" : "Delete"}
        confirmVariant={bulkAction === "DELETE" ? "destructive" : "default"}
        onConfirm={runBulkAction}
      />
    </div>
  );
}
