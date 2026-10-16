import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/api";
import { useSuperAdminAuthState } from "@/hooks/useSuperAdminAuthState";
import usePermission from "@/hooks/usePermission";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Callout, EmptyState, FormField, PageHeader, SectionCard, StatusBadge } from "@/components/common/page-kit";
const SUPER_ADMIN_PERMISSIONS = { MANAGE_PLATFORM: "manage_platform" };


const unwrap = (value) => Array.isArray(value) ? value : (value?.data || []);

export default function PassoutManagementPage() {
  const queryClient = useQueryClient();
  const auth = useSuperAdminAuthState();
  const canManage = usePermission(SUPER_ADMIN_PERMISSIONS.MANAGE_PLATFORM);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [departmentId, setDepartmentId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [reason, setReason] = useState("Verified graduation and institutional passout approval");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [jobId, setJobId] = useState("");

  const departmentsQuery = useQuery({ queryKey: ["passout-departments"], queryFn: superAdminApi.getDepartments });
  const batchesQuery = useQuery({ queryKey: ["passout-batches"], queryFn: superAdminApi.getBatches });
  const eligibleQuery = useQuery({
    queryKey: ["passout-eligible", year, departmentId, batchId],
    queryFn: () => superAdminApi.getPassoutEligible(`?year=${encodeURIComponent(year)}${departmentId ? `&departmentId=${departmentId}` : ""}${batchId ? `&batchId=${batchId}` : ""}`),
    enabled: /^\d{4}$/.test(year),
  });
  const historyQuery = useQuery({ queryKey: ["passout-history"], queryFn: () => superAdminApi.getPassoutHistory("?limit=10") });
  const jobQuery = useQuery({
    queryKey: ["passout-job", jobId],
    queryFn: () => superAdminApi.getPassoutJob(jobId),
    enabled: Boolean(jobId),
    refetchInterval: (query) => ["QUEUED", "PROCESSING"].includes(query.state.data?.status) ? 1500 : false,
  });

  const previewMutation = useMutation({
    mutationFn: () => superAdminApi.previewPassout({ passoutYear: Number(year), departmentId: departmentId || undefined, batchId: batchId || undefined, studentIds: [...selected], scopeType: "INDIVIDUAL" }),
  });
  const promoteMutation = useMutation({
    mutationFn: () => superAdminApi.promotePassout({ passoutYear: Number(year), departmentId: departmentId || undefined, studentIds: [...selected], batchIds: [], scopeType: "INDIVIDUAL", reason, confirmation: true, inProgressAttemptPolicy: "SKIP" }),
    onSuccess: (result) => {
      setConfirmOpen(false);
      setJobId(result.job?.id || "");
      setSelected(new Set());
      toast.success("Passout operation queued");
      queryClient.invalidateQueries({ queryKey: ["passout-eligible"] });
      queryClient.invalidateQueries({ queryKey: ["passout-history"] });
    },
    onError: (error) => toast.error(error?.message || "Unable to queue passout operation"),
  });

  const students = useMemo(() => eligibleQuery.data?.data || [], [eligibleQuery.data]);
  const departments = unwrap(departmentsQuery.data);
  const batches = unwrap(batchesQuery.data).filter((batch) => !batch.isArchived && batch.status !== "ARCHIVED");
  const currentJob = jobQuery.data;
  const selectedCount = selected.size;
  const allSelected = students.length > 0 && students.every((student) => selected.has(student.id));
  const incompleteCount = useMemo(() => students.filter((student) => student.dependencies?.inProgressAttempts > 0).length, [students]);

  if (!canManage && !auth?.superAdmin && !auth?.admin) return <EmptyState title="Passout Management unavailable" description="An authorized administrator account is required." />;

  return (
    <div className="space-y-6">
      <PageHeader title="Passout Management" description="Preview verified March passout eligibility, preserve academic history, and revoke student access safely." />
      <SectionCard title="Eligibility preview" description="Eligibility is based on the stored expected passout year and fixed March policy, never a batch-name guess.">
        <div className="grid gap-4 md:grid-cols-4">
          <FormField label="Passout year" htmlFor="passout-year" required><Input id="passout-year" type="number" min="2000" max="2100" value={year} onChange={(event) => { setYear(event.target.value); setSelected(new Set()); }} /></FormField>
          <FormField label="College"><Input value={auth?.superAdmin?.college?.name || auth?.admin?.college?.name || "Platform"} readOnly /></FormField>
          <FormField label="Department"><select className="ui-select w-full" value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setSelected(new Set()); }}><option value="">All permitted departments</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></FormField>
          <FormField label="Batch"><select className="ui-select w-full" value={batchId} onChange={(event) => { setBatchId(event.target.value); setSelected(new Set()); }}><option value="">All active batches</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></FormField>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3"><StatusBadge tone="info">March (3)</StatusBadge><span className="text-sm text-text-secondary">{eligibleQuery.data?.eligibilityDate ? `Eligibility date: ${new Date(eligibleQuery.data.eligibilityDate).toLocaleDateString()}` : "Choose a year"}</span><span className="text-sm text-text-secondary">{students.length} shown</span>{incompleteCount ? <StatusBadge tone="warning" icon={AlertTriangle}>{incompleteCount} with unfinished attempts</StatusBadge> : null}</div>
        <div className="mt-5 overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/60 text-xs uppercase tracking-wide text-text-secondary"><tr><th className="w-10 p-3"><input type="checkbox" aria-label="Select all eligible students" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(students.map((student) => student.id)))} /></th><th className="p-3">Student</th><th className="p-3">Department</th><th className="p-3">Batch</th><th className="p-3">Academic records</th><th className="p-3">Exceptions</th></tr></thead><tbody>{students.map((student) => <tr key={student.id} className="border-t border-border"><td className="p-3"><input type="checkbox" checked={selected.has(student.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(student.id) ? next.delete(student.id) : next.add(student.id); return next; })} aria-label={`Select ${student.fullName}`} /></td><td className="p-3"><p className="font-medium text-text-primary">{student.fullName}</p><p className="text-xs text-text-secondary">{student.enrollNumber || student.studentId || student.email}</p></td><td className="p-3">{student.department?.name || "-"}</td><td className="p-3">{student.batch?.name || student.batches?.[0]?.name || "-"}</td><td className="p-3">{student.dependencies?.submissions || 0} submissions · {student.dependencies?.answers || 0} answers</td><td className="p-3">{student.dependencies?.inProgressAttempts ? <StatusBadge tone="warning">{student.dependencies.inProgressAttempts} unfinished</StatusBadge> : <StatusBadge tone="success">Clear</StatusBadge>}</td></tr>)}</tbody></table>{!eligibleQuery.isLoading && students.length === 0 ? <EmptyState title="No eligible students" description="No ACTIVE students match the stored passout year and permitted filters." /> : null}</div>
        <div className="mt-5 flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!selectedCount || previewMutation.isPending} onClick={() => previewMutation.mutate()}><ShieldCheck className="size-4" />{previewMutation.isPending ? "Checking…" : `Review ${selectedCount || "selected"}`}</Button><Button disabled={!canManage || !selectedCount} onClick={() => setConfirmOpen(true)}><Archive className="size-4" />Promote selected</Button></div>
        <div className="mt-4 max-w-2xl"><FormField label="Promotion reason" htmlFor="passout-reason" required><Input id="passout-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></FormField></div>
        {previewMutation.data ? <Callout className="mt-4" tone={previewMutation.data.exceptions?.incompleteAttempts?.length ? "warning" : "success"} title="Preview ready">{previewMutation.data.exceptions?.incompleteAttempts?.length || 0} unfinished attempts will be skipped under the current policy. Historical submissions, answers, scores, and references remain preserved.</Callout> : null}
      </SectionCard>

      {currentJob ? <SectionCard title="Current operation" description={`Job ${currentJob.id}`}><div className="flex flex-wrap items-center gap-3"><StatusBadge tone={currentJob.status === "COMPLETED" ? "success" : currentJob.status === "FAILED" ? "danger" : "info"}>{currentJob.status}</StatusBadge><span className="text-sm text-text-secondary">{currentJob.progress?.processed || 0} / {currentJob.progress?.total || 0} processed</span><span className="text-sm text-text-secondary">Success {currentJob.successStudentIds?.length || 0} · Skipped {currentJob.skippedStudentIds?.length || 0} · Failed {currentJob.failedStudentIds?.length || 0}</span></div></SectionCard> : null}

      <SectionCard title="Previous archival operations" description="Retry failed student records without reprocessing successful records."><div className="space-y-3">{(historyQuery.data?.data || []).map((job) => <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="font-medium text-text-primary">{job.passoutYear} · {job.scopeType}</p><p className="text-xs text-text-secondary">{job.createdAt ? new Date(job.createdAt).toLocaleString() : "-"} · {job.successStudentIds?.length || 0} promoted</p></div><div className="flex items-center gap-2"><StatusBadge tone={job.status === "FAILED" ? "danger" : job.status === "COMPLETED" ? "success" : "info"}>{job.status}</StatusBadge>{job.failedStudentIds?.length ? <Button size="sm" variant="outline" onClick={() => superAdminApi.retryPassoutJob(job.id).then((result) => { setJobId(result.job?.id || ""); queryClient.invalidateQueries({ queryKey: ["passout-history"] }); })}><RefreshCw className="size-4" />Retry failed</Button> : null}</div></div>)}{!historyQuery.data?.data?.length ? <p className="text-sm text-text-secondary">No archival operations yet.</p> : null}</div></SectionCard>

      <ConfirmActionDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Confirm passout promotion" description={`Promote ${selectedCount} selected student(s) for passout year ${year}? Their normal student access will be revoked. Historical records will remain available to authorized administrators.`} confirmLabel="Confirm promotion" confirmVariant="default" onConfirm={() => promoteMutation.mutateAsync()} />
    </div>
  );
}
