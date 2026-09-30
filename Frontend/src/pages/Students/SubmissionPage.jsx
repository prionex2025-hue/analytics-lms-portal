import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, Clock3, FileDigit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { attemptResultQueryOptions } from "@/services/studentQueries";
import { ErrorState, LoadingState } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default function SubmissionPage() {
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [showDetails, setShowDetails] = useState(false);

  const submissionState = location.state?.submission || location.state?.finalSubmission || null;
  const summaryState = location.state?.summary || null;

  const resultQuery = useQuery({
    ...attemptResultQueryOptions(submissionId),
    enabled: Boolean(submissionId) && !submissionState,
    retry: false,
  });

  const result = useMemo(() => submissionState || resultQuery.data || {}, [resultQuery.data, submissionState]);
  const summary = useMemo(() => summaryState || result?.summary || result || {}, [result, summaryState]);

  const detailRows = useMemo(
    () => [
      { label: "Status", value: result?.status || summary?.status || "Submitted" },
      { label: "Score", value: summary?.score ?? result?.score ?? "N/A" },
      {
        label: "Accuracy",
        value:
          summary?.accuracy != null || result?.accuracy != null
            ? `${toNumber(summary?.accuracy ?? result?.accuracy)}%`
            : "N/A",
      },
      { label: "Attempt", value: result?.attemptNumber ?? summary?.attemptNumber ?? "N/A" },
      {
        label: "Submitted At",
        value: result?.submittedAt || result?.submitted_at ? new Date(result.submittedAt || result.submitted_at).toLocaleString() : "N/A",
      },
    ],
    [result, summary]
  );

  const timeSpentSeconds = toNumber(summary?.timeSpentSeconds ?? summary?.time_taken ?? result?.timeSpentSeconds ?? result?.time_taken, 0);

  if (resultQuery.isLoading) {
    return <LoadingState fullScreen label="Loading submission..." />;
  }

  if (resultQuery.isError && !submissionState) {
    return (
      <section className="grid min-h-screen place-items-center bg-background p-4">
        <div className="w-full max-w-lg space-y-4">
          <ErrorState title="Unable to load submission" description={resultQuery.error?.message || "Please try again in a moment."} />
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button type="button" variant="outline" className={ui.btn} onClick={() => navigate("/tests/ongoing")}>Back to On-Going Tests</Button>
            <Button type="button" className={ui.btn} onClick={() => navigate(`/results/${submissionId}`)}>Open Result Details</Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <article className="w-full max-w-lg text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-success/12 ring-8 ring-success/5 motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:fade-in motion-safe:duration-300">
          <Check className="size-8 text-success" strokeWidth={2.5} aria-hidden="true" />
        </div>

        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-text-primary">Assessment Submitted</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-text-secondary sm:text-base">
          You have successfully submitted the assessment. Your hard work is now being processed.
        </p>

        <dl className={cn(ui.card, "mt-8 grid grid-cols-2 divide-x divide-border text-left")}>
          <div className="flex items-center gap-3 p-4">
            <Clock3 className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-xs text-text-secondary">Time spent</dt>
              <dd className="text-base font-semibold tabular-nums text-text-primary">{Math.round(timeSpentSeconds / 60)} Minutes</dd>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4">
            <FileDigit className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-xs text-text-secondary">Submission ID</dt>
              <dd className="truncate font-mono text-sm font-semibold text-text-primary" title={submissionId}>#{submissionId}</dd>
            </div>
          </div>
        </dl>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button type="button" className="h-11 rounded-lg px-5" onClick={() => navigate(`/results/${submissionId}`)}>
            View Detailed Results
            <ArrowRight className="size-4" />
          </Button>
          <Button asChild variant="outline" className="h-11 rounded-lg px-5">
            <Link to="/tests/ongoing">Back to On-Going Tests</Link>
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          className="mt-4 h-10 rounded-lg px-3 text-sm text-text-secondary"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((prev) => !prev)}
        >
          {showDetails ? "Hide Submission Details" : "View Submission Details"}
          <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", showDetails ? "rotate-180" : "")} />
        </Button>

        {showDetails ? (
          <div className={cn(ui.card, "mt-2 p-5 text-left")}>
            <h3 className="text-sm font-semibold text-text-primary">Submission snapshot</h3>
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {detailRows.map((row) => (
                <div key={row.label}>
                  <dt className="text-xs text-text-secondary">{row.label}</dt>
                  <dd className="mt-0.5 text-sm font-medium text-text-primary">{row.value}</dd>
                </div>
              ))}
            </dl>
            {!submissionState && resultQuery.isError ? (
              <p className="mt-3 text-xs text-text-secondary">Detailed data is unavailable after page refresh. Open Results for the full review.</p>
            ) : null}
          </div>
        ) : null}
      </article>
    </section>
  );
}
