import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { openTestCreationDialog, openTestEditDialog, setTestCreationContext } from "@/features/Admin/testCreationSlice";
import { fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import TestCreationDialog from "@/components/Admin/TestCreationDialog";
import { ASSESSMENT_FORMATS, normalizeAssessmentFormat } from "@/lib/testConfig";
import { Activity, Copy, FileCheck2, Layers, Link2, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Callout, DataTable, DisclosureSection, EmptyState, FormField, PageHeader, PaginationBar, SearchInput, SectionCard, StatusBadge } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

const PAGE_SIZE = 10;
const API_PAGE_SIZE = 100;
const STATUS_OPTIONS = ["ALL", "DRAFT", "SCHEDULED", "LIVE", "COMPLETED", "ARCHIVED"];

const STATUS_TONE = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  LIVE: "success",
  COMPLETED: "info",
  ARCHIVED: "neutral",
};

const STATUS_LABEL = {
  ALL: "All statuses",
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

const getAssignedDepartmentIds = (test) => {
  const ids = Array.isArray(test?.assignedTo) ? test.assignedTo : [];
  return [...new Set(ids.filter(Boolean).map((id) => String(id)))];
};

const getAssignedDepartmentNames = (test, nameById) => {
  const ids = getAssignedDepartmentIds(test);
  if (!ids.length) {
    return [];
  }

  return ids.map((id) => nameById[id] || "Unknown Department");
};

const transitionsForStatus = (status) => {
  switch (status) {
    case "DRAFT":
      return [
        { action: "SCHEDULE", label: "Schedule" },
        { action: "GO_LIVE", label: "Go Live" },
        { action: "ARCHIVE", label: "Archive" },
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
      return [
        { action: "ARCHIVE", label: "Archive" },
      ];
    default:
      return [];
  }
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

const fetchAllPages = async (request, params = {}) => {
  const loadPage = async (page) => {
    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("limit", String(API_PAGE_SIZE));
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        query.set(key, String(value));
      }
    });
    return request(`?${query.toString()}`);
  };

  const firstPage = await loadPage(1);
  const firstRows = Array.isArray(firstPage?.data) ? firstPage.data : [];
  const totalPages = Number(firstPage?.pagination?.pages || firstPage?.pagination?.totalPages || 1);

  if (totalPages <= 1) {
    return firstRows;
  }

  const restPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) => loadPage(index + 2))
  );

  return [
    ...firstRows,
    ...restPages.flatMap((result) => (Array.isArray(result?.data) ? result.data : [])),
  ];
};

export default function TestsPage() {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const handledCreateTriggerRef = useRef("");
  const colleges = useSelector((state) => state.superAdminPanel.colleges);

  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [cloneTarget, setCloneTarget] = useState({
    testId: "",
    destinationCollegeId: "",
    assignmentMethod: "batch_wise",
    departmentIds: [],
    batchIds: [],
  });
  const [scopeOptions, setScopeOptions] = useState([]);
  const [loadingScopeOptions, setLoadingScopeOptions] = useState(false);
  const [scopeSearch, setScopeSearch] = useState("");
  const [pendingAction, setPendingAction] = useState(null);

  const [tests, setTests] = useState([]);
  const [departmentNameById, setDepartmentNameById] = useState({});
  const [loadingTests, setLoadingTests] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingTestId, setEditingTestId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [topicFilter, setTopicFilter] = useState("");
  const [collegeFilter, setCollegeFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [departmentFilterOptions, setDepartmentFilterOptions] = useState([]);
  const [loadingDepartmentFilterOptions, setLoadingDepartmentFilterOptions] = useState(false);
  const [page, setPage] = useState(1);
  const [pendingDeleteTest, setPendingDeleteTest] = useState(null);

  const loadTests = async () => {
    setLoadingTests(true);
    try {
      const rows = await fetchAllPages(superAdminApi.getTests);
      setTests(Array.from(new Map(rows.map((item) => [item.id, item])).values()));
    } catch (error) {
      setBanner({ type: "error", title: "Failed to load tests", message: error?.message || "Unable to fetch global tests." });
    } finally {
      setLoadingTests(false);
    }
  };

  const loadDepartmentDirectory = async () => {
    const byId = {};
    const rows = await fetchAllPages(superAdminApi.getDepartments);
    rows.forEach((item) => {
      if (item?.id) {
        byId[String(item.id)] = item.name || String(item.id);
      }
    });

    setDepartmentNameById(byId);
  };

  useEffect(() => {
    dispatch(fetchSuperColleges());
    loadTests();
    loadDepartmentDirectory().catch(() => {
      setDepartmentNameById({});
    });
  }, [dispatch]);

  useEffect(() => {
    setDepartmentFilter("");

    const loadDepartmentFilterOptions = async () => {
      if (!collegeFilter) {
        setDepartmentFilterOptions([]);
        return;
      }

      setLoadingDepartmentFilterOptions(true);
      try {
        const rows = await fetchAllPages(superAdminApi.getDepartments, { collegeId: collegeFilter });
        setDepartmentFilterOptions(rows);
      } catch {
        setDepartmentFilterOptions([]);
      } finally {
        setLoadingDepartmentFilterOptions(false);
      }
    };

    loadDepartmentFilterOptions();
  }, [collegeFilter]);

  useEffect(() => {
    const isCreateRoute = /\/super-admin\/tests\/create\/?$/.test(location.pathname);
    const currentSearchParams = new URLSearchParams(location.search);
    const isCreateQuery = currentSearchParams.get("create") === "1";

    if (!isCreateRoute && !isCreateQuery) {
      return;
    }

    const triggerKey = `${location.pathname}${location.search}`;
    if (handledCreateTriggerRef.current === triggerKey) {
      return;
    }
    handledCreateTriggerRef.current = triggerKey;

    dispatch(setTestCreationContext("super_admin"));
    dispatch(openTestCreationDialog());

    if (isCreateRoute) {
      navigate("/super-admin/tests", { replace: true });
      return;
    }

    const nextSearchParams = new URLSearchParams(currentSearchParams);
    nextSearchParams.delete("create");
    setSearchParams(nextSearchParams, { replace: true });
  }, [dispatch, location.pathname, location.search, navigate, setSearchParams]);

  const filteredTests = useMemo(() => {
    const term = search.trim().toLowerCase();
    const topicTerm = topicFilter.trim().toLowerCase();
    return tests.filter((item) => {
      const statusOk = statusFilter === "ALL" || normalizeStatus(String(item.status || "").toUpperCase()) === statusFilter;
      if (!statusOk) return false;
      if (collegeFilter && String(item.collegeId || item.college?.id || "") !== String(collegeFilter)) return false;
      if (departmentFilter) {
        const assignedDepartmentIds = getAssignedDepartmentIds(item);
        const relatedDepartmentIds = [
          item.departmentId,
          item.department?.id,
          item.batch?.departmentId,
          ...assignedDepartmentIds,
        ].filter(Boolean).map((id) => String(id));
        if (!relatedDepartmentIds.includes(String(departmentFilter))) return false;
      }
      if (topicTerm && !String(item.subject || "").toLowerCase().includes(topicTerm)) return false;
      if (!term) return true;
      const haystack = `${item.title || ""} ${item.subject || ""} ${item.college?.name || ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [collegeFilter, departmentFilter, search, statusFilter, tests, topicFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTests.length / PAGE_SIZE));
  const pagedTests = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredTests.slice(start, start + PAGE_SIZE);
  }, [filteredTests, page]);

  useEffect(() => {
    setPage(1);
  }, [collegeFilter, departmentFilter, search, statusFilter, topicFilter]);

  const resetAllTestFilters = () => {
    setSearch("");
    setStatusFilter("ALL");
    setTopicFilter("");
    setCollegeFilter("");
    setDepartmentFilter("");
  };

  useEffect(() => {
    const loadScopeOptions = async () => {
      if (!cloneTarget.destinationCollegeId) {
        setScopeOptions([]);
        return;
      }

      setLoadingScopeOptions(true);
      try {
        if (cloneTarget.assignmentMethod === "department_wise") {
          const rows = await fetchAllPages(superAdminApi.getDepartments, {
            collegeId: cloneTarget.destinationCollegeId,
          });
          setScopeOptions(rows);
        } else {
          const rows = await fetchAllPages(superAdminApi.getBatches, {
            collegeId: cloneTarget.destinationCollegeId,
          });
          setScopeOptions(rows);
        }
      } catch {
        setScopeOptions([]);
      } finally {
        setLoadingScopeOptions(false);
      }
    };

    loadScopeOptions();
  }, [cloneTarget.destinationCollegeId, cloneTarget.assignmentMethod]);

  const filteredScopeOptions = useMemo(() => {
    const term = scopeSearch.trim().toLowerCase();
    if (!term) return scopeOptions;

    return scopeOptions.filter((item) => {
      const text = `${item.name || ""} ${item.year || ""} ${item.college?.name || ""} ${item.department?.name || ""}`.toLowerCase();
      return text.includes(term);
    });
  }, [scopeOptions, scopeSearch]);

  const selectedScopeIds =
    cloneTarget.assignmentMethod === "department_wise" ? cloneTarget.departmentIds : cloneTarget.batchIds;

  const clone = async () => {
    if (!cloneTarget.testId || !cloneTarget.destinationCollegeId) {
      setBanner({ type: "warning", title: "Clone details required", message: "Provide source test and destination college." });
      return;
    }

    if (!selectedScopeIds.length) {
      setBanner({
        type: "warning",
        title: "Assignment scope required",
        message: cloneTarget.assignmentMethod === "department_wise"
          ? "Select at least one department for assignment."
          : "Select at least one batch for assignment.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const clonedResp = await superAdminApi.cloneTest(cloneTarget.testId, {
        destinationCollegeId: cloneTarget.destinationCollegeId,
        assignmentMethod: cloneTarget.assignmentMethod,
        departmentIds: cloneTarget.assignmentMethod === "department_wise" ? cloneTarget.departmentIds : [],
        batchIds: cloneTarget.assignmentMethod === "batch_wise" ? cloneTarget.batchIds : [],
      });

      const clonedId = clonedResp?.id || (clonedResp?.data && clonedResp.data.id);

      toast.success("Draft clone created.");
      setBanner({
        type: "success",
        title: "Draft clone created",
        message: "Test cloned as a draft. Edit it, then schedule or publish it when ready.",
        testId: clonedId,
      });

      setCloneTarget({
        testId: "",
        destinationCollegeId: "",
        assignmentMethod: "batch_wise",
        departmentIds: [],
        batchIds: [],
      });
      setScopeOptions([]);
      setScopeSearch("");
      await loadTests();
    } catch (error) {
      setBanner({ type: "error", title: "Clone failed", message: error?.message || "Unable to clone test." });
      toast.error(error?.message || "Failed to clone test.");
    } finally {
      setSubmitting(false);
    }
  };

  const onOpenEdit = async (testId) => {
    if (!testId) return;

    try {
      setEditingTestId(testId);
      const testDetail = await superAdminApi.getTestById(testId);
      dispatch(openTestEditDialog({ test: testDetail }));
    } catch (error) {
      toast.error(error?.message || "Failed to load test for editing.");
    } finally {
      setEditingTestId("");
    }
  };

  const copyShareLink = async (testId) => {
    if (!testId) return;

    try {
      const payload = await superAdminApi.getTestShareLink(testId);
      const link = payload?.shareLink;
      if (!link) {
        throw new Error("Share link is not available");
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = link;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      toast.success("Test link copied.");
    } catch (error) {
      toast.error(error?.message || "Unable to copy test link.");
    }
  };

  const openCreateDialog = () => {
    dispatch(setTestCreationContext("super_admin"));
    dispatch(openTestCreationDialog());
  };

  const onTransition = (test, action) => {
    setPendingAction({
      test,
      action,
      description: transitionConfirmationText(test.title, action),
    });
  };

  const onDeleteTest = async (test) => {
    if (!test?.id) return;

    const submissionCount = Number(test?._count?.submissions || 0);
    if (submissionCount > 0) {
      setBanner({
        type: "warning",
        title: "Archive test instead",
        message: `"${test.title || "Untitled Test"}" already has ${submissionCount} submission${submissionCount === 1 ? "" : "s"}, so it cannot be deleted. Archive it to keep reports intact.`,
        testId: test.id,
      });
      toast.error("This test has submissions. Archive it instead.");
      return;
    }

    setPendingDeleteTest(test);
  };

  const performDeleteTest = async (test) => {
    if (!test?.id) return;
    setSubmitting(true);
    try {
      await superAdminApi.deactivateTest(test.id);
      toast.success("Test deleted.");
      setBanner({ type: "success", title: "Test deleted", message: "The selected test was removed." });
      await loadTests();
    } catch (error) {
      setBanner({ type: "error", title: "Delete failed", message: error?.message || "Unable to delete test." });
      toast.error(error?.message || "Failed to delete test.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmPendingAction = async () => {
    if (!pendingAction?.test?.id) {
      setPendingAction(null);
      return;
    }

    setSubmitting(true);
    try {
      await superAdminApi.transitionTestStatus(pendingAction.test.id, pendingAction.action);
      toast.success("Test status updated.");
      setBanner({ type: "success", title: "Status updated", message: `Test moved via ${pendingAction.action}.` });
      setPendingAction(null);
      await loadTests();
    } catch (error) {
      setBanner({ type: "error", title: "Transition failed", message: error?.message || "Unable to update test status." });
      toast.error(error?.message || "Failed to update test status.");
    } finally {
      setSubmitting(false);
    }
  };

  const bannerTone = banner.type === "error" ? "danger" : banner.type === "warning" ? "warning" : "success";
  const hasTestFilters = Boolean(search || topicFilter || collegeFilter || departmentFilter || statusFilter !== "ALL");

  const columns = [
    {
      key: "test",
      header: "Test",
      primary: true,
      cell: (test) => {
        const isModuleTest = normalizeAssessmentFormat(test?.assessmentFormat ?? test?.assessment_format) === ASSESSMENT_FORMATS.MODULE_TEST;
        const moduleSectionCount = isModuleTest ? (Array.isArray(test?.modules) ? test.modules.filter((mod) => Number(mod?.durationMins) > 0).length : 0) : 0;
        return (
          <div className="min-w-0 max-w-md">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-text-primary">
              <span className="truncate">{test.title}</span>
              {isModuleTest ? (
                <StatusBadge tone="info" icon={Layers} className="h-5 px-2 text-[11px]">
                  Module Test{moduleSectionCount > 0 ? ` · ${moduleSectionCount} sections` : ""}
                </StatusBadge>
              ) : null}
            </p>
            <p className="truncate text-xs text-text-secondary">{test.subject || "—"}</p>
          </div>
        );
      },
    },
    { key: "college", header: "College", className: "max-w-48 truncate text-text-secondary", cell: (test) => test.college?.name || "-" },
    {
      key: "departments",
      header: "Assigned to",
      className: "max-w-56",
      cell: (test) => {
        const names = getAssignedDepartmentNames(test, departmentNameById);
        return names.length ? (
          <span className="line-clamp-2 text-xs text-text-secondary" title={names.join(", ")}>{names.join(", ")}</span>
        ) : (
          <span className="text-text-secondary">-</span>
        );
      },
    },
    { key: "questions", header: "Questions", align: "right", className: "tabular-nums", cell: (test) => test?._count?.questions || 0 },
    { key: "attempts", header: "Attempts", align: "right", className: "tabular-nums", cell: (test) => Number(test?._count?.submissions || 0) },
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
      key: "actions",
      actions: true,
      align: "right",
      cell: (test) => {
        const submissionCount = Number(test?._count?.submissions || 0);
        const status = normalizeStatus(test.status);
        // DRAFT allows full editing (incl. questions); SCHEDULED/LIVE allow
        // settings-only edits. COMPLETED/ARCHIVED are immutable.
        const canEditTest = status === "DRAFT" || status === "SCHEDULED" || status === "LIVE";
        const canDeleteTest = status === "DRAFT" && submissionCount === 0;
        const transitions = transitionsForStatus(status);

        return (
          <div className="flex items-center justify-end gap-1.5">
            {status === "LIVE" ? (
              <Button size="lg" variant="outline" className="rounded-lg" onClick={() => navigate(`/super-admin/tests/${test.id}/monitoring`)}>
                <Activity className="size-4" />
                Monitor
              </Button>
            ) : null}
            <Button size="lg" variant="outline" className="rounded-lg" onClick={() => onOpenEdit(test.id)} disabled={editingTestId === test.id || !canEditTest}>
              <Pencil className="size-4" />
              {editingTestId === test.id ? "Opening..." : status === "DRAFT" ? "Edit Test" : "Edit Settings"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-lg" variant="ghost" className="rounded-lg text-text-secondary" disabled={submitting}>
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">More actions for {test.title}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem className="h-9 gap-2 px-2" onSelect={() => copyShareLink(test.id)}>
                  <Link2 className="size-4" /> Copy Link
                </DropdownMenuItem>
                {transitions.length ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs font-normal text-text-secondary">Change status</DropdownMenuLabel>
                    {transitions.map((transition) => (
                      <DropdownMenuItem
                        key={`${test.id}-${transition.action}`}
                        className="h-9 gap-2 px-2"
                        onSelect={() => onTransition(test, transition.action)}
                      >
                        {transition.label}
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
                {canDeleteTest ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="h-9 gap-2 px-2" variant="destructive" onSelect={() => onDeleteTest(test)}>
                      <Trash2 className="size-4" /> Delete Test
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
        description="Every test across all colleges, with lifecycle controls. New tests use the same multi-step workflow as Admin test creation."
        actions={
          <Button onClick={openCreateDialog} className={ui.btn}>
            <Plus className="size-4" />
            Create Test
          </Button>
        }
      />
      <TestCreationDialog context="super_admin" onCreated={loadTests} hideTrigger />

      {banner.type ? (
        <Callout tone={bannerTone} title={banner.title}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{banner.message}</span>
            {banner.testId ? (
              <Button variant="outline" className="h-9 rounded-lg" onClick={() => onOpenEdit(banner.testId)} disabled={!!editingTestId}>
                View / Manage
              </Button>
            ) : null}
          </div>
        </Callout>
      ) : null}

      <DisclosureSection
        icon={Copy}
        title="Clone test across colleges"
        description="Clones are created as drafts so they can be reviewed, edited, then scheduled or published when ready."
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <FormField label="Source test" htmlFor="clone-test-id" required>
              <select
                id="clone-test-id"
                className="ui-select w-full"
                value={cloneTarget.testId}
                onChange={(e) => setCloneTarget((p) => ({ ...p, testId: e.target.value }))}
              >
                <option value="">Select test</option>
                {tests.map((test) => (
                  <option key={test.id} value={test.id}>
                    {test.title} ({test.subject || "-"}) • {test.college?.name || "-"}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Destination college" htmlFor="clone-destination-college" required>
              <select id="clone-destination-college" className="ui-select w-full" value={cloneTarget.destinationCollegeId} onChange={(e) => setCloneTarget((p) => ({ ...p, destinationCollegeId: e.target.value }))}>
                <option value="">Destination college</option>
                {colleges.map((college) => (
                  <option key={college.id} value={college.id}>{college.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Assignment mode" htmlFor="clone-assignment-method">
              <select
                id="clone-assignment-method"
                className="ui-select w-full"
                value={cloneTarget.assignmentMethod}
                onChange={(e) => {
                  const method = e.target.value;
                  setCloneTarget((p) => ({
                    ...p,
                    assignmentMethod: method,
                    departmentIds: [],
                    batchIds: [],
                  }));
                  setScopeSearch("");
                }}
              >
                <option value="batch_wise">Batch wise</option>
                <option value="department_wise">Department wise</option>
              </select>
            </FormField>
          </div>

          <fieldset className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="text-sm font-medium text-text-primary">
                {cloneTarget.assignmentMethod === "department_wise" ? "Select Departments" : "Select Batches"}
                <span className="ml-2 text-xs font-normal text-text-secondary">{selectedScopeIds.length} selected</span>
              </legend>
              <SearchInput
                className="w-full sm:w-64"
                placeholder={cloneTarget.assignmentMethod === "department_wise" ? "Search departments" : "Search batches"}
                value={scopeSearch}
                onChange={(e) => setScopeSearch(e.target.value)}
              />
            </div>

            <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
              {loadingScopeOptions ? <p className="p-3 text-sm text-text-secondary" role="status">Loading options...</p> : null}
              {!loadingScopeOptions && !cloneTarget.destinationCollegeId ? <p className="p-3 text-sm text-text-secondary">Choose a destination college to load options.</p> : null}
              {!loadingScopeOptions && cloneTarget.destinationCollegeId && filteredScopeOptions.length === 0 ? <p className="p-3 text-sm text-text-secondary">No matching options found.</p> : null}

              <ul className="divide-y divide-border">
                {filteredScopeOptions.map((item) => {
                  const isChecked = selectedScopeIds.includes(item.id);
                  return (
                    <li key={item.id}>
                      <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40", isChecked ? "bg-primary/5" : "")}>
                        <input
                          type="checkbox"
                          className="ui-checkbox"
                          checked={isChecked}
                          onChange={() => {
                            setCloneTarget((prev) => {
                              if (prev.assignmentMethod === "department_wise") {
                                const next = isChecked
                                  ? prev.departmentIds.filter((id) => id !== item.id)
                                  : [...prev.departmentIds, item.id];
                                return { ...prev, departmentIds: next };
                              }

                              const next = isChecked
                                ? prev.batchIds.filter((id) => id !== item.id)
                                : [...prev.batchIds, item.id];
                              return { ...prev, batchIds: next };
                            });
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-text-primary">{item.name}</span>
                          {cloneTarget.assignmentMethod === "batch_wise" ? (
                            <span className="block text-xs text-text-secondary">{item.year || "-"} • {item.department?.name || "-"}</span>
                          ) : (
                            <span className="block text-xs text-text-secondary">{item.college?.name || "-"}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </fieldset>

          <Button className={ui.btn} onClick={clone} disabled={submitting || !cloneTarget.testId || !cloneTarget.destinationCollegeId || !selectedScopeIds.length}>
            <Copy className="size-4" />
            Clone Test
          </Button>
        </div>
      </DisclosureSection>

      <SectionCard
        flush
        title="All tests"
        description={`${filteredTests.length} test${filteredTests.length === 1 ? "" : "s"}${hasTestFilters ? " match the filters" : ""}`}
        footer={filteredTests.length > PAGE_SIZE ? <PaginationBar page={page} pages={totalPages} total={filteredTests.length} onPageChange={(next) => setPage(Math.min(Math.max(next, 1), totalPages))} /> : null}
      >
        <div className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]">
          <SearchInput
            id="test-search"
            className="sm:col-span-2 lg:col-span-1"
            label="Search tests"
            placeholder="Search by title, subject, or college"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Input id="test-topic-filter" aria-label="Topic" className={ui.field} placeholder="Filter topic" value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)} />
          <select id="test-college-filter" aria-label="College" className="ui-select w-full" value={collegeFilter} onChange={(e) => setCollegeFilter(e.target.value)}>
            <option value="">All colleges</option>
            {colleges.map((college) => (
              <option key={college.id} value={college.id}>{college.name}</option>
            ))}
          </select>
          <select
            id="test-department-filter"
            aria-label="Department"
            className="ui-select w-full"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            disabled={!collegeFilter || loadingDepartmentFilterOptions}
          >
            <option value="">
              {!collegeFilter ? "Select college first" : loadingDepartmentFilterOptions ? "Loading departments..." : "All departments"}
            </option>
            {departmentFilterOptions.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
          <select id="test-status-filter" aria-label="Status" className="ui-select w-full" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>{STATUS_LABEL[item] || item}</option>
            ))}
          </select>
          <Button variant="ghost" className={ui.btn} onClick={resetAllTestFilters} disabled={!hasTestFilters}>
            <RotateCcw className="size-4" />
            Clear Filters
          </Button>
        </div>

        <DataTable
          columns={columns}
          rows={pagedTests}
          getRowKey={(test) => test.id}
          loading={loadingTests}
          minWidth={1080}
          caption="Tests"
          empty={
            <EmptyState
              icon={FileCheck2}
              title={hasTestFilters ? "No tests found for selected filters" : "No tests yet"}
              description={hasTestFilters ? "Try clearing some filters." : "Create the first test with the button above."}
              className="border-0"
            />
          }
        />
      </SectionCard>

      <ConfirmActionDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title="Confirm Status Transition"
        description={pendingAction?.description || "Please confirm this action."}
        confirmLabel="Confirm"
        onConfirm={confirmPendingAction}
      />

      <ConfirmActionDialog
        open={Boolean(pendingDeleteTest)}
        onOpenChange={(open) => !open && setPendingDeleteTest(null)}
        title="Delete test"
        description={`Delete test "${pendingDeleteTest?.title || "Untitled Test"}"? This cannot be undone.`}
        confirmLabel="Delete Test"
        confirmVariant="destructive"
        onConfirm={async () => {
          const target = pendingDeleteTest;
          setPendingDeleteTest(null);
          await performDeleteTest(target);
        }}
      />
    </div>
  );
}
