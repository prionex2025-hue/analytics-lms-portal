import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";
import {
  BarChart3,
  BookOpen,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileImage,
  FileText,
  LinkIcon,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { adminApi, superAdminApi } from "@/services/api";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { DetailList, EmptyState, FormField, Modal, PageHeader, PaginationBar, SearchInput, SectionCard, StatTile, StatusBadge } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";
import {
  clearSelectedLearningResource,
  createLearningResourceSubject,
  deleteLearningResource,
  deleteLearningResourceSubject,
  downloadLearningResource,
  fetchLearningResource,
  fetchLearningResourceAnalytics,
  fetchLearningResourceSubjects,
  fetchLearningResources,
  fetchPopularLearningResources,
  uploadLearningResource,
} from "@/features/LearningResources/learningResourcesSlice";

const RESOURCE_TYPES = [
  { value: "PDF", label: "PDF", icon: FileText },
  { value: "DOCX", label: "DOCX", icon: FileText },
  { value: "PPTX", label: "PPTX", icon: FileText },
  { value: "ZIP", label: "ZIP", icon: FileArchive },
  { value: "IMAGE", label: "Image", icon: FileImage },
  { value: "LINK", label: "Link", icon: LinkIcon },
  { value: "YOUTUBE_URL", label: "YouTube", icon: ExternalLink },
  { value: "GOOGLE_DRIVE_URL", label: "Google Drive", icon: ExternalLink },
];

const FILE_TYPES = new Set(["PDF", "DOCX", "PPTX", "ZIP", "IMAGE"]);

const emptyUploadForm = {
  title: "",
  description: "",
  subjectId: "",
  resourceType: "PDF",
  visibilityScope: "COLLEGE",
  collegeId: "",
  collegeIds: [],
  externalUrl: "",
  departmentIds: [],
  tags: "",
  file: null,
};

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const formatDate = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

const downloadBrowserPayload = (payload, fallbackName) => {
  if (payload?.kind === "json" && payload.data?.redirectUrl) {
    window.open(payload.data.redirectUrl, "_blank", "noopener,noreferrer");
    return;
  }

  if (payload?.kind !== "blob" || !payload.blob) {
    return;
  }

  const url = URL.createObjectURL(payload.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = payload.fileName || fallbackName || "resource";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const getResourceIcon = (resourceType) => {
  const match = RESOURCE_TYPES.find((item) => item.value === resourceType);
  return match?.icon || FileText;
};

const toQueryFilters = (filters, page, limit) => ({
  ...filters,
  page,
  limit,
});

export default function LearningResourcesWorkspace({
  role = "student",
  title = "Learning Resources",
  canManage = false,
  canViewAnalytics = false,
}) {
  const dispatch = useDispatch();
  const roleState = useSelector((state) => state.learningResources?.[role]);
  const admin = useAdminAuthState()?.admin;
  const { subjects = [], resources = [], popular = [], analytics, pagination, loading, uploading, selectedResource } = roleState || {};
  const [pendingDelete, setPendingDelete] = useState(null);
  const [filters, setFilters] = useState({
    q: "",
    subjectId: "",
    resourceType: "all",
    sortBy: "createdAt",
    sortDir: "desc",
    page: 1,
    limit: 20,
  });
  const [uploadForm, setUploadForm] = useState(emptyUploadForm);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [departments, setDepartments] = useState([]);
  const [colleges, setColleges] = useState([]);

  const isSuper = role === "super";
  const adminRole = String(admin?.role || "").toUpperCase();
  const isDepartmentAdmin = role === "admin" && adminRole === "ADMIN";
  const isCollegeAdmin = role === "admin" && adminRole === "COLLEGE_ADMIN";
  const canCreateSubject = isSuper || (role === "admin" && (adminRole === "COLLEGE_ADMIN" || adminRole === "ADMIN"));

  const visibilityOptions = useMemo(() => {
    if (isSuper) {
      return ["GLOBAL", "COLLEGE", "DEPARTMENT"];
    }
    if (isDepartmentAdmin) {
      return ["DEPARTMENT"];
    }
    return ["COLLEGE", "DEPARTMENT"];
  }, [isDepartmentAdmin, isSuper]);

  useEffect(() => {
    dispatch(fetchLearningResourceSubjects({ role }));
    dispatch(fetchPopularLearningResources({ role }));
  }, [dispatch, role]);

  useEffect(() => {
    dispatch(fetchLearningResources({ role, filters: toQueryFilters(filters, filters.page, filters.limit) }));
  }, [dispatch, role, filters]);

  useEffect(() => {
    if (!canViewAnalytics) return;
    dispatch(fetchLearningResourceAnalytics({ role }));
  }, [canViewAnalytics, dispatch, role]);

  useEffect(() => {
    if (!canManage) return;

    if (isSuper) {
      superAdminApi.getColleges("?limit=100")
        .then((payload) => setColleges(payload?.data || []))
        .catch(() => setColleges([]));
      return;
    }

    adminApi.getDepartments().then((departmentPayload) => {
      setDepartments(Array.isArray(departmentPayload) ? departmentPayload : departmentPayload?.data || []);
    }).catch(() => setDepartments([]));
  }, [canManage, isSuper]);

  useEffect(() => {
    if (!canManage || !isSuper || uploadForm.visibilityScope === "GLOBAL" || uploadForm.collegeIds.length === 0) {
      if (isSuper) {
        setDepartments([]);
      }
      return;
    }

    Promise.all(
      uploadForm.collegeIds.map((collegeId) =>
        superAdminApi.getDepartments(`?limit=100&collegeId=${collegeId}`).catch(() => ({ data: [] }))
      )
    ).then((payloads) => {
      const merged = payloads.flatMap((payload) => (Array.isArray(payload) ? payload : payload?.data || []));
      setDepartments(Array.from(new Map(merged.map((department) => [department.id, department])).values()));
    });
  }, [canManage, isSuper, uploadForm.collegeIds, uploadForm.visibilityScope]);

  useEffect(() => {
    setUploadForm((current) => ({
      ...current,
      visibilityScope: visibilityOptions.includes(current.visibilityScope) ? current.visibilityScope : visibilityOptions[0],
      collegeIds: visibilityOptions.includes(current.visibilityScope) ? current.collegeIds : [],
      departmentIds: visibilityOptions.includes(current.visibilityScope) ? current.departmentIds : [],
    }));
  }, [visibilityOptions]);

  const selectedSubject = subjects.find((subject) => subject.id === filters.subjectId);
  const visibleResources = Array.isArray(resources) ? resources : [];

  const updateFilter = (key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? value : 1,
    }));
  };

  const updateUploadForm = (key, value) => {
    setUploadForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "visibilityScope" ? { collegeIds: [], departmentIds: [] } : {}),
    }));
  };

  const toggleUploadArray = (key, id) => {
    setUploadForm((current) => {
      const values = new Set(current[key] || []);
      if (values.has(id)) {
        values.delete(id);
      } else {
        values.add(id);
      }
      return {
        ...current,
        [key]: [...values],
      };
    });
  };

  const buildUploadBody = ({ collegeId = "", departmentIds = [] } = {}) => {
    const body = new FormData();
    body.set("title", uploadForm.title.trim());
    body.set("description", uploadForm.description.trim());
    body.set("subjectId", uploadForm.subjectId);
    body.set("resourceType", uploadForm.resourceType);
    body.set("visibilityScope", uploadForm.visibilityScope);
    body.set("tags", uploadForm.tags);
    if (collegeId) body.set("collegeId", collegeId);
    if (uploadForm.externalUrl) body.set("externalUrl", uploadForm.externalUrl);
    body.set("departmentIds", JSON.stringify(departmentIds));
    if (FILE_TYPES.has(uploadForm.resourceType) && uploadForm.file) {
      body.set("file", uploadForm.file);
    }
    return body;
  };

  const selectedDepartmentGroups = () => {
    const selected = departments.filter((department) => (uploadForm.departmentIds || []).includes(department.id));
    return selected.reduce((groups, department) => {
      const collegeId = department.collegeId || department.college?.id || uploadForm.collegeId;
      if (!collegeId) return groups;
      groups[collegeId] = [...(groups[collegeId] || []), department.id];
      return groups;
    }, {});
  };

  const submitUpload = async () => {
    if (!uploadForm.title.trim() || !uploadForm.subjectId) {
      toast.error("Title and subject are required");
      return;
    }

    if (FILE_TYPES.has(uploadForm.resourceType) && !uploadForm.file) {
      toast.error("Choose a file to upload");
      return;
    }

    if (!FILE_TYPES.has(uploadForm.resourceType) && !uploadForm.externalUrl.trim()) {
      toast.error("External URL is required");
      return;
    }

    try {
      if (isDepartmentAdmin) {
        await dispatch(uploadLearningResource({
          role,
          payload: buildUploadBody({ departmentIds: [admin?.departmentId].filter(Boolean) }),
        })).unwrap();
      } else if (isSuper && uploadForm.visibilityScope === "COLLEGE") {
        if (!uploadForm.collegeIds.length) {
          toast.error("Select at least one college");
          return;
        }
        await Promise.all(uploadForm.collegeIds.map((collegeId) =>
          dispatch(uploadLearningResource({ role, payload: buildUploadBody({ collegeId }) })).unwrap()
        ));
      } else if (isSuper && uploadForm.visibilityScope === "DEPARTMENT") {
        const groups = selectedDepartmentGroups();
        const entries = Object.entries(groups);
        if (entries.length === 0) {
          toast.error("Select at least one department");
          return;
        }
        await Promise.all(entries.map(([collegeId, departmentIds]) =>
          dispatch(uploadLearningResource({ role, payload: buildUploadBody({ collegeId, departmentIds }) })).unwrap()
        ));
      } else if (isCollegeAdmin && uploadForm.visibilityScope === "DEPARTMENT") {
        if (!uploadForm.departmentIds.length) {
          toast.error("Select at least one department");
          return;
        }
        await dispatch(uploadLearningResource({
          role,
          payload: buildUploadBody({ departmentIds: uploadForm.departmentIds }),
        })).unwrap();
      } else {
        await dispatch(uploadLearningResource({ role, payload: buildUploadBody() })).unwrap();
      }
      toast.success("Resource uploaded");
      setUploadForm({
        ...emptyUploadForm,
        visibilityScope: visibilityOptions[0],
      });
      dispatch(fetchLearningResourceSubjects({ role }));
      dispatch(fetchLearningResources({ role, filters }));
    } catch (error) {
      toast.error(error?.message || "Upload failed");
    }
  };

  const submitSubject = async () => {
    const name = subjectDraft.trim();
    if (!name) return;

    try {
      await dispatch(createLearningResourceSubject({ role, payload: { name } })).unwrap();
      setSubjectDraft("");
      toast.success("Subject created");
    } catch (error) {
      toast.error(error?.message || "Unable to create subject");
    }
  };

  const handleDownload = async (resource) => {
    try {
      const payload = await dispatch(downloadLearningResource({ role, id: resource.id })).unwrap();
      downloadBrowserPayload(payload.data, resource.originalFileName || resource.title);
    } catch (error) {
      toast.error(error?.message || "Download failed");
    }
  };

  const openResource = async (resource) => {
    try {
      await dispatch(fetchLearningResource({ role, id: resource.id })).unwrap();
    } catch (error) {
      toast.error(error?.message || "Unable to open resource");
    }
  };

  const analyticsSummary = analytics?.summary || {};
  const canDeleteSubject = (subject) => canCreateSubject && (isSuper ? subject.isGlobal : !subject.isGlobal);

  const totalResources = pagination?.total ?? visibleResources.length;
  const lineTab =
    "flex-none rounded-none px-0.5 pt-1 pb-3 text-text-secondary data-active:text-primary after:!bottom-[-1px] after:!bg-primary";

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={`${subjects.length} subject${subjects.length === 1 ? "" : "s"} · ${totalResources} resource${totalResources === 1 ? "" : "s"}${selectedSubject ? ` · Filtered to ${selectedSubject.name}` : ""}`}
      />

      <Tabs defaultValue="resources" className="gap-5">
        <div className="relative -mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">
          <TabsList variant="line" className="h-auto! w-full min-w-max justify-start gap-6 rounded-none border-b border-border p-0">
            <TabsTrigger value="resources" className={lineTab}><BookOpen className="size-4" />Resources</TabsTrigger>
            {canManage ? <TabsTrigger value="upload" className={lineTab}><Upload className="size-4" />Upload</TabsTrigger> : null}
            {canManage ? <TabsTrigger value="subjects" className={lineTab}><Plus className="size-4" />Subjects</TabsTrigger> : null}
            {canViewAnalytics ? <TabsTrigger value="analytics" className={lineTab}><BarChart3 className="size-4" />Analytics</TabsTrigger> : null}
          </TabsList>
        </div>

        <TabsContent value="resources" className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
            <SearchInput
              className="sm:col-span-2 lg:col-span-1"
              label="Search resources"
              value={filters.q}
              onChange={(event) => updateFilter("q", event.target.value)}
              placeholder="Search resources"
            />
            <select aria-label="Subject" className="ui-select w-full" value={filters.subjectId || "all"} onChange={(event) => updateFilter("subjectId", event.target.value === "all" ? "" : event.target.value)}>
              <option value="all">All Subjects</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
            <select aria-label="Type" className="ui-select w-full" value={filters.resourceType} onChange={(event) => updateFilter("resourceType", event.target.value)}>
              <option value="all">All Types</option>
              {RESOURCE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
            <select
              aria-label="Sort"
              className="ui-select w-full"
              value={`${filters.sortBy}:${filters.sortDir}`}
              onChange={(event) => {
                const [sortBy, sortDir] = event.target.value.split(":");
                setFilters((current) => ({ ...current, sortBy, sortDir, page: 1 }));
              }}
            >
              <option value="createdAt:desc">Newest</option>
              <option value="title:asc">Title</option>
              <option value="downloadCount:desc">Downloads</option>
              <option value="viewCount:desc">Views</option>
            </select>
          </div>

          {popular.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium text-text-secondary">Popular right now</p>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                {popular.slice(0, 5).map((resource) => (
                  <button
                    key={`popular-${resource.id}`}
                    type="button"
                    onClick={() => openResource(resource)}
                    className="min-w-56 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm shadow-xs outline-none transition-colors hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="line-clamp-1 font-medium text-text-primary">{resource.title}</span>
                    <span className="mt-0.5 block text-xs text-text-secondary">{resource.downloadCount || 0} downloads</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="grid gap-3 xl:grid-cols-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <SkeletonBlock key={index} className="h-40" />
              ))}
            </div>
          ) : visibleResources.length === 0 ? (
            <EmptyState icon={BookOpen} title="No resources found" description="Try a different subject, type, or search term." />
          ) : (
            <ul className="grid gap-3 xl:grid-cols-2">
              {visibleResources.map((resource) => {
                const Icon = getResourceIcon(resource.resourceType);
                return (
                  <li key={resource.id} className={cn(ui.cardInteractive, "flex flex-col p-4")}>
                    <div className="flex items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="line-clamp-1 text-base font-semibold text-text-primary">{resource.title}</h2>
                        <p className="mt-0.5 line-clamp-2 text-sm text-text-secondary">{resource.description || resource.subject?.name || "Resource"}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <StatusBadge tone="info">{resource.resourceType}</StatusBadge>
                          <StatusBadge tone="neutral">{resource.visibilityScope}</StatusBadge>
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 text-xs text-text-secondary">
                      {[resource.subject?.name || "Subject", formatBytes(resource.fileSize), formatDate(resource.createdAt), `${resource.downloadCount || 0} downloads`]
                        .filter((part) => part && part !== "-")
                        .join(" · ")}
                    </p>

                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      <Button className="h-9 rounded-lg" onClick={() => handleDownload(resource)}>
                        <Download className="size-4" /> {FILE_TYPES.has(resource.resourceType) ? "Download" : "Open"}
                      </Button>
                      <Button variant="outline" className="h-9 rounded-lg" onClick={() => openResource(resource)}>
                        <Eye className="size-4" /> Details
                      </Button>
                      {canManage ? (
                        <Button
                          variant="ghost"
                          className="ml-auto h-9 rounded-lg text-danger hover:bg-danger/10 hover:text-danger"
                          onClick={() => setPendingDelete({ kind: "resource", target: resource })}
                        >
                          <Trash2 className="size-4" /> Delete
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {(pagination?.totalPages || 1) > 1 ? (
            <PaginationBar
              page={pagination?.page || 1}
              pages={pagination?.totalPages || 1}
              total={pagination?.total}
              disabled={loading}
              onPageChange={(next) => updateFilter("page", Math.max(1, next))}
            />
          ) : null}
        </TabsContent>

        {canManage ? (
          <TabsContent value="upload">
            <SectionCard title="Upload resource" description="Share a file or link with the colleges and departments you choose.">
              <form
                className="max-w-3xl space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitUpload();
                }}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField label="Title" htmlFor="lr-title" required>
                    <Input id="lr-title" className={ui.field} value={uploadForm.title} onChange={(event) => updateUploadForm("title", event.target.value)} />
                  </FormField>
                  <FormField label="Subject" htmlFor="lr-subject" required>
                    <select id="lr-subject" className="ui-select w-full" value={uploadForm.subjectId || ""} onChange={(event) => updateUploadForm("subjectId", event.target.value)}>
                      <option value="">Select Subject</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>{subject.name}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Resource type" htmlFor="lr-type">
                    <select id="lr-type" className="ui-select w-full" value={uploadForm.resourceType} onChange={(event) => updateUploadForm("resourceType", event.target.value)}>
                      {RESOURCE_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Visibility" htmlFor="lr-visibility">
                    <select id="lr-visibility" className="ui-select w-full" value={uploadForm.visibilityScope} onChange={(event) => updateUploadForm("visibilityScope", event.target.value)}>
                      {visibilityOptions.map((scope) => (
                        <option key={scope} value={scope}>{scope}</option>
                      ))}
                    </select>
                  </FormField>
                </div>

                <FormField label="Description" htmlFor="lr-description">
                  <Textarea id="lr-description" className="rounded-lg" value={uploadForm.description} onChange={(event) => updateUploadForm("description", event.target.value)} />
                </FormField>

                {isSuper && uploadForm.visibilityScope !== "GLOBAL" ? (
                  <fieldset className="rounded-lg border border-border p-3">
                    <legend className="px-1 text-sm font-medium text-text-primary">Colleges</legend>
                    <div className="grid gap-2 md:grid-cols-2">
                      {colleges.map((college) => (
                        <label key={college.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-sm text-text-primary hover:bg-muted/40">
                          <Checkbox checked={(uploadForm.collegeIds || []).includes(college.id)} onCheckedChange={() => toggleUploadArray("collegeIds", college.id)} />
                          {college.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}

                {FILE_TYPES.has(uploadForm.resourceType) ? (
                  <FormField label="File" htmlFor="lr-file" required>
                    <Input id="lr-file" type="file" className="h-10 rounded-lg" onChange={(event) => updateUploadForm("file", event.target.files?.[0] || null)} />
                  </FormField>
                ) : (
                  <FormField label="External URL" htmlFor="lr-url" required>
                    <Input id="lr-url" type="url" placeholder="https://" className={ui.field} value={uploadForm.externalUrl} onChange={(event) => updateUploadForm("externalUrl", event.target.value)} />
                  </FormField>
                )}

                {uploadForm.visibilityScope === "DEPARTMENT" && isDepartmentAdmin ? (
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-text-secondary">Resources will be assigned to your department only.</p>
                ) : null}

                {uploadForm.visibilityScope === "DEPARTMENT" && !isDepartmentAdmin && departments.length > 0 ? (
                  <fieldset className="rounded-lg border border-border p-3">
                    <legend className="px-1 text-sm font-medium text-text-primary">Departments</legend>
                    <div className="grid gap-2 md:grid-cols-2">
                      {departments.map((department) => (
                        <label key={department.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-sm text-text-primary hover:bg-muted/40">
                          <Checkbox
                            checked={(uploadForm.departmentIds || []).includes(department.id)}
                            onCheckedChange={() => toggleUploadArray("departmentIds", department.id)}
                          />
                          {department.name}
                          {department.college?.name ? <span className="text-xs text-text-secondary">({department.college.name})</span> : null}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}

                <FormField label="Tags" htmlFor="lr-tags" hint="Comma separated">
                  <Input id="lr-tags" className={ui.field} value={uploadForm.tags} onChange={(event) => updateUploadForm("tags", event.target.value)} />
                </FormField>
                <Button type="submit" className={ui.btn} disabled={uploading}>
                  <Upload className="size-4" /> {uploading ? "Uploading..." : "Upload Resource"}
                </Button>
              </form>
            </SectionCard>
          </TabsContent>
        ) : null}

        {canManage ? (
          <TabsContent value="subjects" className="space-y-4">
            {canCreateSubject ? (
              <SectionCard>
                <form
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitSubject();
                  }}
                >
                  <FormField label="New subject" htmlFor="lr-subject-name" className="flex-1">
                    <Input id="lr-subject-name" className={ui.field} value={subjectDraft} onChange={(event) => setSubjectDraft(event.target.value)} />
                  </FormField>
                  <Button type="submit" className={ui.btn} disabled={!String(subjectDraft || "").trim()}>
                    <Plus className="size-4" /> Add Subject
                  </Button>
                </form>
              </SectionCard>
            ) : null}
            {subjects.length === 0 ? (
              <EmptyState icon={BookOpen} title="No subjects yet" description="Subjects group related resources together." />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {subjects.map((subject) => (
                  <li key={subject.id} className={cn(ui.card, "flex items-start justify-between gap-3 p-4")}>
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-text-primary">{subject.name}</h2>
                      <p className="text-sm text-text-secondary">{subject.resourceCount || 0} resources</p>
                      <StatusBadge tone={subject.isGlobal ? "info" : "neutral"} className="mt-2">{subject.isGlobal ? "Global" : "College"}</StatusBadge>
                    </div>
                    {canDeleteSubject(subject) ? (
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="shrink-0 rounded-lg text-danger hover:bg-danger/10 hover:text-danger"
                        onClick={() => setPendingDelete({ kind: "subject", target: subject })}
                        title="Delete subject"
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Delete subject {subject.name}</span>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        ) : null}

        {canViewAnalytics ? (
          <TabsContent value="analytics" className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile icon={BookOpen} label="Resources" value={analyticsSummary.totalResources || 0} />
              <StatTile icon={BookOpen} label="Active" value={analyticsSummary.activeResources || 0} tone="success" />
              <StatTile icon={Eye} label="Views" value={analyticsSummary.totalViews || 0} tone="neutral" />
              <StatTile icon={Download} label="Downloads" value={analyticsSummary.totalDownloads || 0} tone="neutral" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {[
                { title: "Most downloaded", rows: analytics?.mostDownloaded || [], value: (r) => r.downloadCount || 0, key: "downloaded" },
                { title: "Most viewed", rows: analytics?.mostViewed || [], value: (r) => r.viewCount || 0, key: "viewed" },
              ].map((block) => (
                <SectionCard key={block.key} title={block.title} flush>
                  {block.rows.length === 0 ? (
                    <p className="p-5 text-center text-sm text-text-secondary">No activity yet.</p>
                  ) : (
                    <ol className="divide-y divide-border">
                      {block.rows.map((resource, index) => (
                        <li key={`${block.key}-${resource.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                          <span className="w-5 text-xs tabular-nums text-text-secondary">{index + 1}</span>
                          <span className="line-clamp-1 flex-1 text-text-primary">{resource.title}</span>
                          <span className="font-semibold tabular-nums text-text-primary">{block.value(resource)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </SectionCard>
              ))}
            </div>
          </TabsContent>
        ) : null}
      </Tabs>

      <Modal
        open={Boolean(selectedResource)}
        onOpenChange={(open) => !open && dispatch(clearSelectedLearningResource({ role }))}
        size="lg"
        title={selectedResource?.title || "Resource"}
        footer={
          selectedResource ? (
            <Button className={ui.btn} onClick={() => handleDownload(selectedResource)}>
              <Download className="size-4" /> {FILE_TYPES.has(selectedResource.resourceType) ? "Download" : "Open"}
            </Button>
          ) : null
        }
      >
        {selectedResource ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge tone="info">{selectedResource.resourceType}</StatusBadge>
              <StatusBadge tone="neutral">{selectedResource.visibilityScope}</StatusBadge>
              <StatusBadge tone="neutral">{selectedResource.subject?.name || "Subject"}</StatusBadge>
            </div>
            <p className="text-sm leading-6 text-text-secondary">{selectedResource.description || "No description"}</p>
            <DetailList
              columns={3}
              items={[
                { label: "Size", value: formatBytes(selectedResource.fileSize) },
                { label: "Views", value: selectedResource.viewCount || 0 },
                { label: "Downloads", value: selectedResource.downloadCount || 0 },
              ]}
            />
          </div>
        ) : null}
      </Modal>

      <ConfirmActionDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={pendingDelete?.kind === "subject" ? "Delete subject" : "Delete resource"}
        description={`Delete “${pendingDelete?.target?.title || pendingDelete?.target?.name || "this item"}”? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async () => {
          const current = pendingDelete;
          setPendingDelete(null);
          if (!current?.target?.id) return;
          try {
            if (current.kind === "subject") {
              await dispatch(deleteLearningResourceSubject({ role, id: current.target.id })).unwrap();
              toast.success("Subject deleted");
            } else {
              await dispatch(deleteLearningResource({ role, id: current.target.id })).unwrap();
              toast.success("Resource deleted");
            }
          } catch (error) {
            toast.error(error?.message || (current.kind === "subject" ? "Unable to delete subject" : "Delete failed"));
          }
        }}
      />
    </div>
  );
}
