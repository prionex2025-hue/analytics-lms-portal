import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateLabel } from "@/components/Reports/utils";

const formatViolationType = (type) => String(type || "UNKNOWN").replace(/_/g, " ").toLowerCase();

const ACTION_TONE_CLASS = {
  neutral: "rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60",
  danger: "rounded-full bg-danger px-3 py-1 text-xs font-medium text-white disabled:opacity-60",
};

const EMPTY_REVIEW = { eventKey: "", reason: "", submitting: false, error: "" };

// Shared by the admin/college-admin and super-admin report pages. Each page
// supplies its own review actions (admins escalate; the super admin, as final
// reviewer, confirms) and an onReview that calls its portal's API. onReview
// should throw on failure; on success the dialog closes itself. `note` is
// optional context shown above the events (e.g. the admin's escalation reason).
export default function ViolationReviewDialog({ open, onOpenChange, studentName, events = [], actions = [], onReview, title = "Violation Details", note = null }) {
  const [review, setReview] = useState(EMPTY_REVIEW);

  useEffect(() => {
    if (open) setReview(EMPTY_REVIEW);
  }, [open]);

  const submit = async (event, eventKey, action) => {
    const reason = review.eventKey === eventKey ? review.reason.trim() : "";
    if (!event?.testId || !event?.anomalyId || !event?.anomalyType || !reason) {
      setReview((prev) => ({ ...prev, eventKey, error: "A reason is required before submitting a review." }));
      return;
    }
    setReview((prev) => ({ ...prev, eventKey, submitting: true, error: "" }));
    try {
      await onReview({ testId: event.testId, anomalyId: event.anomalyId, anomalyType: event.anomalyType, action, reason });
      onOpenChange(false);
    } catch (_error) {
      setReview((prev) => ({ ...prev, submitting: false, error: "Unable to save review. Please try again." }));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{studentName || "Student"} - exam-time violations captured by proctoring.</DialogDescription>
        </DialogHeader>

        {note ? <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-text-primary">{note}</div> : null}

        {events.length === 0 ? (
          <div className="rounded-xl border border-border bg-background p-4 text-sm text-text-secondary">
            No detailed violation events available for this student in the current report scope.
          </div>
        ) : (
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {events.map((event, index) => {
              const eventKey = event.anomalyId || event.id || `${event.submissionId || "submission"}-${index}`;
              const isCurrent = review.eventKey === eventKey;
              const reviewable = Boolean(event.testId && event.anomalyId && event.anomalyType) && actions.length > 0;
              return (
                <div key={eventKey} className="rounded-xl border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold capitalize text-text-primary">{formatViolationType(event.type || event.anomalyType)}</p>
                    <p className="text-xs text-text-secondary">{formatDateLabel(event.createdAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">Test: {event.testName || "-"}</p>
                  <div className="mt-3 space-y-2">
                    {reviewable ? (
                      <>
                        <textarea
                          value={isCurrent ? review.reason : ""}
                          onChange={(changeEvent) => setReview({ ...EMPTY_REVIEW, eventKey, reason: changeEvent.target.value })}
                          placeholder="Review reason"
                          className="min-h-18 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary"
                        />
                        <div className="flex flex-wrap justify-end gap-2">
                          {actions.map((action) => (
                            <button
                              key={action.value}
                              type="button"
                              disabled={isCurrent && review.submitting}
                              onClick={() => submit(event, eventKey, action.value)}
                              className={ACTION_TONE_CLASS[action.tone] || ACTION_TONE_CLASS.neutral}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {isCurrent && review.error ? <p className="text-xs text-danger">{review.error}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
