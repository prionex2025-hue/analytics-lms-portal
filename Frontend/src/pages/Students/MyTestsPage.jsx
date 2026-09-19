import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Sigma, Brain, Timer, CalendarClock, Sparkles } from "lucide-react";
import { TestsSkeleton } from "@/components/common/page-skeletons";
import { fetchMyTests } from "@/features/Students/testSlice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ui } from "@/styles/ui-tokens";

const iconByIndex = [Sigma, Brain, Timer];

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
      <div className="grid gap-4 lg:grid-cols-1 xl:grid-cols-[1.45fr_1fr]">
        <Card className={ui.cardPadding}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Ongoing Tests</h2>
            <Badge variant="secondary" className="bg-primary/10 text-xs font-semibold text-primary">{ongoing.length} Active</Badge>
          </div>

          <div className="space-y-4">
            {ongoing.map((test, index) => {
              const Icon = iconByIndex[index % iconByIndex.length];
              return (
                <Card key={test.id} className="rounded-xl border border-border bg-card p-4 shadow-none">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="flex min-w-0 gap-3">
                      <div className="grid size-10 place-items-center rounded-lg bg-primary/15 text-primary">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-lg md:text-xl font-semibold tracking-tight text-text-primary">{test.title}</p>
                        <p className="text-sm text-text-secondary">Subject: {test.subject}</p>
                      </div>
                    </div>

                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-semibold tracking-wide text-text-secondary uppercase">Time Remaining</p>
                      <p className="text-base font-semibold text-text-secondary">
                        {test.isCompleted
                          ? "Completed"
                          : `${Math.max(0, Math.round((new Date(test.endsAt).getTime() - nowMs) / 60000))} min`}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                      <span>Progress</span>
                      <span>{test.progress || 0}%</span>
                    </div>
                    <Progress className="h-2 bg-muted **:data-[slot=progress-indicator]:bg-primary-dark" value={test.progress || 0} />
                  </div>

                  {test.isCompleted ? (
                    <Badge variant="secondary" className="mt-4 bg-success/15 text-success">Completed</Badge>
                  ) : (
                    <Button
                      className="mt-4 h-10 rounded-lg bg-primary px-4 text-sm font-semibold shadow-md shadow-primary/20 hover:bg-primary-dark"
                      onClick={() => openTest(test)}
                    >
                      {test.canTryAgain ? "Try Again" : "Resume"}
                    </Button>
                  )}
                </Card>
              );
            })}

            {ongoing.length === 0 ? <p className="rounded-xl border border-dashed border-border p-5 text-sm text-text-secondary">No ongoing tests found.</p> : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className={ui.cardPadding}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-text-primary">Upcoming Tests</h2>
              <span className="text-xs font-semibold text-text-secondary">View Calendar</span>
            </div>

            <div className="space-y-3">
              {upcoming.map((test) => (
                <Card key={test.id} className="rounded-xl border-l-4 border-l-primary border-border bg-card p-4 shadow-none">
                  <p className="font-semibold text-text-primary">{test.title}</p>
                  <p className="mt-1 text-xs text-text-secondary">{test.subject}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
                    <CalendarClock className="size-3.5" />
                    {new Date(test.startsAt).toLocaleString()}
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">Duration: {test.durationMins} minutes</p>
                </Card>
              ))}

              {upcoming.length === 0 ? <p className="rounded-xl border border-dashed border-border p-5 text-sm text-text-secondary">No upcoming tests found.</p> : null}
            </div>
          </Card>

          <Card className="rounded-2xl bg-linear-to-br from-primary to-primary-dark p-5 md:p-6 text-primary-foreground shadow-[0_18px_35px_-18px_rgba(11,84,158,0.6)]">
            <div className="flex items-center gap-2 text-primary-foreground/90">
              <Sparkles className="size-4" />
              <p className="text-xs font-semibold tracking-[0.14em] uppercase">Smart Insight</p>
            </div>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight">Ace Your Next Exam</h3>
            <p className="mt-2 text-sm text-primary-foreground/90">Get personalized recommendations based on your recent ongoing test performance.</p>
            <Button className="mt-4 h-9 rounded-lg bg-card text-primary hover:bg-primary/10">Review Insights</Button>
          </Card>
        </div>
      </div>

      <Card className={ui.cardPadding}>
        <h3 className="text-lg font-semibold text-text-primary">Engagement Trend</h3>
        <p className="text-sm text-text-secondary">Average time spent per test module this week</p>
        <div className="mt-4 flex h-44 items-end gap-2">
          {[28, 48, 35, 64, 82, 42, 30, 56, 44, 61, 32, 39].map((height, index) => (
            <div key={index} className="flex-1 rounded-t bg-muted" style={{ height: `${height}%`, backgroundColor: index === 4 ? "var(--primary-dark)" : undefined }} />
          ))}
        </div>
      </Card>
    </section>
  );
}
