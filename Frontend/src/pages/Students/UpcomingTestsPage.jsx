import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, CalendarClock, CalendarX2, Clock3, Hourglass, Lock, Repeat, Users } from "lucide-react";
import { upcomingTestsQueryOptions, testAccessQueryOptions } from "@/services/studentQueries";
import { Button } from "@/components/ui/button";
import { EmptyState, MetaItem, PageHeader, SectionHeader, StatusBadge } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

const formatDayParts = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { month: "--", day: "--" };
  return {
    month: date.toLocaleString([], { month: "short" }),
    day: date.getDate(),
  };
};

const pickId = (item) => item?.id || item?.test_id || item?.testId;

const dedupeTests = (items) => {
  const map = new Map();

  (items || []).forEach((item) => {
    const id = pickId(item);
    if (!id || map.has(id)) {
      return;
    }

    map.set(id, {
      ...item,
      id,
    });
  });

  return [...map.values()];
};

const formatDate = (dateValue) =>
  new Date(dateValue).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const toCountdown = (ms) => {
  if (ms <= 0) {
    return "Live now";
  }

  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) {
    return `Starts in ${days}d ${hours}h ${minutes}m`;
  }

  return `Starts in ${hours}h ${minutes}m ${seconds}s`;
};

const getAssignedDepartments = (test) => {
  const ids = Array.isArray(test?.assignedTo) ? test.assignedTo : [];
  return [...new Set(ids.filter(Boolean).map((id) => String(id)))];
};

export default function UpcomingTestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);
  const previousIdsRef = useRef(new Set());

  const { data } = useQuery(upcomingTestsQueryOptions());

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((current) => current + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const now = useMemo(() => {
    const baseServerTime = data?.serverTime || Date.now();
    return baseServerTime + tick * 1000;
  }, [data?.serverTime, tick]);

  const tests = useMemo(() => dedupeTests(data?.items), [data?.items]);

  useEffect(() => {
    const currentIds = new Set(tests.map((test) => String(test.id)));

    if (previousIdsRef.current.size > 0) {
      const removedCount = [...previousIdsRef.current].filter((id) => !currentIds.has(id)).length;
      if (removedCount > 0) {
        toast.info(`${removedCount} upcoming test${removedCount > 1 ? "s were" : " was"} removed.`);
      }
    }

    previousIdsRef.current = currentIds;
  }, [tests]);

  const { upcoming, past } = useMemo(() => {
    const upcomingList = [];
    const pastList = [];

    tests.forEach((test) => {
      const start = new Date(test.startsAt || test.startAt || 0).getTime();
      const end = new Date(test.endsAt || test.endTime || 0).getTime();

      if (Number.isFinite(end) && end > 0 && now > end) {
        pastList.push({ ...test, start, end, state: "MISSED" });
        return;
      }

      if (Number.isFinite(start) && start > now) {
        upcomingList.push({ ...test, start, end, state: "LOCKED" });
        return;
      }

      upcomingList.push({ ...test, start, end, state: "LIVE" });
    });

    upcomingList.sort((a, b) => a.start - b.start);
    pastList.sort((a, b) => b.end - a.end);

    return {
      upcoming: upcomingList,
      past: pastList,
    };
  }, [now, tests]);

  const header = (
    <PageHeader
      title="Upcoming tests"
      description="Scheduled tests assigned to you. Access is verified by the server when you open the instructions."
    />
  );

  if (tests.length === 0) {
    return (
      <section className={ui.pageSection}>
        {header}
        <EmptyState
          icon={CalendarClock}
          title="No upcoming tests"
          description="New schedules will appear here automatically."
        />
      </section>
    );
  }

  return (
    <section className={ui.pageSection}>
      {header}

      <div className="space-y-3">
        <SectionHeader title="Scheduled" count={upcoming.length} />
        {upcoming.length === 0 ? (
          <EmptyState icon={CalendarClock} title="Nothing scheduled" description="There are no tests scheduled right now." />
        ) : (
          <ul className="space-y-3">
            {upcoming.map((test) => {
              const countdown = toCountdown(test.start - now);
              const departments = getAssignedDepartments(test).length;
              const day = formatDayParts(test.startsAt || test.startAt);
              const isLive = test.state === "LIVE";

              return (
                <li key={test.id} className={cn(ui.card, "flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5")}>
                  <div
                    className={cn(
                      "hidden size-16 shrink-0 flex-col items-center justify-center rounded-xl border sm:flex",
                      isLive ? "border-success/30 bg-success/10 text-success" : "border-border bg-muted/60 text-text-primary"
                    )}
                    aria-hidden="true"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide">{day.month}</span>
                    <span className="text-xl font-semibold leading-none tabular-nums">{day.day}</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-text-primary sm:text-lg">{test.title || test.name || "Untitled Test"}</h3>
                      {isLive ? (
                        <StatusBadge tone="success">
                          <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
                          Live now
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="info" icon={Hourglass} className="tabular-nums">{countdown}</StatusBadge>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <MetaItem icon={CalendarClock}>{formatDate(test.startsAt || test.startAt)}</MetaItem>
                      <MetaItem icon={Clock3}>{test.durationMins || test.duration || 0} mins</MetaItem>
                      <MetaItem icon={Repeat}>Attempts: {test.attemptsAllowed || 1}</MetaItem>
                      {departments > 0 ? <MetaItem icon={Users}>Dept scope ({departments})</MetaItem> : null}
                    </div>
                  </div>

                  {test.state === "LOCKED" ? (
                    <StatusBadge tone="neutral" icon={Lock} className="h-8 self-start px-3 sm:self-center">Locked</StatusBadge>
                  ) : (
                    <Button
                      className={cn(ui.btn, "w-full sm:w-auto")}
                      onMouseEnter={() => {
                        queryClient.prefetchQuery(testAccessQueryOptions(test.id));
                      }}
                      onFocus={() => {
                        queryClient.prefetchQuery(testAccessQueryOptions(test.id));
                      }}
                      onClick={() => {
                        navigate(`/tests/${test.id}/instructions`);
                      }}
                    >
                      View Instructions
                      <ArrowRight className="size-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-3 pt-2">
        <SectionHeader title="Missed" description="Tests whose window ended without a submission." count={past.length} />
        {past.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-text-secondary">
            No missed tests. Nice work.
          </p>
        ) : (
          <ul className={cn(ui.card, "divide-y divide-border overflow-hidden")}>
            {past.map((test) => (
              <li key={test.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">{test.title || test.name || "Untitled Test"}</p>
                  <p className="text-xs text-text-secondary">Ended {formatDate(test.endsAt || test.endTime)}</p>
                </div>
                <StatusBadge tone="danger" icon={CalendarX2}>Missed</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
