import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock3, FileDigit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { attemptResultQueryOptions } from "@/services/studentQueries";

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
    return <div className="grid min-h-[80vh] place-items-center text-text-secondary">Loading submission...</div>;
  }

  if (resultQuery.isError && !submissionState) {
    return (
      <section className="grid min-h-[80vh] place-items-center p-4">
        <Card className="w-full max-w-2xl rounded-2xl p-6 text-center">
          <Alert variant="destructive" className="border-danger/30 bg-danger/10 text-danger text-left">
            <AlertTitle>Unable to load submission</AlertTitle>
            <AlertDescription>{resultQuery.error?.message || "Please try again in a moment."}</AlertDescription>
          </Alert>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button type="button" variant="outline" onClick={() => navigate("/tests/ongoing")}>Back to On-Going Tests</Button>
            <Button type="button" onClick={() => navigate(`/results/${submissionId}`)}>Open Result Details</Button>
          </div>
        </Card>
      </section>
    );
  }

  return (
    <section className="grid min-h-[80vh] place-items-center bg-background p-4">
      <article className="w-full max-w-2xl text-center">
        <div className="mx-auto grid size-24 place-items-center rounded-3xl bg-card shadow-[0_18px_35px_-24px_rgba(18,33,73,0.42)] ring-1 ring-slate-100 sm:size-30">
          <div className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground sm:size-18">
            <Check className="size-10" />
          </div>
        </div>

        <h1 className="mt-6 text-4xl leading-[0.95] font-semibold tracking-tight text-primary-dark sm:mt-8 sm:text-6xl">Assessment Submitted</h1>
        <p className="mx-auto mt-3 max-w-md text-base text-text-secondary sm:text-xl">
          You have successfully submitted the assessment. Your hard work is now being processed.
        </p>

        <div className="mx-auto mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-2xl bg-card p-4 text-left shadow-[0_18px_35px_-24px_rgba(18,33,73,0.42)] ring-1 ring-slate-100">
            <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary"><Clock3 className="size-5" /></div>
            <div>
              <p className="text-xs tracking-wide text-text-secondary uppercase">Time Spent</p>
              <p className="text-lg font-semibold text-text-primary">{Math.round(timeSpentSeconds / 60)} Minutes</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-card p-4 text-left shadow-[0_18px_35px_-24px_rgba(18,33,73,0.42)] ring-1 ring-slate-100">
            <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary"><FileDigit className="size-5" /></div>
            <div>
              <p className="text-xs tracking-wide text-text-secondary uppercase">Submission ID</p>
              <p className="text-lg font-semibold text-text-primary">#{submissionId}</p>
            </div>
          </div>
        </div>

        <Button
          type="button"
          className="mt-8 mx-4 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark"
          onClick={() => navigate(`/results/${submissionId}`)}
        >
          View Detailed Results
        </Button>

        <Link
          to="/tests/ongoing"
          className="mt-4  mx-4 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark"
        >
          Back to On-Going Tests
        </Link>

        <Button
          type="button"
          variant="outline"
          className="mt-4 mx-4 h-10 rounded-xl border-primary/30 text-sm font-semibold text-primary-dark"
          onClick={() => setShowDetails((prev) => !prev)}
        >
          {showDetails ? "Hide Submission Details" : "View Submission Details"}
        </Button>

        {showDetails ? (
          <div className="mt-4 rounded-2xl bg-card p-5 text-left shadow-[0_18px_35px_-24px_rgba(18,33,73,0.42)] ring-1 ring-slate-100">
            <h3 className="text-base font-semibold text-text-primary">Submission Snapshot</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {detailRows.map((row) => (
                <div key={row.label} className="rounded-lg bg-background px-3 py-2">
                  <p className="text-[11px] font-semibold tracking-wide text-text-secondary uppercase">{row.label}</p>
                  <p className="mt-1 text-sm font-medium text-text-primary">{row.value}</p>
                </div>
              ))}
            </div>
            {!submissionState && resultQuery.isError ? (
              <p className="mt-3 text-xs text-text-secondary">Detailed data is unavailable after page refresh. Open Results for the full review.</p>
            ) : null}
          </div>
        ) : null}
      </article>
    </section>
  );
}
