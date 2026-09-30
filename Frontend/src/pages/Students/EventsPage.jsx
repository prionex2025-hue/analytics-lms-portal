import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EventsSkeleton } from "@/components/common/page-skeletons";
import LazyImage from "@/components/common/LazyImage";
import { toast } from "sonner";
import { CalendarDays, CalendarX2, Clock3, ExternalLink, Globe2, ImageOff, MapPin, Ticket, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, MetaItem, PageHeader, SegmentedControl, StatusBadge } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { eventsQueryOptions } from "@/services/studentQueries";
import { ui } from "@/styles/ui-tokens";
import { sanitizeText } from "@/lib/security";
import { optimizeCloudinaryImage } from "@/lib/cloudinary";

const CATEGORY_TABS = [
  { value: "ALL", label: "All", eventType: null },
  { value: "HACKATHON", label: "Hackathon", eventType: "Hackathon" },
  { value: "SYMPOSIUM", label: "Symposium", eventType: "Symposium" },
  { value: "CULTURAL", label: "Cultural", eventType: "Cultural" },
  { value: "OTHER", label: "Other", eventType: "Other" },
];

const STATE_TONE = {
  OPEN: "success",
  REGISTERED: "info",
  FULL: "warning",
  CLOSED: "neutral",
  CANCELLED: "danger",
};

const formatEventDate = (value, withTime = false) => {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() === 0) return "TBA";
  return date.toLocaleString([], withTime
    ? { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};

const toMs = (value) => {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const getEventState = (event) => {
  const now = Date.now();
  const deadlineMs = toMs(event?.registration_deadline || event?.registrationDeadline);
  const availableSpots = Number(event?.available_spots ?? event?.availableSpots ?? event?.spotsLeft ?? 0);
  const registrationStatus = String(event?.status || event?.registrationStatus || "").toUpperCase();
  const isRegistered = event?.is_registered || event?.registered || registrationStatus === "REGISTERED";

  if (isRegistered) {
    return "REGISTERED";
  }

  if (event?.is_cancelled || event?.cancelled) {
    return "CANCELLED";
  }

  if (availableSpots <= 0) {
    return "FULL";
  }

  if (deadlineMs > 0 && now > deadlineMs) {
    return "CLOSED";
  }

  return "OPEN";
};

export default function EventsPage() {
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const eventsQuery = useQuery(eventsQueryOptions());
  const eventItems = eventsQuery.data?.items;

  const events = useMemo(
    () => (Array.isArray(eventItems) ? eventItems : []),
    [eventItems]
  );

  const navigateToRegistrationLink = (event) => {
    const registrationUrl = String(event?.registrationUrl || event?.registration_url || "").trim();
    if (!registrationUrl) {
      toast.error("Registration link is not available for this event.");
      return;
    }

    window.location.assign(registrationUrl);
  };

  const openEventDetails = (event) => {
    setSelectedEvent(event || null);
    setDetailsOpen(true);
  };

  const renderEventScope = (event) => {
    const scope = String(event?.visibilityScope || "").toUpperCase();
    if (scope === "INTER_COLLEGE" || event?.isInterCollege) {
      return "Inter-college";
    }
    return "College-only";
  };

  const renderEventStateLabel = (event) => {
    const state = getEventState(event);
    if (state === "OPEN") return "Open";
    if (state === "REGISTERED") return "Registered";
    if (state === "FULL") return "Full";
    if (state === "CLOSED") return "Closed";
    return "Cancelled";
  };

  const getEventImageUrl = (event, options) =>
    optimizeCloudinaryImage(event?.imageUrl || event?.image_url || "", options);

  const filteredEvents = useMemo(() => {
    const selected = CATEGORY_TABS.find((item) => item.value === activeCategory);

    if (!selected?.eventType) return events;

    return events.filter((event) =>
      String(event.eventType || "").toLowerCase() === selected.eventType.toLowerCase()
    );
  }, [events, activeCategory]);

  const header = (
    <PageHeader
      title="Events"
      description="Hackathons, symposiums, cultural fests and more — curated for your campus."
    />
  );

  if (eventsQuery.isLoading) {
    return <EventsSkeleton />;
  }

  if (eventsQuery.isError) {
    return (
      <section className={ui.pageSection}>
        {header}
        <ErrorState
          title="Unable to load events"
          description={eventsQuery.error?.message || "Please try again in a moment."}
          onRetry={() => eventsQuery.refetch()}
        />
      </section>
    );
  }

  const categoryCounts = CATEGORY_TABS.reduce((acc, item) => {
    acc[item.value] = item.eventType
      ? events.filter((event) => String(event.eventType || "").toLowerCase() === item.eventType.toLowerCase()).length
      : events.length;
    return acc;
  }, {});

  const selectedState = selectedEvent ? getEventState(selectedEvent) : null;

  return (
    <section className={ui.pageSection}>
      {header}

      <div className="relative -mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">
        <SegmentedControl
          label="Event category"
          value={activeCategory}
          onChange={setActiveCategory}
          className="w-max flex-nowrap sm:w-auto"
          options={CATEGORY_TABS.map((item) => ({
            value: item.value,
            label: `${item.label} (${categoryCounts[item.value] || 0})`,
          }))}
        />
      </div>

      {filteredEvents.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No events found"
          description={activeCategory === "ALL" ? "New events will show up here once they're published." : "There are no events in this category right now."}
          action={
            activeCategory !== "ALL" ? (
              <Button variant="outline" className={ui.btn} onClick={() => setActiveCategory("ALL")}>
                Show all events
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredEvents.map((event) => {
            const state = getEventState(event);
            const imageUrl = getEventImageUrl(event, { width: 960, height: 540, crop: "fill" });
            const spots = Number(event.available_spots ?? event.availableSpots ?? event.spotsLeft ?? 0);
            const blocked = ["REGISTERED", "FULL", "CLOSED", "CANCELLED"].includes(state);

            return (
              <li key={event.id} className={cn(ui.cardInteractive, "group relative flex flex-col overflow-hidden")}>
                <div className="relative aspect-video w-full overflow-hidden bg-muted">
                  {imageUrl ? (
                    <LazyImage
                      src={imageUrl}
                      alt=""
                      width="960"
                      height="540"
                      className="size-full object-cover"
                      fallback={<div className="grid size-full place-items-center text-text-secondary"><ImageOff className="size-6" /></div>}
                    />
                  ) : (
                    <div className="grid size-full place-items-center bg-linear-to-br from-primary/10 to-muted text-primary/60">
                      <CalendarDays className="size-8" aria-hidden="true" />
                    </div>
                  )}
                  <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-card/95 px-2.5 py-1 text-xs font-medium text-text-primary shadow-sm backdrop-blur">
                      {sanitizeText(event.eventType || event.type || "Other")}
                    </span>
                  </div>
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-base font-semibold leading-snug text-text-primary">
                      <button
                        type="button"
                        onClick={() => openEventDetails(event)}
                        className="text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
                      >
                        {sanitizeText(event.title || event.name)}
                      </button>
                    </h3>
                    <StatusBadge tone={STATE_TONE[state]}>{renderEventStateLabel(event)}</StatusBadge>
                  </div>
                  {event.description ? (
                    <p className="mt-1.5 line-clamp-2 text-sm text-text-secondary">{sanitizeText(event.description)}</p>
                  ) : null}

                  <div className="mt-3 grid gap-1.5">
                    <MetaItem icon={CalendarDays}>{formatEventDate(event.date || event.startsAt)}</MetaItem>
                    <MetaItem icon={MapPin}><span className="line-clamp-1">{sanitizeText(event.venue || "TBA")}</span></MetaItem>
                    <MetaItem icon={Clock3}>Register by {formatEventDate(event.registration_deadline || event.registrationDeadline || event.startsAt, true)}</MetaItem>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                    <MetaItem icon={Users} className={spots <= 5 && spots > 0 ? "text-amber-700" : ""}>
                      {spots} {spots === 1 ? "spot" : "spots"} left
                    </MetaItem>
                    <Button
                      type="button"
                      className={cn(ui.btn, "relative z-10")}
                      disabled={blocked}
                      variant={blocked ? "outline" : "default"}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        navigateToRegistrationLink(event);
                      }}
                    >
                      {state === "REGISTERED" ? "Registered" : "Register"}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-6 text-xl">{sanitizeText(selectedEvent?.title || "Event Details")}</DialogTitle>
            <DialogDescription>Review complete event information before registration.</DialogDescription>
          </DialogHeader>

          {selectedEvent ? (
            <div className="grid gap-4 text-sm">
              {getEventImageUrl(selectedEvent, { width: 1280, height: 720, crop: "fill" }) ? (
                <LazyImage
                  src={getEventImageUrl(selectedEvent, { width: 1280, height: 720, crop: "fill" })}
                  alt={sanitizeText(selectedEvent.title || "Event Details")}
                  width="1280"
                  height="720"
                  className="aspect-video w-full rounded-lg object-cover"
                />
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="info">{sanitizeText(selectedEvent.eventType || selectedEvent.type || "Other")}</StatusBadge>
                <StatusBadge tone="neutral" icon={Globe2}>{renderEventScope(selectedEvent)}</StatusBadge>
                <StatusBadge tone={STATE_TONE[selectedState]}>{renderEventStateLabel(selectedEvent)}</StatusBadge>
              </div>

              <p className="leading-6 text-text-secondary">{sanitizeText(selectedEvent.description || "No description provided.")}</p>

              <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border p-4 sm:grid-cols-2">
                {[
                  ["Start", formatEventDate(selectedEvent.startsAt || selectedEvent.date, true)],
                  ["End", selectedEvent.endsAt ? formatEventDate(selectedEvent.endsAt, true) : "Not specified"],
                  ["Event date", formatEventDate(selectedEvent.eventDate || selectedEvent.startsAt)],
                  ["Registration deadline", formatEventDate(selectedEvent.registrationDeadline || selectedEvent.registration_deadline || selectedEvent.startsAt, true)],
                  ["Venue", sanitizeText(selectedEvent.location || selectedEvent.venue || "TBA")],
                  ["Capacity", `${Number(selectedEvent.registrationLimit || 0)} total`],
                  ["Available spots", Number(selectedEvent.available_spots ?? selectedEvent.availableSpots ?? selectedEvent.spotsLeft ?? 0)],
                  ["Registration link", selectedEvent.registrationUrl || selectedEvent.registration_url ? "Available" : "Not available"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-text-secondary">{label}</dt>
                    <dd className="mt-0.5 font-medium text-text-primary">{value}</dd>
                  </div>
                ))}
              </dl>

              {Array.isArray(selectedEvent.registrationFields) && selectedEvent.registrationFields.length > 0 ? (
                <div>
                  <p className="mb-2 text-sm font-medium text-text-primary">Registration asks for</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedEvent.registrationFields.map((field, index) => (
                      <span key={`${field?.key || field?.label || "field"}-${index}`} className="rounded-full bg-muted px-3 py-1 text-xs text-text-secondary">
                        {sanitizeText(field?.label || field?.key || "Field")} ({sanitizeText(field?.type || "text")}){field?.required ? " *" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedEvent ? (
            <DialogFooter>
              <Button variant="outline" className={ui.btn} onClick={() => setDetailsOpen(false)}>Close</Button>
              <Button
                className={ui.btn}
                disabled={["REGISTERED", "FULL", "CLOSED", "CANCELLED"].includes(selectedState)}
                onClick={() => navigateToRegistrationLink(selectedEvent)}
              >
                {selectedState === "REGISTERED" ? <Ticket className="size-4" /> : selectedState === "CANCELLED" ? <CalendarX2 className="size-4" /> : <ExternalLink className="size-4" />}
                {selectedState === "REGISTERED" ? "Registered" : "Register"}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
