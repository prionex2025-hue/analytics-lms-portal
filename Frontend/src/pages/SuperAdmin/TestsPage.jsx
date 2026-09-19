import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { openTestCreationDialog, openTestEditDialog, setTestCreationContext } from "@/features/Admin/testCreationSlice";
import { fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import TestCreationDialog from "@/components/Admin/TestCreationDialog";
import { ASSESSMENT_FORMATS, normalizeAssessmentFormat } from "@/lib/testConfig";

const PAGE_SIZE = 10;
const API_PAGE_SIZE = 100;
const STATUS_OPTIONS = ["ALL", "DRAFT", "SCHEDULED", "LIVE", "COMPLETED", "ARCHIVED"];

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

    const confirmed = window.confirm(`Delete test "${test.title || "Untitled Test"}"? This cannot be undone.`);
    if (!confirmed) return;

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

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"} className={banner.type === "warning" ? "border-warning/30 bg-warning/10 text-warning" : ""}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <AlertTitle>{banner.title}</AlertTitle>
              <AlertDescription>{banner.message}</AlertDescription>
            </div>
            {banner.testId ? (
              <div className="shrink-0">
                <Button variant="outline" onClick={() => onOpenEdit(banner.testId)} disabled={!!editingTestId}>
                  View / Manage
                </Button>
              </div>
            ) : null}
          </div>
        </Alert>
      ) : null}

      <Card className="rounded-2xl border-border">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Create Global Test</CardTitle>
            <CardDescription>Uses the exact same multi-step workflow and system design as Admin test creation.</CardDescription>
          </div>
          <Button onClick={openCreateDialog} className="bg-primary hover:bg-primary-dark">
            Create Test
          </Button>
          <TestCreationDialog context="super_admin" onCreated={loadTests} hideTrigger />
        </CardHeader>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Clone Test Across Colleges</CardTitle>
          <CardDescription>Clones are created as drafts so they can be reviewed, edited, then scheduled or published when ready.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <label htmlFor="clone-test-id" className="text-sm font-medium text-text-secondary">Source test</label>
            <select
              id="clone-test-id"
              className="h-10 w-full rounded-lg border border-border px-2"
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
          </div>
          <div className="space-y-1.5">
            <label htmlFor="clone-destination-college" className="text-sm font-medium text-text-secondary">Destination college</label>
            <select id="clone-destination-college" className="h-10 w-full rounded-lg border border-border px-2" value={cloneTarget.destinationCollegeId} onChange={(e) => setCloneTarget((p) => ({ ...p, destinationCollegeId: e.target.value }))}>
              <option value="">Destination college</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="clone-assignment-method" className="text-sm font-medium text-text-secondary">Assignment mode</label>
            <select
              id="clone-assignment-method"
              className="h-10 w-full rounded-lg border border-border px-2"
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
          </div>
          <div className="flex items-end">
            <Button className="w-full bg-primary hover:bg-primary" onClick={clone} disabled={submitting || !cloneTarget.testId || !cloneTarget.destinationCollegeId || !selectedScopeIds.length}>Clone Test</Button>
          </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-text-secondary">
                {cloneTarget.assignmentMethod === "department_wise" ? "Select Departments" : "Select Batches"}
              </p>
              <Input
                placeholder={cloneTarget.assignmentMethod === "department_wise" ? "Search departments" : "Search batches"}
                value={scopeSearch}
                onChange={(e) => setScopeSearch(e.target.value)}
                className="max-w-64"
              />
            </div>

            <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
              {loadingScopeOptions ? <p className="text-xs text-text-secondary">Loading options...</p> : null}
              {!loadingScopeOptions && !cloneTarget.destinationCollegeId ? <p className="text-xs text-text-secondary">Choose destination college to load options.</p> : null}
              {!loadingScopeOptions && cloneTarget.destinationCollegeId && filteredScopeOptions.length === 0 ? <p className="text-xs text-text-secondary">No matching options found.</p> : null}

              {filteredScopeOptions.map((item) => {
                const isChecked = selectedScopeIds.includes(item.id);
                return (
                  <label key={item.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-text-primary">{item.name}</p>
                      {cloneTarget.assignmentMethod === "batch_wise" ? (
                        <p className="text-xs text-text-secondary">{item.year || "-"} • {item.department?.name || "-"}</p>
                      ) : (
                        <p className="text-xs text-text-secondary">{item.college?.name || "-"}</p>
                      )}
                    </div>
                    <input
                      type="checkbox"
                      className="size-4"
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
                  </label>
                );
              })}
            </div>

            <p className="text-xs text-text-secondary">
              Selected: {selectedScopeIds.length}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>All Global Tests</CardTitle>
          <CardDescription>Admin-like searchable test inventory with lifecycle visibility and archive actions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-1.5 xl:col-span-2">
              <label htmlFor="test-search" className="text-sm font-medium text-text-secondary">Search</label>
              <Input id="test-search" placeholder="Search by title, subject, or college" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="test-topic-filter" className="text-sm font-medium text-text-secondary">Topic</label>
              <Input
                id="test-topic-filter"
                placeholder="Filter topic"
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="test-college-filter" className="text-sm font-medium text-text-secondary">College</label>
              <select
                id="test-college-filter"
                className="h-10 w-full rounded-lg border border-border px-2"
                value={collegeFilter}
                onChange={(e) => setCollegeFilter(e.target.value)}
              >
                <option value="">All colleges</option>
                {colleges.map((college) => (
                  <option key={college.id} value={college.id}>{college.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="test-department-filter" className="text-sm font-medium text-text-secondary">Department</label>
              <select
                id="test-department-filter"
                className="h-10 w-full rounded-lg border border-border px-2 disabled:cursor-not-allowed disabled:opacity-60"
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                disabled={!collegeFilter || loadingDepartmentFilterOptions}
              >
                <option value="">
                  {!collegeFilter
                    ? "Select college first"
                    : loadingDepartmentFilterOptions
                      ? "Loading departments..."
                      : "All departments"}
                </option>
                {departmentFilterOptions.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="test-status-filter" className="text-sm font-medium text-text-secondary">Status</label>
              <select id="test-status-filter" className="h-10 w-full rounded-lg border border-border px-2" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end xl:col-span-6 xl:justify-end">
              <Button variant="outline" className="w-full xl:w-auto" onClick={resetAllTestFilters}>
                Clear Filters
              </Button>
            </div>
          </div>

          {loadingTests ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
            </div>
          ) : null}

          {!loadingTests && pagedTests.length === 0 ? <p className="text-sm text-text-secondary">No tests found for selected filters.</p> : null}

          {!loadingTests ? (
            <div className="space-y-2">
              {pagedTests.map((test) => {
                const submissionCount = Number(test?._count?.submissions || 0);
                const status = normalizeStatus(test.status);
                // DRAFT allows full editing (incl. questions); SCHEDULED/LIVE allow
                // settings-only edits. COMPLETED/ARCHIVED are immutable.
                const canEditTest = status === "DRAFT" || status === "SCHEDULED" || status === "LIVE";
                const canDeleteTest = status === "DRAFT" && submissionCount === 0;
                const isModuleTest = normalizeAssessmentFormat(test?.assessmentFormat ?? test?.assessment_format) === ASSESSMENT_FORMATS.MODULE_TEST;
                const moduleSectionCount = isModuleTest ? (Array.isArray(test?.modules) ? test.modules.filter((mod) => Number(mod?.durationMins) > 0).length : 0) : 0;

                return (
                  <div key={test.id} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                    <div>
                      <p className="font-medium text-text-primary">
                        {test.title}
                        {isModuleTest ? (
                          <span className="ml-2 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            Module Test{moduleSectionCount > 0 ? ` · ${moduleSectionCount} sections` : ""}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-text-secondary">{test.subject} | {test.college?.name || "-"}</p>
                      <p className="mt-1">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[normalizeStatus(test.status)] || STATUS_TONE.DRAFT}`}>
                          {status}
                        </span>
                      </p>
                      <p className="text-xs text-text-secondary">Questions: {test?._count?.questions || 0} | Attempts: {submissionCount}</p>
                      <p className="text-xs text-text-secondary">
                        AssignedTo (Departments): {getAssignedDepartmentNames(test, departmentNameById).length ? getAssignedDepartmentNames(test, departmentNameById).join(", ") : "-"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenEdit(test.id)}
                        disabled={editingTestId === test.id || !canEditTest}
                      >
                        {editingTestId === test.id
                          ? "Opening..."
                          : status === "DRAFT"
                            ? "Edit Test"
                            : "Edit Settings"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyShareLink(test.id)}
                      >
                        Copy Link
                      </Button>
                      {status === "LIVE" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/super-admin/tests/${test.id}/monitoring`)}
                        >
                          Monitor
                        </Button>
                      ) : null}
                      {canDeleteTest ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDeleteTest(test)}
                          disabled={submitting}
                        >
                          Delete Test
                        </Button>
                      ) : null}
                      {transitionsForStatus(status).map((transition) => (
                        <Button
                          key={`${test.id}-${transition.action}`}
                          size="sm"
                          variant={transition.action === "ARCHIVE" ? "ghost" : "outline"}
                          onClick={() => onTransition(test, transition.action)}
                          disabled={submitting}
                        >
                          {transition.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {filteredTests.length > PAGE_SIZE ? (
            <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
              <p>Page {page} of {totalPages}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}>Next</Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmActionDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title="Confirm Status Transition"
        description={pendingAction?.description || "Please confirm this action."}
        confirmLabel="Confirm"
        onConfirm={confirmPendingAction}
      />
    </div>
  );
}
