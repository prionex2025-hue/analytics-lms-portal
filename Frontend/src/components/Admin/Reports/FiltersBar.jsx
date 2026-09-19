import { useEffect, useState } from "react";

export default function FiltersBar({ filters, tests, departments, batches, loading, onFilterChange, onApply, onReset }) {
  const [searchDraft, setSearchDraft] = useState(filters.studentSearch || "");

  useEffect(() => {
    setSearchDraft(filters.studentSearch || "");
  }, [filters.studentSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onFilterChange("studentSearch", searchDraft);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchDraft, onFilterChange]);

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="space-y-1 text-sm">
          <span className="font-medium text-text-secondary">Test</span>
          <select
            className="h-10 w-full rounded-lg border border-border bg-background px-3"
            value={filters.testId}
            onChange={(event) => onFilterChange("testId", event.target.value)}
          >
            <option value="">All tests</option>
            {tests.map((test) => (
              <option key={test.id} value={test.id}>
                {test.title}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium text-text-secondary">Department</span>
          <select
            className="h-10 w-full rounded-lg border border-border bg-background px-3"
            value={filters.departmentId}
            onChange={(event) => onFilterChange("departmentId", event.target.value)}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium text-text-secondary">Batch</span>
          <select
            className="h-10 w-full rounded-lg border border-border bg-background px-3"
            value={filters.batchId}
            onChange={(event) => onFilterChange("batchId", event.target.value)}
          >
            <option value="">All batches</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium text-text-secondary">Date range</span>
          <select
            className="h-10 w-full rounded-lg border border-border bg-background px-3"
            value={filters.dateRange}
            onChange={(event) => onFilterChange("dateRange", event.target.value)}
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium text-text-secondary">Student search</span>
          <input
            type="text"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Name or roll number"
            className="h-10 w-full rounded-lg border border-border bg-background px-3"
          />
        </label>
      </div>

      {filters.dateRange === "custom" ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-text-secondary">From</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => onFilterChange("dateFrom", event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-text-secondary">To</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => onFilterChange("dateTo", event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3"
            />
          </label>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
          onClick={onApply}
        >
          Apply Filters
        </button>
        <button
          type="button"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary"
          onClick={onReset}
        >
          Reset Filters
        </button>
      </div>
    </section>
  );
}
