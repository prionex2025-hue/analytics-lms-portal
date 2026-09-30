import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, CalendarClock, CheckCircle2, ClipboardCheck, Clock3, PlayCircle, Timer } from "lucide-react";
import { TestsSkeleton } from "@/components/common/page-skeletons";
import { fetchMyTests } from "@/features/Students/testSlice";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState, MetaItem, PageHeader, Panel, SectionHeader, StatusBadge } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

export default function MyTestsPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { ongoing, upcoming, testsLoading } = useSelector((state) => state.test);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    dispatch(fetchMyTests());
  }, [dispatch]);

  useEffect(() => {
    setNowMs(Date.now());
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  if (testsLoading) {
    return <TestsSkeleton />;
  }

  const openTest = (test) => {
    if (!test?.id) {
      return;
    }

    if (test?.submissionId && !test?.canTryAgain) {
      navigate(`/test/${test.submissionId}`);
      return;
    }

    navigate(`/tests/${test.id}/instructions`);
  };

  return (
    <section className={ui.pageSection}>
      <PageHeader title="My tests" description="Your active attempts and what's coming up next." />

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          <SectionHeader title="Ongoing" count={ongoing.length} />
          {ongoing.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="No ongoing tests" description="Active tests will show up here." />
          ) : (
            <ul className="space-y-3">
              {ongoing.map((test) => (
                <li key={test.id} className={cn(ui.card, "p-4 sm:p-5")}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-text-primary sm:text-lg">{test.title}</h3>
                      <MetaItem icon={BookOpen} className="mt-1">{test.subject}</MetaItem>
                    </div>
                    {test.isCompleted ? (
                      <StatusBadge tone="success" icon={CheckCircle2}>Completed</StatusBadge>
                    ) : (
                      <StatusBadge tone="info" icon={Timer} className="tabular-nums">
                        {`${Math.max(0, Math.round((new Date(test.endsAt).getTime() - nowMs) / 60000))} min left`}
                      </StatusBadge>
                    )}
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-xs text-text-secondary">
                      <span>Progress</span>
                      <span className="tabular-nums">{test.progress || 0}%</span>
                    </div>
                    <Progress className="h-1.5 bg-muted **:data-[slot=progress-indicator]:bg-primary" value={test.progress || 0} />
                  </div>

                  {!test.isCompleted ? (
                    <Button className={cn(ui.btn, "mt-4")} onClick={() => openTest(test)}>
                      <PlayCircle className="size-4" />
                      {test.canTryAgain ? "Try Again" : "Resume"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3">
          <SectionHeader
            title="Upcoming"
            count={upcoming.length}
            action={
              <Button variant="ghost" className="h-9 rounded-lg px-3 text-primary" onClick={() => navigate("/tests/upcoming")}>
                View all
                <ArrowRight className="size-4" />
              </Button>
            }
          />
          <Panel className="p-0">
            {upcoming.length === 0 ? (
              <p className="p-5 text-center text-sm text-text-secondary">No upcoming tests found.</p>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((test) => (
                  <li key={test.id} className="p-4">
                    <p className="font-medium text-text-primary">{test.title}</p>
                    <p className="mt-0.5 text-xs text-text-secondary">{test.subject}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      <MetaItem icon={CalendarClock} className="text-xs">{new Date(test.startsAt).toLocaleString()}</MetaItem>
                      <MetaItem icon={Clock3} className="text-xs">{test.durationMins} minutes</MetaItem>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </section>
  );
}
