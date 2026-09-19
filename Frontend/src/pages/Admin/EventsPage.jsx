import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import { validateImageFile } from "@/lib/image";
import { optimizeCloudinaryImage } from "@/lib/cloudinary";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";

const EVENT_TYPES = ["Workshop", "Hackathon", "Symposium", "Other"];
const EVENT_PAGE_SIZE = 8;
const REGISTRANT_PAGE_SIZE = 10;
const EMPTY_FORM = {
  title: "",
  description: "",
  eventType: "Workshop",
  visibilityScope: "COLLEGE_ONLY",
  feeType: "free",
  registrationFee: "",
  startsAt: "",
  endsAt: "",
  eventDate: "",
  registrationDeadline: "",
  location: "",
  registrationLimit: 100,
  registrationUrl: "",
  registrationFields: [],
};

const toDateTimeLocalValue = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
};

const toDateInputValue = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
};

const getEventStatus = (event) => {
  if (event?.isCancelled) return "CANCELLED";
  const endValue = event?.endsAt || event?.eventDate || event?.startsAt;
  const endDate = endValue ? new Date(endValue) : null;
  if (endDate && !Number.isNaN(endDate.getTime()) && endDate < new Date()) return "EXPIRED";
  return "ACTIVE";
};

const extractFeeDetails = (event) => {
  const feeField = Array.isArray(event?.registrationFields)
    ? event.registrationFields.find((field) => field?.key === "registration_fee")
    : null;
  const feeType = feeField?.meta?.feeType || (Number(feeField?.meta?.amount || 0) > 0 ? "paid" : "free");
  return {
    feeType,
    registrationFee: feeType === "paid" ? String(feeField?.meta?.amount || "") : "",
  };
};

export default function EventsPage() {
  const queryClient = useQueryClient();
  const eventImageInputRef = useRef(null);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [eventPage, setEventPage] = useState(1);
  const [registrantPage, setRegistrantPage] = useState(1);
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [eventImageFile, setEventImageFile] = useState(null);
  const [eventImagePreview, setEventImagePreview] = useState("");
  const [editingEventId, setEditingEventId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const canManageEvents = usePermission(ADMIN_PERMISSIONS.MANAGE_EVENTS);
  const canViewEvents = usePermission(ADMIN_PERMISSIONS.VIEW_EVENTS) || canManageEvents;

  useEffect(() => {
    return () => {
      if (eventImagePreview?.startsWith("blob:")) {
        URL.revokeObjectURL(eventImagePreview);
      }
    };
  }, [eventImagePreview]);

  const eventsQuery = useQuery({ queryKey: ["admin-events"], queryFn: adminApi.getEvents, enabled: canViewEvents });
  const selectedEventQuery = useQuery({
    queryKey: ["admin-event-registrants", selectedEventId],
    queryFn: () => adminApi.getEventRegistrants(selectedEventId),
    enabled: Boolean(selectedEventId) && canViewEvents,
  });

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingEventId("");
    if (eventImagePreview?.startsWith("blob:")) {
      URL.revokeObjectURL(eventImagePreview);
    }
    setEventImageFile(null);
    setEventImagePreview("");
    if (eventImageInputRef.current) {
      eventImageInputRef.current.value = "";
    }
  };

  const createMutation = useMutation({
    mutationFn: adminApi.createEvent,
    onSuccess: () => {
      toast.success("Event created.");
      setBanner({ type: "success", title: "Event created", message: "The event is published and visible in the list." });
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Create failed", message: error?.message || "Please validate event fields and retry." });
      toast.error(error?.message || "Failed to create event.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ eventId, payload }) => adminApi.updateEvent(eventId, payload),
    onSuccess: () => {
      toast.success("Event updated.");
      setBanner({ type: "success", title: "Event updated", message: "The event details were saved successfully." });
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Update failed", message: error?.message || "Unable to update this event." });
      toast.error(error?.message || "Failed to update event.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminApi.deleteEvent,
    onSuccess: (_data, eventId) => {
      toast.success("Event deleted.");
      setBanner({ type: "success", title: "Event deleted", message: "The event was removed from the college events list." });
      if (selectedEventId === eventId) setSelectedEventId("");
      if (editingEventId === eventId) resetForm();
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Delete failed", message: error?.message || "Unable to delete this event." });
      toast.error(error?.message || "Failed to delete event.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ eventId, reason }) => adminApi.cancelEvent(eventId, { reason }),
    onSuccess: () => {
      toast.success("Event cancelled.");
      setBanner({ type: "success", title: "Event cancelled", message: "Cancellation reason saved successfully." });
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["admin-event-registrants", selectedEventId] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Cancellation failed", message: error?.message || "Unable to cancel this event." });
      toast.error(error?.message || "Failed to cancel event.");
    },
  });

  const events = useMemo(() => eventsQuery.data || [], [eventsQuery.data]);
  const pagedEvents = useMemo(() => {
    const start = (eventPage - 1) * EVENT_PAGE_SIZE;
    return events.slice(start, start + EVENT_PAGE_SIZE);
  }, [eventPage, events]);
  const totalEventPages = Math.max(1, Math.ceil(events.length / EVENT_PAGE_SIZE));

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) || null, [events, selectedEventId]);
  const registrants = useMemo(() => selectedEventQuery.data?.registrants || [], [selectedEventQuery.data]);
  const pagedRegistrants = useMemo(() => {
    const start = (registrantPage - 1) * REGISTRANT_PAGE_SIZE;
    return registrants.slice(start, start + REGISTRANT_PAGE_SIZE);
  }, [registrantPage, registrants]);
  const totalRegistrantPages = Math.max(1, Math.ceil(registrants.length / REGISTRANT_PAGE_SIZE));

  const startEdit = (event) => {
    const feeDetails = extractFeeDetails(event);
    setEditingEventId(event.id);
    setForm({
      title: event.title || "",
      description: event.description || "",
      eventType: event.eventType || "Workshop",
      visibilityScope: event.visibilityScope || (event.isInterCollege ? "INTER_COLLEGE" : "COLLEGE_ONLY"),
      feeType: feeDetails.feeType,
      registrationFee: feeDetails.registrationFee,
      startsAt: toDateTimeLocalValue(event.startsAt),
      endsAt: toDateTimeLocalValue(event.endsAt),
      eventDate: toDateInputValue(event.eventDate),
      registrationDeadline: toDateInputValue(event.registrationDeadline),
      location: event.location || "",
      registrationLimit: Number(event.registrationLimit || 100),
      registrationUrl: event.registrationUrl || "",
      registrationFields: Array.isArray(event.registrationFields) ? event.registrationFields.filter((field) => field?.key !== "registration_fee") : [],
    });
    if (eventImagePreview?.startsWith("blob:")) {
      URL.revokeObjectURL(eventImagePreview);
    }
    setEventImageFile(null);
    setEventImagePreview("");
    if (eventImageInputRef.current) {
      eventImageInputRef.current.value = "";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const buildEventPayload = () => {
    const eventDateIso = form.eventDate ? new Date(`${form.eventDate}T00:00:00`).toISOString() : undefined;
    const deadlineIso = form.registrationDeadline ? new Date(`${form.registrationDeadline}T00:00:00`).toISOString() : undefined;
    const registrationFee = form.feeType === "paid" ? Number(form.registrationFee || 0) : 0;
    const registrationFields = Array.isArray(form.registrationFields)
      ? form.registrationFields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: Boolean(field.required),
          options: Array.isArray(field.options) ? field.options : [],
        }))
      : [];

    // Persist fee metadata in existing JSON field without requiring DB schema changes.
    registrationFields.push({
      key: "registration_fee",
      label: "Registration Fee",
      type: "number",
      required: false,
      options: [],
      meta: {
        feeType: form.feeType,
        amount: registrationFee,
      },
    });

    const payload = {
      ...form,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      eventDate: eventDateIso,
      registrationDeadline: deadlineIso,
      registrationUrl: form.registrationUrl?.trim() ? form.registrationUrl.trim() : null,
      visibilityScope: form.visibilityScope,
      feeType: form.feeType,
      registrationFee,
      registrationFields,
      maxParticipants: Number(form.registrationLimit),
    };

    const formData = new FormData();
    formData.append("title", payload.title);
    formData.append("description", payload.description);
    formData.append("eventType", payload.eventType);
    formData.append("startsAt", payload.startsAt || "");
    formData.append("visibilityScope", payload.visibilityScope);
    formData.append("feeType", payload.feeType);
    formData.append("registrationFee", String(payload.registrationFee));
    formData.append("registrationLimit", String(payload.registrationLimit));
    formData.append("maxParticipants", String(payload.maxParticipants));
    formData.append("registrationFields", JSON.stringify(payload.registrationFields));

    if (payload.endsAt) formData.append("endsAt", payload.endsAt);
    if (payload.eventDate) formData.append("eventDate", payload.eventDate);
    if (payload.registrationDeadline) formData.append("registrationDeadline", payload.registrationDeadline);
    if (payload.location) formData.append("location", payload.location);
    if (payload.registrationUrl) formData.append("registrationUrl", payload.registrationUrl);
    if (eventImageFile) {
      formData.append("eventImage", eventImageFile);
    }

    return formData;
  };

  const saveEvent = () => {
    const payload = buildEventPayload();
    if (editingEventId) {
      updateMutation.mutate({ eventId: editingEventId, payload });
      return;
    }
    createMutation.mutate(payload);
  };

  const onEventImageSelected = (event) => {
    const file = event.target.files?.[0];
    const validationError = validateImageFile(file, { label: "Event image" });

    if (validationError) {
      if (eventImagePreview?.startsWith("blob:")) {
        URL.revokeObjectURL(eventImagePreview);
      }
      setEventImageFile(null);
      setEventImagePreview("");
      toast.error(validationError);
      event.target.value = "";
      return;
    }

    if (eventImagePreview?.startsWith("blob:")) {
      URL.revokeObjectURL(eventImagePreview);
    }

    setEventImageFile(file || null);
    setEventImagePreview(file ? URL.createObjectURL(file) : "");
  };

  const downloadCsv = async () => {
    if (!selectedEventId) return;
    const csv = await adminApi.exportEventRegistrants(selectedEventId);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `event-${selectedEventId}-registrants.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!canViewEvents) {
    return <PermissionDenied action="access events" />;
  }

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"} className={banner.type === "warning" ? "border-warning/30 bg-warning/10 text-warning" : ""}>
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      {canManageEvents ? (
        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>{editingEventId ? "Edit Event" : "Create Event"}</CardTitle>
            <CardDescription>Event date/deadline with custom registration fields and participant cap.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="event-title" className="text-sm font-medium text-text-secondary">Title</label>
            <Input id="event-title" placeholder="Title" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="event-description" className="text-sm font-medium text-text-secondary">Description</label>
            <Textarea id="event-description" placeholder="Description" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-secondary">Event photo</label>
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-background/70 p-3 sm:flex-row sm:items-center">
              <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-secondary">
                <Upload className="size-4" />
                {eventImageFile ? "Change Photo" : "Upload Photo"}
                <input
                  ref={eventImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={onEventImageSelected}
                />
              </label>
              <p className="text-xs text-text-secondary">JPG/PNG only, max 2MB. The image will be uploaded to Cloudinary.</p>
            </div>
            {eventImagePreview ? (
              <img
                src={eventImagePreview}
                alt="Event preview"
                width="640"
                height="320"
                decoding="async"
                className="h-44 w-full rounded-xl border border-border object-cover sm:h-52"
              />
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="event-type" className="text-sm font-medium text-text-secondary">Event type</label>
              <select id="event-type" className="h-10 w-full rounded-md border border-border px-3 text-sm" value={form.eventType} onChange={(event) => setForm((prev) => ({ ...prev, eventType: event.target.value }))}>
                {EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-location" className="text-sm font-medium text-text-secondary">Location</label>
              <Input id="event-location" placeholder="Location" value={form.location} onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-visibility" className="text-sm font-medium text-text-secondary">Participation scope</label>
              <select id="event-visibility" className="h-10 w-full rounded-md border border-border px-3 text-sm" value={form.visibilityScope} onChange={(event) => setForm((prev) => ({ ...prev, visibilityScope: event.target.value }))}>
                <option value="COLLEGE_ONLY">College Level Event</option>
                <option value="INTER_COLLEGE">Inter-college Event (all colleges)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-max-participants" className="text-sm font-medium text-text-secondary">Max participants</label>
              <Input id="event-max-participants" type="number" min={1} placeholder="Max participants" value={form.registrationLimit} onChange={(event) => setForm((prev) => ({ ...prev, registrationLimit: Number(event.target.value) }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-fee-type" className="text-sm font-medium text-text-secondary">Registration fees</label>
              <select id="event-fee-type" className="h-10 w-full rounded-md border border-border px-3 text-sm" value={form.feeType} onChange={(event) => setForm((prev) => ({ ...prev, feeType: event.target.value, registrationFee: event.target.value === "free" ? "" : prev.registrationFee }))}>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            {form.feeType === "paid" ? (
              <div className="space-y-1.5">
                <label htmlFor="event-registration-fee" className="text-sm font-medium text-text-secondary">Amount</label>
                <Input id="event-registration-fee" type="number" min={0} step="0.01" placeholder="Amount" value={form.registrationFee} onChange={(event) => setForm((prev) => ({ ...prev, registrationFee: event.target.value }))} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label htmlFor="event-starts-at" className="text-sm font-medium text-text-secondary">Starts at</label>
              <Input id="event-starts-at" type="datetime-local" value={form.startsAt} onChange={(event) => setForm((prev) => ({ ...prev, startsAt: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-ends-at" className="text-sm font-medium text-text-secondary">Ends at</label>
              <Input id="event-ends-at" type="datetime-local" value={form.endsAt} onChange={(event) => setForm((prev) => ({ ...prev, endsAt: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-date" className="text-sm font-medium text-text-secondary">Event date</label>
              <Input id="event-date" type="date" value={form.eventDate} onChange={(event) => setForm((prev) => ({ ...prev, eventDate: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-registration-deadline" className="text-sm font-medium text-text-secondary">Registration deadline</label>
              <Input id="event-registration-deadline" type="date" value={form.registrationDeadline} onChange={(event) => setForm((prev) => ({ ...prev, registrationDeadline: event.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="event-registration-url" className="text-sm font-medium text-text-secondary">Registration URL (optional)</label>
              <Input id="event-registration-url" placeholder="Registration URL (optional)" value={form.registrationUrl} onChange={(event) => setForm((prev) => ({ ...prev, registrationUrl: event.target.value }))} />
            </div>
          </div>

          

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveEvent} disabled={createMutation.isPending || updateMutation.isPending || !form.title || !form.startsAt || !form.eventDate || (form.feeType === "paid" && Number(form.registrationFee || 0) <= 0)}>
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingEventId ? "Save Event" : "Create Event"}
            </Button>
            {editingEventId ? (
              <Button type="button" variant="outline" onClick={resetForm}>
                <X className="size-4" />
                Cancel Edit
              </Button>
            ) : null}
          </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <Card className="rounded-2xl border-border">
          <CardHeader><CardTitle>Events</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {eventsQuery.isLoading ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-18" />
                <SkeletonBlock className="h-18" />
                <SkeletonBlock className="h-18" />
              </div>
            ) : null}
            {eventsQuery.isError ? <p className="text-sm text-danger">{eventsQuery.error?.message || "Unable to load events."}</p> : null}
            {!eventsQuery.isLoading && !eventsQuery.isError && pagedEvents.length === 0 ? <p className="text-sm text-text-secondary">No events created yet.</p> : null}
            {pagedEvents.map((event) => {
              const status = getEventStatus(event);
              const isExpired = status === "EXPIRED";

              return (
              <div
                key={event.id}
                className={`w-full rounded-xl border px-3 py-2 text-left ${selectedEventId === event.id ? "border-primary/40 bg-primary/10" : "border-border"}`}
              >
                {event.imageUrl ? (
                  <img
                    src={optimizeCloudinaryImage(event.imageUrl, { width: 640, height: 320, crop: "fill" })}
                    alt={`${event.title} cover`}
                    width="640"
                    height="320"
                    loading="lazy"
                    decoding="async"
                    className={`mb-3 h-28 w-full rounded-lg object-cover ${isExpired ? "grayscale opacity-65" : ""}`}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEventId(event.id);
                    setRegistrantPage(1);
                  }}
                  className="w-full text-left"
                >
                  <p className="font-medium text-text-primary">{event.title}</p>
                </button>
                <p className="text-xs text-text-secondary">{event.eventType} • {(event.visibilityScope || (event.isInterCollege ? "INTER_COLLEGE" : "COLLEGE_ONLY")) === "INTER_COLLEGE" ? "Inter-college" : "College-only"} • {new Date(event.startsAt).toLocaleString()} • {event.registrantCount || 0}/{event.registrationLimit}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {status !== "ACTIVE" ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-text-secondary">{status}</span> : null}
                  {canManageEvents ? (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => startEdit(event)}>
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button type="button" variant="destructive" size="sm" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(event.id)}>
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              );
            })}
            {events.length > EVENT_PAGE_SIZE ? (
              <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
                <p>Page {eventPage} of {totalEventPages}</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={eventPage <= 1} onClick={() => setEventPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={eventPage >= totalEventPages} onClick={() => setEventPage((prev) => Math.min(prev + 1, totalEventPages))}>Next</Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle>{selectedEvent ? selectedEvent.title : "Event Registrants"}</CardTitle>
            <CardDescription>
              {selectedEvent
                ? `${registrants.length} registration${registrants.length === 1 ? "" : "s"} captured for this event.`
                : "Select an event to review registrations, export attendees, or cancel the event."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedEvent ? (
              <p className="text-sm text-text-secondary">No event selected.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" disabled={selectedEventQuery.isLoading} onClick={downloadCsv}>
                    Download Registrants
                  </Button>
                  {canManageEvents && getEventStatus(selectedEvent) === "ACTIVE" ? (
                    <>
                      <Input
                        value={cancelReason}
                        onChange={(event) => setCancelReason(event.target.value)}
                        placeholder="Cancellation reason"
                        className="min-w-56 flex-1"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={!cancelReason.trim() || cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate({ eventId: selectedEventId, reason: cancelReason.trim() })}
                      >
                        {cancelMutation.isPending ? "Cancelling..." : "Cancel Event"}
                      </Button>
                    </>
                  ) : null}
                </div>

                {selectedEventQuery.isLoading ? (
                  <div className="space-y-2">
                    <SkeletonBlock className="h-12" />
                    <SkeletonBlock className="h-12" />
                  </div>
                ) : null}
                {selectedEventQuery.isError ? (
                  <p className="text-sm text-danger">{selectedEventQuery.error?.message || "Unable to load registrants."}</p>
                ) : null}
                {!selectedEventQuery.isLoading && !selectedEventQuery.isError && pagedRegistrants.length === 0 ? (
                  <p className="text-sm text-text-secondary">No registrants yet.</p>
                ) : null}
                {pagedRegistrants.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="grid grid-cols-[1.5fr_1.5fr_1fr] bg-muted px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      <span>Name</span>
                      <span>Email</span>
                      <span>Registered</span>
                    </div>
                    {pagedRegistrants.map((registrant, index) => {
                      const student = registrant.student || registrant.user || registrant;
                      const name = student.fullName || student.name || registrant.fullName || "-";
                      const email = student.email || registrant.email || "-";
                      const registeredAt = registrant.registeredAt || registrant.createdAt || registrant.updatedAt;
                      return (
                        <div key={registrant.id || `${email}-${index}`} className="grid grid-cols-[1.5fr_1.5fr_1fr] border-t border-border px-3 py-2 text-sm">
                          <span className="truncate font-medium text-text-primary">{name}</span>
                          <span className="truncate text-text-secondary">{email}</span>
                          <span className="text-text-secondary">{registeredAt ? new Date(registeredAt).toLocaleDateString() : "-"}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {registrants.length > REGISTRANT_PAGE_SIZE ? (
                  <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
                    <p>Page {registrantPage} of {totalRegistrantPages}</p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={registrantPage <= 1} onClick={() => setRegistrantPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={registrantPage >= totalRegistrantPages} onClick={() => setRegistrantPage((prev) => Math.min(prev + 1, totalRegistrantPages))}>Next</Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
