import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Clock3, Rocket } from "lucide-react";
import { upcomingTestsQueryOptions, testAccessQueryOptions } from "@/services/studentQueries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

  if (tests.length === 0) {
    return (
      <section className="space-y-5">
        <Card className="rounded-2xl border border-primary/25 bg-linear-to-br from-primary-dark via-primary to-primary-dark p-6 text-primary-foreground shadow-lg shadow-primary/30">
        <div className="flex items-center gap-2 text-primary-foreground/90">
          <Rocket className="size-4" />
          <p className="text-xs font-semibold tracking-[0.12em] uppercase">Upcoming Window</p>
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Upcoming Tests</h1>
        <p className="mt-2 text-sm text-primary-foreground/90">Start access is validated on server when you click Attend Now.</p>
      </Card>
        <Card className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-lg font-semibold text-text-primary">No upcoming tests</p>
          <p className="mt-2 text-sm text-text-secondary">New schedules will appear here automatically.</p>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <Card className="rounded-2xl border border-primary/25 bg-linear-to-br from-primary-dark via-primary to-primary-dark p-6 text-primary-foreground shadow-lg shadow-primary/30">
        <div className="flex items-center gap-2 text-primary-foreground/90">
          <Rocket className="size-4" />
          <p className="text-xs font-semibold tracking-[0.12em] uppercase">Upcoming Window</p>
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Upcoming Tests</h1>
        <p className="mt-2 text-sm text-primary-foreground/90">Start access is validated on server when you click Attend Now.</p>
      </Card>

      <div className="space-y-4">
        {upcoming.map((test) => {
          const countdown = toCountdown(test.start - now);

          return (
            <Card key={test.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-2">
                  <p className="truncate text-lg font-semibold text-text-primary">{test.title || test.name || "Untitled Test"}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                      <CalendarClock className="size-3.5" />
                      {formatDate(test.startsAt || test.startAt)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                      <Clock3 className="size-3.5" />
                      {test.durationMins || test.duration || 0} mins
                    </span>
                    <span className="rounded-md bg-muted px-2 py-1">Attempts: {test.attemptsAllowed || 1}</span>
                    {getAssignedDepartments(test).length > 0 ? (
                      <span className="rounded-md bg-primary/10 px-2 py-1 text-primary-dark">
                        Dept Scope ({getAssignedDepartments(test).length})
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-text-secondary">{countdown}</p>
                </div>

                {test.state === "LOCKED" ? (
                  <Badge variant="secondary" className="bg-muted text-text-secondary">Locked</Badge>
                ) : (
                  <Button
                    className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary-dark"
                    onMouseEnter={() => {
                      queryClient.prefetchQuery(testAccessQueryOptions(test.id));
                    }}
                    onClick={() => {
                      navigate(`/tests/${test.id}/instructions`);
                    }}
                  >
                    View Instructions
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-text-primary">Past (Missed)</h2>
        {past.length === 0 ? (
          <Card className="rounded-xl border border-dashed border-border bg-card p-5 text-sm text-text-secondary">
            No missed tests.
          </Card>
        ) : (
          past.map((test) => (
            <Card key={test.id} className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-text-primary">{test.title || test.name || "Untitled Test"}</p>
                  <p className="text-xs text-text-secondary">Ended {formatDate(test.endsAt || test.endTime)}</p>
                </div>
                <Badge variant="ended">Missed</Badge>
              </div>
            </Card>
          ))
        )}
      </div>
    </section>
  );
}
