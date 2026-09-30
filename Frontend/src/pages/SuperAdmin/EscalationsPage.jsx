import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { superAdminApi } from "@/services/api";
import { CheckCircle2, ShieldAlert, Undo2 } from "lucide-react";
import { EmptyState, Pagination, StatusBadge, TabNav, Th } from "@/components/Reports/components";
import { Button } from "@/components/ui/button";
import { Callout, ErrorState, PageHeader, SearchInput, StatTile } from "@/components/common/page-kit";
import { formatDateLabel } from "@/components/Reports/utils";
import ViolationReviewDialog from "@/components/Reports/ViolationReviewDialog";
import { SUPER_REVIEW_ACTIONS } from "@/components/Reports/reviewActions";
import { SUPER_ESCALATIONS_QUERY_KEY } from "@/hooks/useSuperAdminEscalationsRealtime";

const STATUS_TABS = ["pending", "resolved", "withdrawn", "all"];
const STATUS_LABEL = { pending: "Pending", resolved: "Resolved", withdrawn: "Withdrawn", all: "All" };
const PAGE_SIZE = 20;

const EMPTY_COPY = {
  pending: {
    title: "No escalations waiting",
    description: "When a college admin escalates an anomaly from a report, it appears here for your decision.",
  },
  resolved: { title: "Nothing resolved yet", description: "Escalations you confirm or dismiss are listed here." },
  withdrawn: { title: "No withdrawn escalations", description: "Escalations a college admin later dismissed themselves appear here." },
  all: { title: "No escalations", description: "No anomalies have been escalated by college admins yet." },
};

const formatAnomalyType = (type) => String(type || "anomaly").replace(/_/g, " ").toLowerCase();

const buildEscalationsQuery = ({ status, collegeId, search, page }) => {
  // Built by hand: the shared toQueryString drops "all", but here "all" is a real
  // status (omitting it would fall back to the server default, "pending").
  const params = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE) });
  if (collegeId) params.set("collegeId", collegeId);
  if (search) params.set("search", search);
  return `?${params.toString()}`;
};

function EscalationStatus({ item }) {
  if (item.status === "pending") return <StatusBadge label="Pending" variant="warning" />;
  if (item.status === "withdrawn") return <StatusBadge label="Withdrawn by admin" variant="default" />;
  const confirmed = item.resolution?.action === "CONFIRM";
  return (
    <div className="space-y-1">
      <StatusBadge label={confirmed ? "Confirmed" : "Dismissed"} variant={confirmed ? "danger" : "success"} />
      {item.resolution?.reviewedAt ? <p className="text-[11px] text-text-secondary">{formatDateLabel(item.resolution.reviewedAt)}</p> : null}
    </div>
  );
}

export default function EscalationsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = STATUS_TABS.includes(searchParams.get("status")) ? searchParams.get("status") : "pending";
  const collegeId = searchParams.get("college") || "";
  const search = searchParams.get("q") || "";
  const [searchInput, setSearchInput] = useState(search);
  const [page, setPage] = useState(1);
  const [reviewTarget, setReviewTarget] = useState(null);

  const updateParams = (next) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (!value) params.delete(key);
      else params.set(key, value);
    });
    setSearchParams(params, { replace: true });
  };

  // Debounce the search box into the URL so typing doesn't fire a request per key.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput.trim() !== search) updateParams({ q: searchInput.trim() });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateParams is recreated each render; searchInput/search drive this.
  }, [searchInput, search]);

  useEffect(() => {
    setPage(1);
  }, [status, collegeId, search]);

  const collegesQuery = useQuery({
    queryKey: ["super-escalation-colleges"],
    queryFn: () => superAdminApi.getColleges("?page=1&limit=100"),
    staleTime: 300000,
  });

  const escalationsQuery = useQuery({
    queryKey: [...SUPER_ESCALATIONS_QUERY_KEY, "list", status, collegeId, search, page],
    queryFn: () => superAdminApi.getEscalatedAnomalies(buildEscalationsQuery({ status, collegeId, search, page })),
    placeholderData: (previous) => previous,
    staleTime: 15000,
  });

  const colleges = Array.isArray(collegesQuery.data?.data) ? collegesQuery.data.data : [];
  const items = Array.isArray(escalationsQuery.data?.data) ? escalationsQuery.data.data : [];
  const summary = escalationsQuery.data?.summary || { pending: 0, resolved: 0, withdrawn: 0, total: 0 };
  const pagination = escalationsQuery.data?.pagination || { page: 1, totalPages: 1, total: 0 };

  const tabs = STATUS_TABS.map((key) => ({
    key,
    label: `${STATUS_LABEL[key]} (${(key === "all" ? summary.total : summary[key]) || 0})`,
  }));

  const reviewEvents = reviewTarget
    ? [
        {
          id: reviewTarget.anomalyId,
          type: reviewTarget.violation?.type || reviewTarget.anomalyType,
          anomalyId: reviewTarget.anomalyId,
          anomalyType: reviewTarget.anomalyType,
          testId: reviewTarget.testId,
          testName: reviewTarget.test?.title || "Test",
          createdAt: reviewTarget.violation?.occurredAt || reviewTarget.escalatedAt,
        },
      ]
    : [];

  const handleReview = async (review) => {
    await superAdminApi.reviewReportAnomaly(review);
    toast.success(review.action === "CONFIRM" ? "Anomaly confirmed" : "Anomaly dismissed");
    queryClient.invalidateQueries({ queryKey: SUPER_ESCALATIONS_QUERY_KEY });
  };

  const emptyCopy = EMPTY_COPY[status];
  const isFiltered = Boolean(collegeId || search);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Integrity review"
        title="Escalations"
        description="Anomalies college admins escalated from their reports. Confirm or dismiss each one — your decision is final."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatTile icon={ShieldAlert} label="Pending" value={summary.pending || 0} hint="Awaiting your decision" tone={summary.pending ? "danger" : "neutral"} />
        <StatTile icon={CheckCircle2} label="Resolved" value={summary.resolved || 0} hint="Confirmed or dismissed" tone="success" />
        <StatTile icon={Undo2} label="Withdrawn" value={summary.withdrawn || 0} hint="Dismissed by the admin after escalating" tone="neutral" />
      </div>

      <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="border-b border-border px-4 pt-3 sm:px-5">
          <TabNav tabs={tabs} active={status} onChange={(next) => updateParams({ status: next === "pending" ? "" : next })} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
          <select
            aria-label="College"
            value={collegeId}
            onChange={(event) => updateParams({ college: event.target.value })}
            className="ui-select w-full sm:w-64"
          >
            <option value="">All colleges</option>
            {colleges.map((college) => (
              <option key={college.id} value={college.id}>{college.name}</option>
            ))}
          </select>
          <SearchInput
            className="min-w-0 flex-1 basis-64"
            label="Search escalations"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Test, student, roll no, admin, or reason"
          />
          {escalationsQuery.isFetching && !escalationsQuery.isLoading ? (
            <span className="text-xs text-text-secondary" role="status">Updating…</span>
          ) : null}
        </div>

        {escalationsQuery.data?.truncated ? (
          <Callout tone="warning" className="rounded-none border-x-0 border-t-0 px-4 py-2.5 text-xs sm:px-5">
            Showing the 500 most recent escalations. Filter by college to narrow older ones.
          </Callout>
        ) : null}

        {escalationsQuery.isLoading ? (
          <div className="space-y-2 p-4 sm:p-5" role="status" aria-label="Loading escalations">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
            ))}
          </div>
        ) : escalationsQuery.isError ? (
          <ErrorState
            className="m-4"
            title="Unable to load escalations"
            description="Check your connection and try again."
            onRetry={() => escalationsQuery.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={isFiltered ? "No matching escalations" : emptyCopy.title}
            description={isFiltered ? "Try another college or clear the search." : emptyCopy.description}
          />
        ) : (
          <>
            <div className="relative overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <Th>Escalated</Th>
                    <Th>College</Th>
                    <Th>Test</Th>
                    <Th>Student</Th>
                    <Th>Violation</Th>
                    <Th>Escalated by</Th>
                    <Th>Status</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-t border-border/70 align-top hover:bg-muted/40">
                      <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{formatDateLabel(item.escalatedAt)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary">{item.college?.name || "-"}</p>
                        {item.college?.code ? <p className="text-xs text-text-secondary">{item.college.code}</p> : null}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary">{item.test?.title || "Untitled test"}</p>
                        {item.college?.id ? (
                          <Link
                            to={`/super-admin/reports?college=${item.college.id}&test=${item.testId}`}
                            className="rounded text-xs font-semibold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            Open report
                          </Link>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {item.student ? (
                          <>
                            <p className="font-medium text-text-primary">{item.student.name}</p>
                            <p className="text-xs text-text-secondary">{item.student.rollNo}</p>
                          </>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="capitalize text-text-primary">{formatAnomalyType(item.violation?.type || item.anomalyType)}</p>
                        {item.violation?.occurredAt ? <p className="text-xs text-text-secondary">{formatDateLabel(item.violation.occurredAt)}</p> : null}
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <p className="font-medium text-text-primary">{item.admin?.fullName || "College admin"}</p>
                        {item.reason ? <p className="line-clamp-2 text-xs text-text-secondary" title={item.reason}>“{item.reason}”</p> : null}
                      </td>
                      <td className="px-4 py-3"><EscalationStatus item={item} /></td>
                      <td className="px-4 py-3">
                        {item.status === "withdrawn" ? (
                          <span className="text-xs text-text-secondary">—</span>
                        ) : (
                          <Button
                            type="button"
                            size="lg"
                            variant={item.status === "pending" ? "default" : "outline"}
                            onClick={() => setReviewTarget(item)}
                            className="rounded-lg px-3"
                          >
                            {item.status === "pending" ? "Review" : "Revise"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border/70 p-4">
              <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} />
            </div>
          </>
        )}
      </section>

      <ViolationReviewDialog
        open={Boolean(reviewTarget)}
        onOpenChange={(open) => {
          if (!open) setReviewTarget(null);
        }}
        title={reviewTarget?.status === "resolved" ? "Revise decision" : "Review escalation"}
        studentName={reviewTarget?.student?.name || "Student"}
        events={reviewEvents}
        actions={SUPER_REVIEW_ACTIONS}
        onReview={handleReview}
        note={
          reviewTarget ? (
            <>
              <p>
                <span className="font-semibold">{reviewTarget.admin?.fullName || "A college admin"}</span>
                {reviewTarget.college?.name ? ` (${reviewTarget.college.name})` : ""} escalated this on {formatDateLabel(reviewTarget.escalatedAt)}.
              </p>
              {reviewTarget.reason ? <p className="mt-1 text-text-secondary">“{reviewTarget.reason}”</p> : null}
              {reviewTarget.status === "resolved" && reviewTarget.resolution ? (
                <p className="mt-1 text-text-secondary">
                  Current decision: {reviewTarget.resolution.action === "CONFIRM" ? "confirmed" : "dismissed"}
                  {reviewTarget.resolution.reason ? ` — “${reviewTarget.resolution.reason}”` : ""}
                </p>
              ) : null}
            </>
          ) : null
        }
      />
    </div>
  );
}
