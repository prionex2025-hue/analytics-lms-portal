import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Activity, Eye, MapPin, Pencil, Plus, Power, School, UserCog } from "lucide-react";
import { createSuperCollege, fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import {
  Callout,
  DataTable,
  DetailList,
  EmptyState,
  ErrorState,
  FormField,
  MiniStat,
  Modal,
  PageHeader,
  SearchInput,
  SectionCard,
  StatusBadge,
} from "@/components/common/page-kit";
import { ui } from "@/styles/ui-tokens";

const emptyOngoingPerformance = {
  liveTestCount: 0,
  totalActiveStudents: 0,
  avgProgress: 0,
  violations: 0,
  tests: [],
  extraLiveTestCount: 0,
};

export default function CollegesPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const colleges = useSelector((state) => state.superAdminPanel.colleges);
  const [form, setForm] = useState({ name: "", code: "", location: "" });
  const [pendingCollege, setPendingCollege] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modalMode, setModalMode] = useState(null);
  const [selectedCollege, setSelectedCollege] = useState(null);
  const [collegeForm, setCollegeForm] = useState({ name: "", code: "", location: "" });
  const [modalLoading, setModalLoading] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);
  const [collegeAdminCandidates, setCollegeAdminCandidates] = useState([]);
  const [selectedCollegeAdminId, setSelectedCollegeAdminId] = useState("");
  const [ongoingPerformance, setOngoingPerformance] = useState(emptyOngoingPerformance);
  const [ongoingPerformanceLoading, setOngoingPerformanceLoading] = useState(false);

  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.resolve(dispatch(fetchSuperColleges())).finally(() => setListLoading(false));
  }, [dispatch]);

  const save = async () => {
    try {
      setError(null);
      const result = await dispatch(createSuperCollege(form));
      if (createSuperCollege.rejected.match(result)) {
        throw result.error;
      }
      setForm({ name: "", code: "", location: "" });
      dispatch(fetchSuperColleges());
    } catch (err) {
      setError(err?.message || "Failed to create college");
    }
  };

  const toggleStatus = async (college, confirmationText) => {
    try {
      setIsLoading(true);
      setError(null);
      await superAdminApi.updateCollege(college.id, {
        isActive: !college.isActive,
        ...(confirmationText ? { confirmationText } : {}),
      });
      await dispatch(fetchSuperColleges());
      setPendingCollege(null);
      return true;
    } catch (err) {
      const errorMsg = err?.response?.data?.message || err?.message || "Failed to update college status";
      setError(errorMsg);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const confirmToggleStatus = async () => {
    if (!pendingCollege?.id) {
      setPendingCollege(null);
      return;
    }

    await toggleStatus(pendingCollege, null);
  };

  const loadCollegeOngoingPerformance = async (collegeId) => {
    const testsPayload = await superAdminApi.getTests(
      `?page=1&limit=20&collegeId=${encodeURIComponent(collegeId)}&status=LIVE`
    );
    const liveTests = Array.isArray(testsPayload?.data) ? testsPayload.data : [];
    const visibleLiveTests = liveTests.slice(0, 5);

    const tests = await Promise.all(
      visibleLiveTests.map(async (test) => {
        try {
          const monitoring = await superAdminApi.getTestMonitoring(test.id);
          const studentRows = Array.isArray(monitoring?.studentTable) ? monitoring.studentTable : [];
          const activeStudents = Number(monitoring?.test?.activeStudents ?? studentRows.length ?? 0);
          const avgProgress = studentRows.length
            ? Math.round(studentRows.reduce((sum, row) => sum + Number(row.progress || 0), 0) / studentRows.length)
            : 0;
          const violations = studentRows.reduce((sum, row) => sum + Number(row.violations || 0), 0);

          return {
            id: test.id,
            title: test.title,
            subject: test.subject,
            activeStudents,
            avgProgress,
            violations,
            monitoringUnavailable: false,
          };
        } catch {
          return {
            id: test.id,
            title: test.title,
            subject: test.subject,
            activeStudents: 0,
            avgProgress: 0,
            violations: 0,
            monitoringUnavailable: true,
          };
        }
      })
    );

    const totalActiveStudents = tests.reduce((sum, test) => sum + Number(test.activeStudents || 0), 0);
    const violations = tests.reduce((sum, test) => sum + Number(test.violations || 0), 0);
    const testsWithProgress = tests.filter((test) => !test.monitoringUnavailable && test.activeStudents > 0);
    const avgProgress = testsWithProgress.length
      ? Math.round(testsWithProgress.reduce((sum, test) => sum + Number(test.avgProgress || 0), 0) / testsWithProgress.length)
      : 0;

    return {
      liveTestCount: liveTests.length,
      totalActiveStudents,
      avgProgress,
      violations,
      tests,
      extraLiveTestCount: Math.max(liveTests.length - tests.length, 0),
    };
  };

  const openCollegeModal = async (college, mode = "view") => {
    if (!college?.id) return;

    setModalMode(mode);
    setSelectedCollege(null);
    setModalLoading(true);
    setOngoingPerformance(emptyOngoingPerformance);
    setOngoingPerformanceLoading(true);

    try {
      setError(null);
      const [details, adminsPayload, performance] = await Promise.all([
        superAdminApi.getCollege(college.id),
        superAdminApi.getAdmins(`?page=1&limit=100&collegeId=${encodeURIComponent(college.id)}&status=active`),
        loadCollegeOngoingPerformance(college.id).catch(() => emptyOngoingPerformance),
      ]);
      const candidates = (adminsPayload?.data || []).filter((admin) => admin.role === "ADMIN" || admin.role === "COLLEGE_ADMIN");
      setSelectedCollege(details);
      setOngoingPerformance(performance || emptyOngoingPerformance);
      setCollegeAdminCandidates(candidates);
      setSelectedCollegeAdminId(details.assignedCollegeAdmin?.id || details.collegeAdminId || "");
      setCollegeForm({
        name: details.name || "",
        code: details.code || "",
        location: details.location || "",
      });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to load college details");
      setModalMode(null);
    } finally {
      setModalLoading(false);
      setOngoingPerformanceLoading(false);
    }
  };

  const closeCollegeModal = () => {
    setModalMode(null);
    setSelectedCollege(null);
    setCollegeForm({ name: "", code: "", location: "" });
    setCollegeAdminCandidates([]);
    setSelectedCollegeAdminId("");
    setOngoingPerformance(emptyOngoingPerformance);
    setOngoingPerformanceLoading(false);
  };

  const openDetailedReview = (collegeId = selectedCollege?.id) => {
    if (!collegeId) return;
    closeCollegeModal();
    navigate(`/super-admin/reports?college=${encodeURIComponent(collegeId)}&mode=overview`);
  };

  const saveCollegeChanges = async () => {
    if (!selectedCollege?.id) return;

    try {
      setModalSaving(true);
      setError(null);
      await superAdminApi.updateCollege(selectedCollege.id, {
        name: collegeForm.name.trim(),
        code: collegeForm.code.trim(),
        location: collegeForm.location.trim(),
      });

      await dispatch(fetchSuperColleges());
      const refreshed = await superAdminApi.getCollege(selectedCollege.id);
      setSelectedCollege(refreshed);
      setCollegeForm({
        name: refreshed.name || "",
        code: refreshed.code || "",
        location: refreshed.location || "",
      });
      setModalMode("view");
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to update college");
    } finally {
      setModalSaving(false);
    }
  };

  const assignCollegeAdmin = async () => {
    if (!selectedCollege?.id) return;

    try {
      setModalSaving(true);
      setError(null);
      await superAdminApi.updateCollege(selectedCollege.id, {
        collegeAdminId: selectedCollegeAdminId || null,
      });

      await dispatch(fetchSuperColleges());
      const refreshed = await superAdminApi.getCollege(selectedCollege.id);
      setSelectedCollege(refreshed);
      setSelectedCollegeAdminId(refreshed.assignedCollegeAdmin?.id || refreshed.collegeAdminId || "");
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to assign college admin");
    } finally {
      setModalSaving(false);
    }
  };

  const selectedStats = selectedCollege?._count || {};
  const getCollegeAdminCount = (college) => (college?.totalAdmins ?? college?._count?.admins ?? 0);
  const getCollegeStudentCount = (college) => (college?._count?.students ?? 0);

  const filteredColleges = useMemo(() => {
    const list = Array.isArray(colleges) ? colleges : [];
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter((college) =>
      `${college.name || ""} ${college.code || ""} ${college.location || ""} ${college.assignedCollegeAdmin?.fullName || ""}`.toLowerCase().includes(query)
    );
  }, [colleges, search]);

  const activeCount = (colleges || []).filter((college) => college.isActive).length;

  const columns = [
    {
      key: "college",
      header: "College",
      primary: true,
      cell: (college) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-text-primary">
            {college.name} <span className="font-mono text-xs font-normal text-text-secondary">{college.code}</span>
          </p>
          <p className="flex items-center gap-1 truncate text-xs text-text-secondary">
            <MapPin className="size-3 shrink-0" aria-hidden="true" />
            {college.location || "No location"}
          </p>
        </div>
      ),
    },
    {
      key: "collegeAdmin",
      header: "College admin",
      cell: (college) =>
        college.assignedCollegeAdmin?.fullName ? (
          <span className="text-text-primary">{college.assignedCollegeAdmin.fullName}</span>
        ) : (
          <span className="text-text-secondary italic">Unassigned</span>
        ),
    },
    { key: "admins", header: "Admins", align: "right", className: "tabular-nums", cell: (college) => getCollegeAdminCount(college) },
    { key: "students", header: "Students", align: "right", className: "tabular-nums", cell: (college) => Number(getCollegeStudentCount(college)).toLocaleString() },
    {
      key: "status",
      header: "Status",
      cell: (college) => <StatusBadge tone={college.isActive ? "success" : "danger"}>{college.isActive ? "Active" : "Inactive"}</StatusBadge>,
    },
    {
      key: "actions",
      actions: true,
      align: "right",
      cell: (college) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button size="lg" variant="outline" className="rounded-lg" onClick={() => openCollegeModal(college, "view")} disabled={modalLoading || isLoading}>
            <Eye className="size-4" />
            View
          </Button>
          <Button size="lg" variant="outline" className="rounded-lg" onClick={() => openCollegeModal(college, "edit")} disabled={modalLoading || isLoading}>
            <Pencil className="size-4" />
            Edit
          </Button>
          <Button
            size="lg"
            variant="ghost"
            onClick={() => setPendingCollege(college)}
            disabled={isLoading}
            className={college.isActive ? "rounded-lg text-danger hover:bg-danger/10 hover:text-danger" : "rounded-lg text-success hover:bg-success/10 hover:text-success"}
          >
            <Power className="size-4" />
            {college.isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colleges"
        description={`${(colleges || []).length} colleges on the platform · ${activeCount} active`}
      />

      {error ? <ErrorState title="Something went wrong" description={error} /> : null}

      <SectionCard title="Add a college" description="New colleges start active. You can assign a college admin afterwards.">
        <form
          className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <FormField label="College name" htmlFor="college-create-name" required>
            <Input id="college-create-name" className={ui.field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="College code" htmlFor="college-create-code" required>
            <Input id="college-create-code" className={ui.field} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </FormField>
          <FormField label="Location" htmlFor="college-create-location">
            <Input id="college-create-location" className={ui.field} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </FormField>
          <Button type="submit" className={ui.btn} disabled={isLoading}>
            <Plus className="size-4" />
            Create College
          </Button>
        </form>
      </SectionCard>

      <SectionCard
        flush
        title="All colleges"
        actions={
          <SearchInput
            className="w-full sm:w-72"
            placeholder="Search name, code, location"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        }
      >
        <DataTable
          columns={columns}
          rows={filteredColleges}
          getRowKey={(college) => college.id}
          loading={listLoading && !(colleges || []).length}
          minWidth={900}
          caption="Colleges"
          rowClassName={(college) => (college.isActive ? "" : "bg-muted/30")}
          empty={
            <EmptyState
              icon={School}
              title={search ? "No colleges match your search" : "No colleges found"}
              description={search ? "Try a different name or code." : "Create the first college using the form above."}
              className="border-0"
            />
          }
        />
      </SectionCard>

      <Modal
        open={Boolean(modalMode)}
        onOpenChange={(open) => {
          if (!open) closeCollegeModal();
        }}
        size="xl"
        title={modalMode === "edit" ? "Edit College" : "College Details"}
        description={selectedCollege ? `${selectedCollege.name} (${selectedCollege.code})` : "Loading college details..."}
        footer={
          selectedCollege ? (
            modalMode === "edit" ? (
              <>
                <Button variant="outline" className={ui.btn} onClick={closeCollegeModal} disabled={modalSaving}>
                  Cancel
                </Button>
                <Button className={ui.btn} onClick={saveCollegeChanges} disabled={modalSaving}>
                  {modalSaving ? "Saving..." : "Save Changes"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" className={ui.btn} onClick={closeCollegeModal}>Close</Button>
                <Button variant="outline" className={ui.btn} onClick={() => openDetailedReview(selectedCollege.id)}>Detailed Review</Button>
                <Button className={ui.btn} onClick={() => setModalMode("edit")}>
                  <Pencil className="size-4" />
                  Edit College
                </Button>
              </>
            )
          ) : null
        }
      >
        {modalLoading && !selectedCollege ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : selectedCollege ? (
          modalMode === "edit" ? (
            <form
              className="grid max-w-xl gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveCollegeChanges();
              }}
            >
              <FormField label="College name" htmlFor="college-edit-name" required>
                <Input id="college-edit-name" className={ui.field} value={collegeForm.name} onChange={(e) => setCollegeForm((prev) => ({ ...prev, name: e.target.value }))} />
              </FormField>
              <FormField label="College code" htmlFor="college-edit-code" required>
                <Input id="college-edit-code" className={ui.field} value={collegeForm.code} onChange={(e) => setCollegeForm((prev) => ({ ...prev, code: e.target.value }))} />
              </FormField>
              <FormField label="Location" htmlFor="college-edit-location">
                <Input id="college-edit-location" className={ui.field} value={collegeForm.location} onChange={(e) => setCollegeForm((prev) => ({ ...prev, location: e.target.value }))} />
              </FormField>
            </form>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
              <div className="min-w-0 space-y-6">
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-text-primary">Overview</h3>
                  <DetailList
                    items={[
                      { label: "College name", value: selectedCollege.name },
                      { label: "College code", value: selectedCollege.code },
                      { label: "Location", value: selectedCollege.location || "—" },
                      {
                        label: "Status",
                        value: <StatusBadge tone={selectedCollege.isActive ? "success" : "danger"}>{selectedCollege.isActive ? "Active" : "Inactive"}</StatusBadge>,
                      },
                    ]}
                  />
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-text-primary">Operational summary</h3>
                  <p className="mt-0.5 text-xs text-text-secondary">Counts returned by the backend college details endpoint.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <MiniStat label="Departments" value={selectedStats.departments || 0} />
                    <MiniStat label="Admins" value={selectedCollege.totalAdmins ?? selectedStats.admins ?? 0} />
                    <MiniStat label="Students" value={selectedStats.students || 0} />
                    <MiniStat label="Tests" value={selectedStats.tests || 0} />
                    <MiniStat label="Batches" value={selectedStats.batches || 0} />
                    <MiniStat label="Question Bank" value={selectedStats.questionBankItems || 0} />
                  </div>
                </section>

                <section className="rounded-lg border border-border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                        <Activity className="size-4 text-primary" aria-hidden="true" />
                        Ongoing test performance
                      </h3>
                      <p className="mt-0.5 text-xs text-text-secondary">Live test activity and monitoring progress for this college.</p>
                    </div>
                    <Button variant="outline" className="h-9 w-full rounded-lg sm:w-auto" onClick={() => openDetailedReview(selectedCollege.id)}>
                      Detailed Review
                    </Button>
                  </div>

                  {ongoingPerformanceLoading ? (
                    <p className="mt-4 text-sm text-text-secondary" role="status">Loading ongoing test performance...</p>
                  ) : (
                    <>
                      <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
                        <MiniStat label="Live Tests" value={ongoingPerformance.liveTestCount} />
                        <MiniStat label="Active Students" value={ongoingPerformance.totalActiveStudents} />
                        <MiniStat label="Avg Progress" value={`${ongoingPerformance.avgProgress}%`} />
                        <MiniStat label="Violations" value={ongoingPerformance.violations} tone={ongoingPerformance.violations > 0 ? "danger" : undefined} />
                      </div>

                      {ongoingPerformance.tests.length ? (
                        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                          {ongoingPerformance.tests.map((test) => (
                            <li key={test.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-text-primary">{test.title || "Untitled Test"}</p>
                                <p className="text-xs text-text-secondary">
                                  {test.subject || "-"}
                                  {test.monitoringUnavailable ? " · Monitoring unavailable" : ""}
                                </p>
                              </div>
                              <dl className="grid grid-cols-3 gap-3 text-center text-xs sm:min-w-60">
                                <div>
                                  <dd className="font-semibold tabular-nums text-text-primary">{test.activeStudents}</dd>
                                  <dt className="text-text-secondary">active</dt>
                                </div>
                                <div>
                                  <dd className="font-semibold tabular-nums text-text-primary">{test.avgProgress}%</dd>
                                  <dt className="text-text-secondary">progress</dt>
                                </div>
                                <div>
                                  <dd className={`font-semibold tabular-nums ${test.violations > 0 ? "text-danger" : "text-text-primary"}`}>{test.violations}</dd>
                                  <dt className="text-text-secondary">violations</dt>
                                </div>
                              </dl>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-4 text-sm text-text-secondary">No live tests are running for this college right now.</p>
                      )}
                      {ongoingPerformance.extraLiveTestCount > 0 ? (
                        <p className="mt-2 text-xs text-text-secondary">
                          + {ongoingPerformance.extraLiveTestCount} more live test(s). Open the detailed review for the full report.
                        </p>
                      ) : null}
                    </>
                  )}
                </section>

                <section className="rounded-lg border border-border p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <UserCog className="size-4 text-primary" aria-hidden="true" />
                    Assigned college admin
                  </h3>
                  <p className="mt-1 text-sm text-text-secondary">
                    {selectedCollege.assignedCollegeAdmin?.fullName
                      ? `${selectedCollege.assignedCollegeAdmin.fullName} (${selectedCollege.assignedCollegeAdmin.email})`
                      : "No college admin assigned"}
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <FormField label="Change assignment" htmlFor="college-admin-assign" className="flex-1">
                      <select
                        id="college-admin-assign"
                        className="ui-select w-full"
                        value={selectedCollegeAdminId}
                        onChange={(event) => setSelectedCollegeAdminId(event.target.value)}
                      >
                        <option value="">Unassign college admin</option>
                        {collegeAdminCandidates.map((admin) => (
                          <option key={admin.id} value={admin.id}>
                            {admin.fullName} ({admin.role === "COLLEGE_ADMIN" ? "College Admin" : "Admin"})
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <Button className={ui.btn} onClick={assignCollegeAdmin} disabled={modalSaving}>
                      {modalSaving ? "Saving..." : "Assign / Update"}
                    </Button>
                  </div>
                  <Callout tone="info" className="mt-3 p-3 text-xs">
                    Assigning an active admin here promotes them to College Admin if needed and deactivates previous active college admin accounts for this college.
                  </Callout>
                </section>
              </div>

              <aside className="min-w-0">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">Record details</h3>
                <DetailList
                  columns={1}
                  items={[
                    { label: "ID", value: <span className="font-mono text-xs">{selectedCollege?.id || selectedCollege?._id || "-"}</span> },
                    { label: "Created", value: selectedCollege.createdAt ? new Date(selectedCollege.createdAt).toLocaleString() : "-" },
                    { label: "Updated", value: selectedCollege.updatedAt ? new Date(selectedCollege.updatedAt).toLocaleString() : "-" },
                    { label: "Deleted", value: selectedCollege.deletedAt ? new Date(selectedCollege.deletedAt).toLocaleString() : "-" },
                  ]}
                />
              </aside>
            </div>
          )
        ) : null}
      </Modal>

      <ConfirmActionDialog
        open={Boolean(pendingCollege && !pendingCollege.isActive)}
        onOpenChange={(open) => !open && setPendingCollege(null)}
        title="Activate College"
        description={`Activate ${pendingCollege?.name || "this college"}? Its admins and students will be able to access the platform.`}
        confirmLabel="Activate"
        confirmVariant="default"
        onConfirm={confirmToggleStatus}
      />

      <TypedConfirmDialog
        open={Boolean(pendingCollege && pendingCollege.isActive)}
        onOpenChange={(open) => !open && setPendingCollege(null)}
        title="Deactivate College"
        description={`Deactivating ${pendingCollege?.name || "this college"} will restrict admin and student access to the platform.`}
        expectedText={`SUSPEND ${pendingCollege?.code || pendingCollege?.id || ""}`}
        inputLabel="Type the phrase to confirm"
        confirmLabel="Deactivate College"
        confirmVariant="destructive"
        onConfirm={async (typedText) => {
          if (pendingCollege) {
            await toggleStatus(pendingCollege, typedText);
          }
        }}
      />
    </div>
  );
}
