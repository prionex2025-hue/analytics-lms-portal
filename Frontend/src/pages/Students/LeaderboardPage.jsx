import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { Crown, Medal, Rocket, Trophy } from "lucide-react";
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
    { id: "overall", label: "Overall" },
    { id: "per_test", label: "Per Test" },
    { id: "department_wise", label: "Department-wise" },
  ];

  return (
    <section className="relative space-y-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_10%_0%,rgba(59,130,246,0.16),transparent_38%),radial-gradient(circle_at_90%_30%,rgba(14,165,233,0.14),transparent_36%)]" />

      <div className="overflow-hidden rounded-3xl border border-blue-200/70 bg-linear-to-br from-blue-950 via-blue-700 to-cyan-600 p-6 text-white shadow-[0_24px_70px_-30px_rgba(8,47,120,0.8)] sm:p-8">
        <div className="flex items-center gap-2 text-blue-100/95">
          <Rocket className="size-4" />
          <p className="text-xs font-semibold tracking-[0.12em] uppercase">Track Window</p>
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Track Your Status</h1>
        <p className="mt-2 max-w-2xl text-sm text-blue-100/90 sm:text-base">
          Track your status among your friends on the tests you participated in.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-yellow-100 text-yellow-600">
            <Crown className="size-5" />
          </div>
          <div>
            <p className="text-xs tracking-wide text-slate-500 uppercase">Top Rank</p>
            <p className="text-lg font-semibold text-slate-900">#{topHundred[0]?.rank || "-"}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-600">
            <Trophy className="size-5" />
          </div>
          <div>
            <p className="text-xs tracking-wide text-slate-500 uppercase">Highest Score</p>
            <p className="text-lg font-semibold text-slate-900">{topHundred[0]?.score ?? "-"}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:col-span-2 xl:col-span-1">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
            <Medal className="size-5" />
          </div>
          <div>
            <p className="text-xs tracking-wide text-slate-500 uppercase">Visible Entries</p>
            <p className="text-lg font-semibold text-slate-900">{displayRows.filter((row) => row.kind === "row").length}</p>
          </div>
        </div>
      </div>

      <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="inline-flex w-full flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
          {viewOptions.map((option) => {
            const isActive = filters.view === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, view: option.id }))}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "bg-white text-blue-700 shadow-[0_10px_18px_-12px_rgba(37,99,235,0.9)]"
                    : "text-slate-600 hover:bg-white/80 hover:text-slate-900"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <select
            value={filters.test_id || ALL_TESTS_VALUE}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                test_id: event.target.value === ALL_TESTS_VALUE ? "" : event.target.value,
              }))
            }
            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-3 focus:ring-blue-100"
          >
            <option value={ALL_TESTS_VALUE}>All tests</option>
            {testOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          <input
            placeholder="Search by student name or ID"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-3 focus:ring-blue-100"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-3 focus:ring-blue-100"
          >
            <option value="rank">Sort by Rank</option>
            <option value="score">Sort by Score</option>
            <option value="time">Sort by Time Taken</option>
          </select>

          <button
            type="button"
            onClick={() => setFocusMyPosition((prev) => !prev)}
            className="h-11 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!currentStudentRow}
          >
            {focusMyPosition ? "Show Full List" : "Focus My Position"}
          </button>

          <button
            type="button"
            onClick={() => {
              if (currentStudentDisplayRow) {
                const targetId = getRowDomId(currentStudentDisplayRow, 0);
                const target = document.getElementById(targetId);
                target?.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }}
            className="h-11 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!currentStudentDisplayRow}
          >
            Jump To Me
          </button>
        </div>

        {requiresTestSelection && !hasSelectedTest ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
            Choose a test from the dropdown to load per-test rankings.
          </p>
        ) : null}

        {requiresTestSelection && hasSelectedTest ? (
          <p className="text-sm text-slate-600">
            Viewing leaderboard for <span className="font-semibold text-slate-900">{selectedTestName}</span>
          </p>
        ) : null}
      </div>

      {showNotAttempted ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
          <p className="text-sm font-semibold">Per test status</p>
          <p className="text-sm">You did not attempt this test.</p>
        </div>
      ) : null}

      {shouldFetchLeaderboard && leaderboardQuery.isLoading ? (
        <div className="grid min-h-[40vh] place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500">
          Loading leaderboard...
        </div>
      ) : null}

      {shouldFetchLeaderboard && leaderboardQuery.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
          <p className="text-sm font-semibold">Failed to load leaderboard</p>
          <p className="text-sm">{leaderboardQuery.error?.message || "Please retry shortly."}</p>
        </div>
      ) : null}

      {!leaderboardQuery.isLoading && !leaderboardQuery.isError && shouldFetchLeaderboard && displayRows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">
            {normalizeText(searchText) ? "No matching students" : "No rankings yet"}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {normalizeText(searchText)
              ? "Try a shorter search or clear filters to see more results."
              : "Once students submit tests, this leaderboard will populate."}
          </p>
        </div>
      ) : null}

      {!leaderboardQuery.isLoading && !leaderboardQuery.isError && shouldFetchLeaderboard && displayRows.length > 0 ? (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="hidden md:block">
            <div className="grid grid-cols-[88px_1.8fr_120px_120px] items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <p>Rank</p>
              <p>Student</p>
              <p>Score</p>
              <p>Percentage</p>
            </div>

            <div>
              {displayRows.map((row, index) => {
                if (row?.kind === "separator") {
                  return (
                    <div
                      key={row.id}
                      className="flex items-center justify-center border-y border-dashed border-blue-200 bg-blue-50 px-4 py-3 text-xs font-medium tracking-wide text-blue-700 uppercase"
                    >
                      Your Position
                    </div>
                  );
                }

                const isCurrent = isCurrentStudentRow(row);

                return (
                  <div
                    id={getRowDomId(row, index)}
                    key={`${row.id}-${row.rank}`}
                    className={`grid grid-cols-[88px_1.8fr_120px_120px] items-center gap-3 border-b border-slate-100 px-4 py-3 text-sm ${
                      isCurrent ? "bg-blue-50" : "bg-white"
                    }`}
                  >
                    <p className="font-semibold text-blue-700">#{row.rank}</p>
                    <p className="font-medium text-slate-900">
                      {maskStudentName(row.fullName)} {isCurrent ? "(You)" : ""}
                    </p>
                    <p className="font-semibold text-slate-900">{row.score}</p>
                    <p className="text-slate-600">{formatPercentage(row.percentage)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 p-3 md:hidden">
            {displayRows.map((row, index) => {
              if (row?.kind === "separator") {
                return (
                  <div
                    key={row.id}
                    className="rounded-xl border border-dashed border-blue-200 bg-blue-50 px-4 py-2 text-center text-xs font-medium tracking-wide text-blue-700 uppercase"
                  >
                    Your Position
                  </div>
                );
              }

              const isCurrent = isCurrentStudentRow(row);

              return (
                <div
                  id={getRowDomId(row, index)}
                  key={`${row.id}-${row.rank}`}
                  className={`rounded-2xl border p-4 ${
                    isCurrent ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <p className="text-lg font-semibold text-blue-700">#{row.rank}</p>
                    <p className="text-right text-sm font-medium text-slate-900">
                      {maskStudentName(row.fullName)} {isCurrent ? "(You)" : ""}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs tracking-wide text-slate-500 uppercase">Score</p>
                      <p className="mt-1 font-semibold text-slate-900">{row.score}</p>
                    </div>
                    <div>
                      <p className="text-xs tracking-wide text-slate-500 uppercase">Percentage</p>
                      <p className="mt-1 font-medium text-slate-700">{formatPercentage(row.percentage)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {!shouldFetchLeaderboard ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">Select a test</p>
          <p className="mt-2 text-sm text-slate-500">Per-test leaderboard needs a test selection from the dropdown above.</p>
        </div>
      ) : null}

      {!currentStudentRow && shouldFetchLeaderboard ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          No attempts found for your profile yet. You will appear here after your first submission.
        </div>
      ) : null}
    </section>
  );
}
