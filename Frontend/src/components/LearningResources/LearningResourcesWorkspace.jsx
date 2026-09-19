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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { adminApi, superAdminApi } from "@/services/api";
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="secondary">{subjects.length} Subjects</Badge>
            <Badge variant="secondary">{pagination?.total ?? visibleResources.length} Resources</Badge>
            {selectedSubject ? <Badge>{selectedSubject.name}</Badge> : null}
          </div>
        </div>
      </div>

      <Tabs defaultValue="resources" className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="resources"><BookOpen className="mr-2 size-4" />Resources</TabsTrigger>
          {canManage ? <TabsTrigger value="upload"><Upload className="mr-2 size-4" />Upload</TabsTrigger> : null}
          {canManage ? <TabsTrigger value="subjects"><Plus className="mr-2 size-4" />Subjects</TabsTrigger> : null}
          {canViewAnalytics ? <TabsTrigger value="analytics"><BarChart3 className="mr-2 size-4" />Analytics</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="resources" className="space-y-4">
          <Card className="rounded-lg border-border">
            <CardContent className="grid gap-3 pt-5 md:grid-cols-[minmax(180px,1fr)_180px_160px_140px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
                <Input
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                  placeholder="Search resources"
                  className="pl-9"
                />
              </div>
              <Select value={filters.subjectId || "all"} onValueChange={(value) => updateFilter("subjectId", value === "all" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Subjects</SelectItem>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>{subject.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filters.resourceType} onValueChange={(value) => updateFilter("resourceType", value)}>
                <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {RESOURCE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={`${filters.sortBy}:${filters.sortDir}`} onValueChange={(value) => {
                const [sortBy, sortDir] = value.split(":");
                setFilters((current) => ({ ...current, sortBy, sortDir, page: 1 }));
              }}>
                <SelectTrigger><SelectValue placeholder="Sort" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt:desc">Newest</SelectItem>
                  <SelectItem value="title:asc">Title</SelectItem>
                  <SelectItem value="downloadCount:desc">Downloads</SelectItem>
                  <SelectItem value="viewCount:desc">Views</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {popular.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {popular.slice(0, 5).map((resource) => (
                <button
                  key={`popular-${resource.id}`}
                  type="button"
                  onClick={() => openResource(resource)}
                  className="min-w-56 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm shadow-sm transition hover:border-primary"
                >
                  <span className="line-clamp-1 font-medium text-text-primary">{resource.title}</span>
                  <span className="mt-1 block text-xs text-text-secondary">{resource.downloadCount || 0} downloads</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-2">
            {loading ? <Card className="rounded-lg border-border"><CardContent className="p-5 text-sm text-text-secondary">Loading resources...</CardContent></Card> : null}
            {!loading && visibleResources.length === 0 ? (
              <Card className="rounded-lg border-border"><CardContent className="p-5 text-sm text-text-secondary">No resources found.</CardContent></Card>
            ) : null}
            {visibleResources.map((resource) => {
              const Icon = getResourceIcon(resource.resourceType);
              return (
                <Card key={resource.id} className="rounded-lg border-border">
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-primary">
                        <Icon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="line-clamp-1 text-base font-semibold text-text-primary">{resource.title}</h2>
                          <Badge variant="outline">{resource.resourceType}</Badge>
                          <Badge variant="secondary">{resource.visibilityScope}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{resource.description || resource.subject?.name || "Resource"}</p>
                      </div>
                    </div>

                    <div className="grid gap-2 text-xs text-text-secondary sm:grid-cols-4">
                      <span>{resource.subject?.name || "Subject"}</span>
                      <span>{formatBytes(resource.fileSize)}</span>
                      <span>{formatDate(resource.createdAt)}</span>
                      <span>{resource.downloadCount || 0} downloads</span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => openResource(resource)}>
                        <Eye className="size-4" /> Details
                      </Button>
                      <Button size="sm" onClick={() => handleDownload(resource)}>
                        <Download className="size-4" /> {FILE_TYPES.has(resource.resourceType) ? "Download" : "Open"}
                      </Button>
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={async () => {
                            try {
                              await dispatch(deleteLearningResource({ role, id: resource.id })).unwrap();
                              toast.success("Resource deleted");
                            } catch (error) {
                              toast.error(error?.message || "Delete failed");
                            }
                          }}
                        >
                          <Trash2 className="size-4" /> Delete
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" disabled={(pagination?.page || 1) <= 1} onClick={() => updateFilter("page", Math.max(1, (pagination?.page || 1) - 1))}>
              Prev
            </Button>
            <span className="text-sm text-text-secondary">Page {pagination?.page || 1}{pagination?.totalPages ? ` / ${pagination.totalPages}` : ""}</span>
            <Button variant="outline" disabled={pagination?.totalPages && pagination.page >= pagination.totalPages} onClick={() => updateFilter("page", (pagination?.page || 1) + 1)}>
              Next
            </Button>
          </div>
        </TabsContent>

        {canManage ? (
          <TabsContent value="upload" className="space-y-4">
            <Card className="rounded-lg border-border">
              <CardHeader><CardTitle>Upload Resource</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Input value={uploadForm.title} onChange={(event) => updateUploadForm("title", event.target.value)} placeholder="Title" />
                  <Select value={uploadForm.subjectId || "none"} onValueChange={(value) => updateUploadForm("subjectId", value === "none" ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select Subject</SelectItem>
                      {subjects.map((subject) => (
                        <SelectItem key={subject.id} value={subject.id}>{subject.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={uploadForm.resourceType} onValueChange={(value) => updateUploadForm("resourceType", value)}>
                    <SelectTrigger><SelectValue placeholder="Resource Type" /></SelectTrigger>
                    <SelectContent>
                      {RESOURCE_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={uploadForm.visibilityScope} onValueChange={(value) => updateUploadForm("visibilityScope", value)}>
                    <SelectTrigger><SelectValue placeholder="Visibility" /></SelectTrigger>
                    <SelectContent>
                      {visibilityOptions.map((scope) => (
                        <SelectItem key={scope} value={scope}>{scope}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Textarea value={uploadForm.description} onChange={(event) => updateUploadForm("description", event.target.value)} placeholder="Description" />

                {isSuper && uploadForm.visibilityScope !== "GLOBAL" ? (
                  <div className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-sm font-medium text-text-primary">Colleges</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {colleges.map((college) => (
                        <label key={college.id} className="flex items-center gap-2 text-sm text-text-secondary">
                          <Checkbox
                            checked={(uploadForm.collegeIds || []).includes(college.id)}
                            onCheckedChange={() => toggleUploadArray("collegeIds", college.id)}
                          />
                          {college.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {FILE_TYPES.has(uploadForm.resourceType) ? (
                  <Input type="file" onChange={(event) => updateUploadForm("file", event.target.files?.[0] || null)} />
                ) : (
                  <Input value={uploadForm.externalUrl} onChange={(event) => updateUploadForm("externalUrl", event.target.value)} placeholder="External URL" />
                )}

                {uploadForm.visibilityScope === "DEPARTMENT" && isDepartmentAdmin ? (
                  <div className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-text-secondary">
                    Resources will be assigned to your department only.
                  </div>
                ) : null}

                {uploadForm.visibilityScope === "DEPARTMENT" && !isDepartmentAdmin && departments.length > 0 ? (
                  <div className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-sm font-medium text-text-primary">Departments</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {departments.map((department) => (
                        <label key={department.id} className="flex items-center gap-2 text-sm text-text-secondary">
                          <Checkbox
                            checked={(uploadForm.departmentIds || []).includes(department.id)}
                            onCheckedChange={() => toggleUploadArray("departmentIds", department.id)}
                          />
                          {department.name}
                          {department.college?.name ? <span className="text-xs text-text-secondary/80">({department.college.name})</span> : null}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                <Input value={uploadForm.tags} onChange={(event) => updateUploadForm("tags", event.target.value)} placeholder="Tags, comma separated" />
                <Button onClick={submitUpload} disabled={uploading}>
                  <Upload className="size-4" /> {uploading ? "Uploading..." : "Upload Resource"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {canManage ? (
          <TabsContent value="subjects" className="space-y-4">
            {canCreateSubject ? (
              <Card className="rounded-lg border-border">
                <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row">
                  <Input value={subjectDraft} onChange={(event) => setSubjectDraft(event.target.value)} placeholder="Subject name" />
                  <Button onClick={submitSubject}><Plus className="size-4" /> Add Subject</Button>
                </CardContent>
              </Card>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {subjects.map((subject) => (
                <Card key={subject.id} className="rounded-lg border-border">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold text-text-primary">{subject.name}</h2>
                        <p className="text-sm text-text-secondary">{subject.resourceCount || 0} resources</p>
                      </div>
                      {subject.isGlobal ? <Badge variant="outline">Global</Badge> : <Badge variant="secondary">College</Badge>}
                    </div>
                    {canDeleteSubject(subject) ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={async () => {
                          try {
                            await dispatch(deleteLearningResourceSubject({ role, id: subject.id })).unwrap();
                            toast.success("Subject deleted");
                          } catch (error) {
                            toast.error(error?.message || "Unable to delete subject");
                          }
                        }}
                      >
                        <Trash2 className="size-4" /> Delete
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        ) : null}

        {canViewAnalytics ? (
          <TabsContent value="analytics" className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Card className="rounded-lg border-border"><CardContent className="p-4"><p className="text-sm text-text-secondary">Resources</p><p className="text-2xl font-semibold">{analyticsSummary.totalResources || 0}</p></CardContent></Card>
              <Card className="rounded-lg border-border"><CardContent className="p-4"><p className="text-sm text-text-secondary">Active</p><p className="text-2xl font-semibold">{analyticsSummary.activeResources || 0}</p></CardContent></Card>
              <Card className="rounded-lg border-border"><CardContent className="p-4"><p className="text-sm text-text-secondary">Views</p><p className="text-2xl font-semibold">{analyticsSummary.totalViews || 0}</p></CardContent></Card>
              <Card className="rounded-lg border-border"><CardContent className="p-4"><p className="text-sm text-text-secondary">Downloads</p><p className="text-2xl font-semibold">{analyticsSummary.totalDownloads || 0}</p></CardContent></Card>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <Card className="rounded-lg border-border">
                <CardHeader><CardTitle>Most Downloaded</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(analytics?.mostDownloaded || []).map((resource) => (
                    <div key={`downloaded-${resource.id}`} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span className="line-clamp-1">{resource.title}</span>
                      <Badge variant="secondary">{resource.downloadCount || 0}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="rounded-lg border-border">
                <CardHeader><CardTitle>Most Viewed</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(analytics?.mostViewed || []).map((resource) => (
                    <div key={`viewed-${resource.id}`} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span className="line-clamp-1">{resource.title}</span>
                      <Badge variant="secondary">{resource.viewCount || 0}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        ) : null}
      </Tabs>

      <Dialog open={Boolean(selectedResource)} onOpenChange={(open) => !open && dispatch(clearSelectedLearningResource({ role }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedResource?.title}</DialogTitle>
          </DialogHeader>
          {selectedResource ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge>{selectedResource.resourceType}</Badge>
                <Badge variant="secondary">{selectedResource.visibilityScope}</Badge>
                <Badge variant="outline">{selectedResource.subject?.name || "Subject"}</Badge>
              </div>
              <p className="text-sm text-text-secondary">{selectedResource.description || "No description"}</p>
              <div className="grid gap-2 text-sm text-text-secondary sm:grid-cols-3">
                <span>{formatBytes(selectedResource.fileSize)}</span>
                <span>{selectedResource.viewCount || 0} views</span>
                <span>{selectedResource.downloadCount || 0} downloads</span>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => handleDownload(selectedResource)}>
                  <Download className="size-4" /> {FILE_TYPES.has(selectedResource.resourceType) ? "Download" : "Open"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
