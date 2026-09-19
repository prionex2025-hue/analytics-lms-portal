import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EventsSkeleton } from "@/components/common/page-skeletons";
import LazyImage from "@/components/common/LazyImage";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  if (eventsQuery.isLoading) {
    return <EventsSkeleton />;
  }

  if (eventsQuery.isError) {
    return <div className="py-10 text-center text-sm text-text-secondary">{eventsQuery.error?.message || "Unable to load events."}</div>;
  }

  return (
    <section className={ui.pageSection}>
      <article className="relative overflow-hidden rounded-3xl bg-linear-to-r from-primary via-primary-dark to-primary-dark p-7 text-primary-foreground shadow-[0_18px_35px_-18px_rgba(11,84,158,0.6)]">
        <div className="max-w-md">
          <p className="text-xs font-semibold tracking-[0.16em] text-primary-foreground/90 uppercase">Featured Event</p>
          <h2 className="mt-2 text-5xl leading-[0.96] font-semibold tracking-tight">Discover Events</h2>
          <p className="mt-3 text-lg text-primary-foreground/90">Join hackathons, workshops, symposiums and community events curated for your track.</p>
          <Button className="mt-6 h-10 rounded-xl bg-card px-4 font-semibold text-primary">
            Register Now
          </Button>
        </div>
      </article>

      <Tabs value={activeCategory} onValueChange={setActiveCategory}>
        <TabsList>
          {CATEGORY_TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="px-3 text-sm data-active:bg-primary data-active:text-primary-foreground">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filteredEvents.map((event) => (
          <Card key={event.id} className={`${ui.cardPadding} cursor-pointer`} onClick={() => openEventDetails(event)}>
            {getEventImageUrl(event, { width: 960, height: 540, crop: "fill" }) ? (
              <LazyImage
                src={getEventImageUrl(event, { width: 960, height: 540, crop: "fill" })}
                alt={sanitizeText(event.title || event.name || "Event")}
                width="960"
                height="540"
                className="h-44 w-full rounded-xl object-cover"
                fallback={<div className="h-44 rounded-xl bg-linear-to-br from-primary/15 via-background to-muted" />}
              />
            ) : (
              <div className="h-44 rounded-xl bg-linear-to-br from-primary/15 via-background to-muted" />
            )}

            <div className="mt-3 rounded-xl bg-linear-to-r from-background to-muted p-3">
              <Badge className="bg-primary/15 text-[11px] font-semibold text-primary uppercase" variant="secondary">
                {sanitizeText(event.eventType || event.type || "Other")}
              </Badge>
              <h3 className="mt-3 text-lg leading-tight font-semibold text-text-primary">{sanitizeText(event.title || event.name)}</h3>
              <p className="mt-2 text-sm text-text-secondary">{sanitizeText(event.description || "")}</p>
            </div>

            <div className="mt-3 grid gap-1 text-xs text-text-secondary">
              <p>Date: {new Date(event.date || event.startsAt).toLocaleDateString()}</p>
              <p>Venue: {sanitizeText(event.venue || "TBA")}</p>
              <p>Registration Deadline: {new Date(event.registration_deadline || event.registrationDeadline || event.startsAt).toLocaleString()}</p>
              <p>Available Spots: {Number(event.available_spots ?? event.availableSpots ?? event.spotsLeft ?? 0)}</p>
            </div>

            <Button
              type="button"
              className="mt-4 h-9 w-full rounded-lg bg-primary text-sm font-semibold shadow-md shadow-primary/20 hover:bg-primary-dark"
              disabled={["REGISTERED", "FULL", "CLOSED", "CANCELLED"].includes(getEventState(event))}
              variant={["REGISTERED", "FULL", "CLOSED", "CANCELLED"].includes(getEventState(event)) ? "outline" : "default"}
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                navigateToRegistrationLink(event);
              }}
            >
              {getEventState(event) === "REGISTERED" ? "Registered" : "Register"}
            </Button>
          </Card>
        ))}
        {!eventsQuery.isLoading && filteredEvents.length === 0 ? (
          <Card className={`${ui.cardPadding} col-span-full text-center text-sm text-text-secondary`}>
            No events found for this category.
          </Card>
        ) : null}
      </div>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{sanitizeText(selectedEvent?.title || "Event Details")}</DialogTitle>
            <DialogDescription>
              Review complete event information before registration.
            </DialogDescription>
          </DialogHeader>

          {selectedEvent ? (
            <div className="grid gap-3 text-sm">
              {getEventImageUrl(selectedEvent, { width: 1280, height: 720, crop: "fill" }) ? (
                <LazyImage
                  src={getEventImageUrl(selectedEvent, { width: 1280, height: 720, crop: "fill" })}
                  alt={sanitizeText(selectedEvent.title || "Event Details")}
                  width="1280"
                  height="720"
                  className="h-56 w-full rounded-2xl object-cover"
                />
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="bg-primary/15 text-primary">{sanitizeText(selectedEvent.eventType || selectedEvent.type || "Other")}</Badge>
                <Badge variant="outline">{renderEventScope(selectedEvent)}</Badge>
                <Badge variant="outline">{renderEventStateLabel(selectedEvent)}</Badge>
              </div>

              <p className="text-text-secondary">{sanitizeText(selectedEvent.description || "No description provided.")}</p>

              <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
                <p><span className="font-medium text-text-primary">Start:</span> {new Date(selectedEvent.startsAt || selectedEvent.date || 0).toLocaleString()}</p>
                <p><span className="font-medium text-text-primary">End:</span> {selectedEvent.endsAt ? new Date(selectedEvent.endsAt).toLocaleString() : "Not specified"}</p>
                <p><span className="font-medium text-text-primary">Event Date:</span> {new Date(selectedEvent.eventDate || selectedEvent.startsAt || 0).toLocaleDateString()}</p>
                <p><span className="font-medium text-text-primary">Registration Deadline:</span> {new Date(selectedEvent.registrationDeadline || selectedEvent.registration_deadline || selectedEvent.startsAt || 0).toLocaleString()}</p>
                <p><span className="font-medium text-text-primary">Venue:</span> {sanitizeText(selectedEvent.location || selectedEvent.venue || "TBA")}</p>
                <p><span className="font-medium text-text-primary">Capacity:</span> {Number(selectedEvent.registrationLimit || 0)} total</p>
                <p><span className="font-medium text-text-primary">Available Spots:</span> {Number(selectedEvent.available_spots ?? selectedEvent.availableSpots ?? selectedEvent.spotsLeft ?? 0)}</p>
                <p><span className="font-medium text-text-primary">Registration Link:</span> {selectedEvent.registrationUrl || selectedEvent.registration_url ? "Available" : "Not available"}</p>
              </div>

              {Array.isArray(selectedEvent.registrationFields) && selectedEvent.registrationFields.length > 0 ? (
                <div className="rounded-xl border border-border p-3">
                  <p className="mb-2 font-medium text-text-primary">Registration Fields</p>
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
        </DialogContent>
      </Dialog>
    </section>
  );
}
