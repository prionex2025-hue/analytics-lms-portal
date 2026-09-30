import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { Building2, Crosshair, Crown, Globe2, ListOrdered, LocateFixed, Medal, Search, Trophy, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import {
  Callout,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  StatTile,
} from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

const RANK_STYLE = {
  1: "bg-amber-100 text-amber-700 ring-amber-300/60 dark:bg-amber-400/15 dark:text-amber-300",
  2: "bg-slate-100 text-slate-600 ring-slate-300/70 dark:bg-slate-400/15 dark:text-slate-300",
  3: "bg-orange-100 text-orange-700 ring-orange-300/60 dark:bg-orange-400/15 dark:text-orange-300",
};

function RankMark({ rank }) {
  const podium = RANK_STYLE[rank];
  return (
    <span
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full px-2 text-sm font-semibold tabular-nums",
        podium ? `ring-1 ring-inset ${podium}` : "text-text-secondary"
      )}
    >
      {rank === 1 ? <Crown className="size-3.5" aria-hidden="true" /> : null}
      {rank}
    </span>
  );
}

function ScoreBar({ value }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-full max-w-28 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }} />
      </div>
    </div>
  );
}
import { leaderboardQueryOptions, reportsQueryOptions, upcomingTestsQueryOptions } from "@/services/studentQueries";

const ALL_TESTS_VALUE = "__all_tests__";

const maskStudentName = (fullName = "Student") => {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "Student";
  }

  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
  return lastName ? `${firstName} ${lastName[0].toUpperCase()}.` : firstName;
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clampPercent = (value) => Math.max(0, Math.min(100, toNumber(value, 0)));

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const buildIdentitySet = (values = []) => {
  const normalized = values.map((value) => normalizeText(value)).filter(Boolean);
  return new Set(normalized);
};

const isBetterAttempt = (candidate, current) => {
  if (!current) return true;
  if (candidate.score !== current.score) return candidate.score > current.score;
  if (candidate.timeTakenSeconds !== current.timeTakenSeconds) return candidate.timeTakenSeconds < current.timeTakenSeconds;
  return normalizeText(candidate.fullName) < normalizeText(current.fullName);
};

const normalizeRows = (payload) => {
  const source = payload?.data || payload?.rows || payload?.items || [];

  if (!Array.isArray(source)) {
    return [];
  }

  return source.map((row, index) => ({
    id: row?.id || row?.entry_id || `${row?.studentId || row?.student_id || "student"}-${index + 1}`,
    rank: toNumber(row?.rank, 0),
    testId: row?.testId || row?.test_id || null,
    studentId: row?.studentId || row?.student_id || row?.userId || row?.user_id || null,
    fullName: row?.studentName || row?.student_name || row?.name || "Student",
    score: clampPercent(row?.score),
    percentage: clampPercent(row?.percentage ?? row?.accuracy ?? row?.score),
    department: row?.department || row?.departmentName || "-",
    testName: row?.testName || row?.test_name || "-",
    timeTakenSeconds: toNumber(row?.timeTakenSeconds || row?.time_taken || 0),
  }));
};

const assignCompetitionRank = (rows) => {
  if (!rows.length) {
    return [];
  }

  const sorted = [...rows].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.timeTakenSeconds - b.timeTakenSeconds;
  });

  let lastScore = null;
  let lastRank = 0;

  return sorted.map((row, index) => {
    if (lastScore === null || row.score !== lastScore) {
      lastRank = index + 1;
      lastScore = row.score;
    }

    return {
      ...row,
      rank: lastRank,
    };
  });
};

const dedupeByStudent = (rows) => {
  const bestByStudent = new Map();

  rows.forEach((row, index) => {
    const key = String(row.studentId || `unknown-${normalizeText(row.fullName)}-${index + 1}`);
    const current = bestByStudent.get(key);
    if (isBetterAttempt(row, current)) {
      bestByStudent.set(key, row);
    }
  });

  return Array.from(bestByStudent.values());
};

const sortRows = (rows, sortBy) => {
  const sorted = [...rows];

  sorted.sort((a, b) => {
    if (sortBy === "score") {
      if (b.score !== a.score) return b.score - a.score;
      if (a.timeTakenSeconds !== b.timeTakenSeconds) return a.timeTakenSeconds - b.timeTakenSeconds;
      return normalizeText(a.fullName).localeCompare(normalizeText(b.fullName));
    }

    if (sortBy === "time") {
      if (a.timeTakenSeconds !== b.timeTakenSeconds) return a.timeTakenSeconds - b.timeTakenSeconds;
      if (b.score !== a.score) return b.score - a.score;
      return normalizeText(a.fullName).localeCompare(normalizeText(b.fullName));
    }

    if (a.rank !== b.rank) return a.rank - b.rank;
    return normalizeText(a.fullName).localeCompare(normalizeText(b.fullName));
  });

  return sorted;
};

export default function LeaderboardPage() {
  const user = useSelector((state) => state.auth.user);
  const [filters, setFilters] = useState({
    view: "overall",
    test_id: "",
    department: user?.departmentId || user?.department?.id || "",
  });
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState("rank");
  const [focusMyPosition, setFocusMyPosition] = useState(false);

  const requiresTestSelection = filters.view === "per_test";
  const hasSelectedTest = Boolean(filters.test_id);
  const shouldFetchLeaderboard = !requiresTestSelection || hasSelectedTest;

  const leaderboardQuery = useQuery({
    ...leaderboardQueryOptions(filters),
    enabled: shouldFetchLeaderboard,
  });
  const upcomingTestsQuery = useQuery(upcomingTestsQueryOptions());
  const reportsCatalogQuery = useQuery({
    ...reportsQueryOptions({ view: "overall" }),
    enabled: true,
  });

  const rankedRows = useMemo(() => {
    const normalizedRows = normalizeRows(leaderboardQuery.data);
    const dedupedRows = dedupeByStudent(normalizedRows);
    return assignCompetitionRank(dedupedRows);
  }, [leaderboardQuery.data]);

  const searchedRows = useMemo(() => {
    const query = normalizeText(searchText);
    if (!query) {
      return rankedRows;
    }

    return rankedRows.filter((row) => {
      const name = normalizeText(row.fullName);
      const studentId = normalizeText(row.studentId);
      return name.includes(query) || studentId.includes(query);
    });
  }, [rankedRows, searchText]);

  const sortedRows = useMemo(() => sortRows(searchedRows, sortBy), [searchedRows, sortBy]);

  const currentStudentIdentity = useMemo(
    () =>
      buildIdentitySet([
        user?.studentId,
        user?.rollNumber,
        user?.id,
        user?._id,
        user?.userId,
        user?.student?.studentId,
        user?.student?.id,
      ]),
    [user],
  );
  const currentStudentName = normalizeText(user?.fullName || user?.name);

  const isCurrentStudentRow = (row) => {
    const rowIdentity = buildIdentitySet([row?.studentId, row?.userId, row?.id]);
    const hasIdentityMatch = Array.from(rowIdentity).some((id) => currentStudentIdentity.has(id));

    if (hasIdentityMatch) {
      return true;
    }

    if (rowIdentity.size === 0 && currentStudentName) {
      return normalizeText(row?.fullName) === currentStudentName;
    }

    return false;
  };

  const currentStudentIndex = sortedRows.findIndex((row) => isCurrentStudentRow(row));
  const currentStudentRow = currentStudentIndex >= 0 ? sortedRows[currentStudentIndex] : null;

  const shouldLimitToTopHundred = !focusMyPosition && !normalizeText(searchText) && sortBy === "rank";
  const topHundred = shouldLimitToTopHundred ? sortedRows.slice(0, 100) : sortedRows;
  const shouldPinCurrentAtBottom = shouldLimitToTopHundred && currentStudentIndex >= 100;

  const nearbyRows = useMemo(() => {
    if (!focusMyPosition || !currentStudentRow) {
      return topHundred;
    }

    const start = Math.max(0, currentStudentIndex - 3);
    const end = Math.min(sortedRows.length, currentStudentIndex + 4);
    return sortedRows.slice(start, end);
  }, [currentStudentIndex, currentStudentRow, focusMyPosition, sortedRows, topHundred]);

  const displayRows = useMemo(() => {
    const rows = nearbyRows.map((row) => ({ kind: "row", ...row }));

    if (shouldPinCurrentAtBottom && currentStudentRow && !focusMyPosition) {
      rows.push({ kind: "separator", id: "__current_sep__" });
      rows.push({ kind: "row", ...currentStudentRow, pinned: true });
    }

    return rows;
  }, [currentStudentRow, focusMyPosition, nearbyRows, shouldPinCurrentAtBottom]);

  const showNotAttempted = filters.view === "per_test" && Boolean(filters.test_id) && shouldFetchLeaderboard && !currentStudentRow;

  const testOptionsMap = new Map();
  const addTestOption = (testId, testName) => {
    const normalizedId = String(testId || "").trim();
    const normalizedName = String(testName || "").trim();
    if (!normalizedId || !normalizedName || testOptionsMap.has(normalizedId)) {
      return;
    }
    testOptionsMap.set(normalizedId, normalizedName);
  };

  const upcomingTests = upcomingTestsQuery.data?.items || [];
  upcomingTests.forEach((item) => {
    addTestOption(item?.id || item?.test_id || item?.testId, item?.title || item?.name);
  });

  const completedTests = reportsCatalogQuery.data?.testWise || reportsCatalogQuery.data?.test_wise || [];
  completedTests.forEach((row) => {
    addTestOption(row?.testId || row?.test_id, row?.testName || row?.test_name || row?.title);
  });

  sortedRows.forEach((row) => {
    addTestOption(row?.testId, row?.testName);
  });

  const testOptions = Array.from(testOptionsMap.entries()).map(([id, name]) => ({ id, name }));
  const selectedTestName = testOptions.find((item) => item.id === filters.test_id)?.name || "Selected Test";
  const currentStudentDisplayRow = displayRows.find((row) => row?.kind === "row" && isCurrentStudentRow(row));
  const getRowDomId = (row, index) => `leaderboard-row-${row?.id || "student"}-${row?.rank || index}`;

  const formatPercentage = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return `${num.toFixed(1)}%`;
  };

  const viewOptions = [
    { value: "overall", label: "Overall", icon: Globe2 },
    { value: "per_test", label: "Per Test", icon: ListOrdered },
    { value: "department_wise", label: "Department", icon: Building2 },
  ];

  const rowCount = displayRows.filter((row) => row.kind === "row").length;
  const isReady = shouldFetchLeaderboard && !leaderboardQuery.isLoading && !leaderboardQuery.isError;

  return (
    <section className={ui.pageSection}>
      <PageHeader
        title="Leaderboard"
        description="See where you stand among classmates on the tests you've taken. Names are partially masked for privacy."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          icon={UserRound}
          label="Your rank"
          value={currentStudentRow ? `#${currentStudentRow.rank}` : "—"}
          hint={currentStudentRow ? `of ${rankedRows.length} ranked` : "Not ranked yet"}
        />
        <StatTile
          icon={Trophy}
          label="Your score"
          value={currentStudentRow ? currentStudentRow.score : "—"}
          hint={currentStudentRow ? formatPercentage(currentStudentRow.percentage) : "Submit a test to appear"}
          tone="success"
        />
        <StatTile
          icon={Medal}
          label="Highest score"
          value={topHundred[0]?.score ?? "—"}
          hint={topHundred[0] ? `Top rank #${topHundred[0].rank}` : "No rankings yet"}
          tone="warning"
        />
      </div>

      <div className={cn(ui.card, "overflow-hidden")}>
        <div className="space-y-4 border-b border-border p-4 sm:p-5">
          <SegmentedControl
            label="Leaderboard view"
            value={filters.view}
            onChange={(view) => setFilters((prev) => ({ ...prev, view }))}
            options={viewOptions}
          />

          <div className="flex flex-wrap gap-3">
            <NativeSelect
              value={filters.test_id || ALL_TESTS_VALUE}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  test_id: event.target.value === ALL_TESTS_VALUE ? "" : event.target.value,
                }))
              }
              aria-label="Test"
              className={cn("w-full sm:w-48", ui.select)}
            >
              <option value={ALL_TESTS_VALUE}>All tests</option>
              {testOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>

            <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
              <Input
                placeholder="Search by student name or ID"
                aria-label="Search students"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                className={cn(ui.field, "pl-9")}
              />
            </div>

            <NativeSelect value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort by" className={cn("w-full sm:w-48", ui.select)}>
              <option value="rank">Sort by Rank</option>
              <option value="score">Sort by Score</option>
              <option value="time">Sort by Time Taken</option>
            </NativeSelect>

            <Button
              type="button"
              variant={focusMyPosition ? "default" : "outline"}
              className={ui.btn}
              onClick={() => setFocusMyPosition((prev) => !prev)}
              disabled={!currentStudentRow}
              aria-pressed={focusMyPosition}
            >
              <Crosshair className="size-4" />
              {focusMyPosition ? "Show Full List" : "Focus My Position"}
            </Button>

            <Button
              type="button"
              variant="outline"
              className={ui.btn}
              onClick={() => {
                if (currentStudentDisplayRow) {
                  const targetId = getRowDomId(currentStudentDisplayRow, 0);
                  const target = document.getElementById(targetId);
                  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                  target?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
                }
              }}
              disabled={!currentStudentDisplayRow}
            >
              <LocateFixed className="size-4" />
              Jump To Me
            </Button>
          </div>

          {requiresTestSelection && hasSelectedTest ? (
            <p className="text-sm text-text-secondary">
              Viewing leaderboard for <span className="font-medium text-text-primary">{selectedTestName}</span>
            </p>
          ) : null}
        </div>

        {showNotAttempted ? (
          <div className="border-b border-border p-4 sm:px-5">
            <Callout tone="warning" title="Per test status">You did not attempt this test.</Callout>
          </div>
        ) : null}

        {!shouldFetchLeaderboard ? (
          <EmptyState
            icon={ListOrdered}
            title="Select a test"
            description="Choose a test from the dropdown above to load per-test rankings."
            className="rounded-none border-0"
          />
        ) : null}

        {shouldFetchLeaderboard && leaderboardQuery.isLoading ? (
          <div className="space-y-2 p-4 sm:p-5" aria-busy="true" aria-label="Loading leaderboard">
            {Array.from({ length: 6 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-11 rounded-lg" />
            ))}
          </div>
        ) : null}

        {shouldFetchLeaderboard && leaderboardQuery.isError ? (
          <div className="p-4 sm:p-5">
            <ErrorState
              title="Failed to load leaderboard"
              description={leaderboardQuery.error?.message || "Please retry shortly."}
              onRetry={() => leaderboardQuery.refetch()}
            />
          </div>
        ) : null}

        {isReady && displayRows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={normalizeText(searchText) ? "No matching students" : "No rankings yet"}
            description={
              normalizeText(searchText)
                ? "Try a shorter search or clear filters to see more results."
                : "Once students submit tests, this leaderboard will populate."
            }
            className="rounded-none border-0"
          />
        ) : null}

        {isReady && displayRows.length > 0 ? (
          <>
            <div className="hidden md:block" role="table" aria-label="Leaderboard">
              <div
                role="row"
                className="grid grid-cols-[88px_minmax(0,1.8fr)_minmax(0,1fr)_100px_110px] items-center gap-3 bg-muted/50 px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                <span role="columnheader">Rank</span>
                <span role="columnheader">Student</span>
                <span role="columnheader"><span className="sr-only">Score bar</span></span>
                <span role="columnheader" className="text-right">Score</span>
                <span role="columnheader" className="text-right">Percentage</span>
              </div>

              <div className="divide-y divide-border">
                {displayRows.map((row, index) => {
                  if (row?.kind === "separator") {
                    return (
                      <div key={row.id} className="flex items-center gap-3 bg-muted/30 px-5 py-2 text-xs font-medium uppercase tracking-wide text-text-secondary">
                        <span className="h-px flex-1 border-t border-dashed border-border" aria-hidden="true" />
                        Your Position
                        <span className="h-px flex-1 border-t border-dashed border-border" aria-hidden="true" />
                      </div>
                    );
                  }

                  const isCurrent = isCurrentStudentRow(row);

                  return (
                    <div
                      role="row"
                      id={getRowDomId(row, index)}
                      key={`${row.id}-${row.rank}`}
                      aria-current={isCurrent ? "true" : undefined}
                      className={cn(
                        "relative grid grid-cols-[88px_minmax(0,1.8fr)_minmax(0,1fr)_100px_110px] items-center gap-3 px-5 py-3 text-sm transition-colors",
                        isCurrent ? "bg-primary/8" : "hover:bg-muted/40"
                      )}
                    >
                      {isCurrent ? <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden="true" /> : null}
                      <span role="cell"><RankMark rank={row.rank} /></span>
                      <span role="cell" className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-text-primary">{maskStudentName(row.fullName)}</span>
                        {isCurrent ? (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">You</span>
                        ) : null}
                      </span>
                      <span role="cell"><ScoreBar value={row.percentage} /></span>
                      <span role="cell" className="text-right font-semibold tabular-nums text-text-primary">{row.score}</span>
                      <span role="cell" className="text-right tabular-nums text-text-secondary">{formatPercentage(row.percentage)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <ul className="divide-y divide-border md:hidden">
              {displayRows.map((row, index) => {
                if (row?.kind === "separator") {
                  return (
                    <li key={row.id} className="bg-muted/30 px-4 py-2 text-center text-xs font-medium uppercase tracking-wide text-text-secondary">
                      Your Position
                    </li>
                  );
                }

                const isCurrent = isCurrentStudentRow(row);

                return (
                  <li
                    id={getRowDomId(row, index)}
                    key={`${row.id}-${row.rank}`}
                    aria-current={isCurrent ? "true" : undefined}
                    className={cn("flex items-center gap-3 px-4 py-3", isCurrent ? "bg-primary/8" : "")}
                  >
                    <RankMark rank={row.rank} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-text-primary">{maskStudentName(row.fullName)}</span>
                        {isCurrent ? (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">You</span>
                        ) : null}
                      </p>
                      <p className="text-xs tabular-nums text-text-secondary">{formatPercentage(row.percentage)}</p>
                    </div>
                    <p className="text-base font-semibold tabular-nums text-text-primary">{row.score}</p>
                  </li>
                );
              })}
            </ul>

            <p className="border-t border-border px-4 py-3 text-xs text-text-secondary sm:px-5">
              Showing {rowCount} {rowCount === 1 ? "entry" : "entries"}
              {shouldLimitToTopHundred && sortedRows.length > 100 ? " · top 100" : ""}
            </p>
          </>
        ) : null}
      </div>

      {!currentStudentRow && shouldFetchLeaderboard && !leaderboardQuery.isLoading ? (
        <Callout tone="info" icon={UserRound}>
          No attempts found for your profile yet. You will appear here after your first submission.
        </Callout>
      ) : null}
    </section>
  );
}
