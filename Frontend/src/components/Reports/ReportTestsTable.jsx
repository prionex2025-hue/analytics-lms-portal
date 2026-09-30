import { EmptyState, Pagination, ScoreBadge, SectionCard, StatusBadge, Th, ViolationBadge } from "@/components/Reports/components";
import { formatDateLabel, formatPercent } from "@/components/Reports/utils";

const TEST_STATUS_VARIANT = {
  LIVE: "info",
  COMPLETED: "success",
  SCHEDULED: "warning",
  DRAFT: "default",
  ARCHIVED: "default",
};

const TEST_SORT_OPTIONS = [
  { value: "startsAt", label: "Most recent" },
  { value: "avgScore", label: "Avg score" },
  { value: "participation", label: "Participation" },
  { value: "passRate", label: "Pass rate" },
  { value: "violations", label: "Violations" },
];

const toNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

/**
 * Per-test results list shared by the admin-level report pages. Controlled: the
 * page owns the query and the search/status/sort/page state.
 */
export default function ReportTestsTable({
  query,
  scopeLabel,
  search,
  onSearchChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
  onPageChange,
  onOpenTest,
}) {
  const tests = Array.isArray(query?.data?.data) ? query.data.data : [];
  const pagination = query?.data?.pagination || { page: 1, totalPages: 1, total: 0 };

  return (
    <SectionCard
      title="Tests"
      subtitle={scopeLabel}
      bodyClassName="p-0"
      right={
        <>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search tests…"
            aria-label="Search tests"
            className="h-9 w-full basis-full rounded-lg border border-border bg-background px-3 text-sm sm:w-48 sm:basis-auto"
          />
          <select
            value={status}
            onChange={(event) => onStatusChange(event.target.value)}
            aria-label="Filter by status"
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-text-primary"
          >
            <option value="all">All statuses</option>
            <option value="LIVE">Live</option>
            <option value="COMPLETED">Completed</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="DRAFT">Draft</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
            aria-label="Sort tests"
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-text-primary"
          >
            {TEST_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </>
      }
    >
      {query?.isLoading ? (
        <div className="p-6 text-sm text-text-secondary">Loading tests…</div>
      ) : query?.isError ? (
        <div className="m-4 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">Unable to load tests.</div>
      ) : tests.length === 0 ? (
        <EmptyState title="No tests found" description="Adjust your search or filters to see test performance." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <Th>Test</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                  <Th>Submissions</Th>
                  <Th>Avg score</Th>
                  <Th>Pass rate</Th>
                  <Th>Violations</Th>
                  <Th><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {tests.map((test) => (
                  <tr key={test.testId} className="border-t border-border/70 hover:bg-muted/40">
                    <td className="min-w-[14rem] px-4 py-3">
                      <p className="font-medium text-text-primary">{test.title || "Untitled test"}</p>
                      <p className="text-xs text-text-secondary">{test.department || "-"} · {test.batch || "-"}</p>
                    </td>
                    <td className="px-4 py-3"><StatusBadge label={test.status || "-"} variant={TEST_STATUS_VARIANT[test.status] || "default"} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{test.startsAt ? formatDateLabel(test.startsAt) : "-"}</td>
                    <td className="px-4 py-3 tabular-nums">{toNumber(test.submissionCount)}</td>
                    <td className="px-4 py-3"><ScoreBadge score={test.avgScore} /></td>
                    <td className="px-4 py-3 tabular-nums">{formatPercent(test.passRate)}</td>
                    <td className="px-4 py-3"><ViolationBadge count={test.violations} /></td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onOpenTest(test.testId)}
                        className="whitespace-nowrap text-xs font-semibold text-primary transition-opacity hover:opacity-70"
                      >
                        View results
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border/70 p-4">
            <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={onPageChange} />
          </div>
        </>
      )}
    </SectionCard>
  );
}
