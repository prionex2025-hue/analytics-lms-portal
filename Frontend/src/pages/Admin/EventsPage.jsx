import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CalendarDays, Download, Globe2, ImageOff, MapPin, Pencil, Plus, Save, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import { validateImageFile } from "@/lib/image";
import { optimizeCloudinaryImage } from "@/lib/cloudinary";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import { Callout, EmptyState, ErrorState, FormField, Modal, PageHeader, PaginationBar, SectionCard, StatusBadge } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";

const EVENT_STATUS_TONE = { ACTIVE: "success", EXPIRED: "neutral", CANCELLED: "danger" };
const EVENT_STATUS_LABEL = { ACTIVE: "Active", EXPIRED: "Expired", CANCELLED: "Cancelled" };

function FormGroup({ title, children }) {
  return (
    <fieldset className="min-w-0 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <p className="mb-4 text-sm font-semibold text-text-primary" aria-hidden="true">{title}</p>
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}

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
  const [formOpen, setFormOpen] = useState(false);
  const [pendingDeleteEvent, setPendingDeleteEvent] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
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
    const closeOnSuccess = { onSuccess: () => setFormOpen(false) };
    if (editingEventId) {
      updateMutation.mutate({ eventId: editingEventId, payload }, closeOnSuccess);
      return;
    }
    createMutation.mutate(payload, closeOnSuccess);
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

  const bannerTone = banner.type === "error" ? "danger" : banner.type === "warning" ? "warning" : "success";
  const saving = createMutation.isPending || updateMutation.isPending;
  const canSave = !saving && form.title && form.startsAt && form.eventDate && !(form.feeType === "paid" && Number(form.registrationFee || 0) <= 0);
  const scopeLabel = (event) =>
    (event.visibilityScope || (event.isInterCollege ? "INTER_COLLEGE" : "COLLEGE_ONLY")) === "INTER_COLLEGE" ? "Inter-college" : "College-only";

  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };
  const closeForm = (open) => {
    if (open) return;
    setFormOpen(false);
    if (editingEventId) resetForm();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description="Publish college and inter-college events, then track and export registrations."
        actions={
          canManageEvents ? (
            <Button className="h-10 rounded-lg px-4" onClick={openCreate}>
              <Plus className="size-4" />
              Create Event
            </Button>
          ) : null
        }
      />

      {banner.type ? (
        <Callout tone={bannerTone} title={banner.title}>
          {banner.message}
        </Callout>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <SectionCard
          flush
          title="Events"
          description={`${events.length} total`}
          footer={
            events.length > EVENT_PAGE_SIZE ? (
              <PaginationBar page={eventPage} pages={totalEventPages} onPageChange={(next) => setEventPage(Math.min(Math.max(next, 1), totalEventPages))} />
            ) : null
          }
        >
          {eventsQuery.isLoading ? (
            <div className="space-y-2 p-4" aria-busy="true">
              <SkeletonBlock className="h-20 rounded-lg" />
              <SkeletonBlock className="h-20 rounded-lg" />
              <SkeletonBlock className="h-20 rounded-lg" />
            </div>
          ) : eventsQuery.isError ? (
            <ErrorState className="m-4" title="Unable to load events" description={eventsQuery.error?.message || "Unable to load events."} onRetry={() => eventsQuery.refetch()} />
          ) : pagedEvents.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No events created yet" description={canManageEvents ? "Create your first event with the button above." : "Events will appear here once published."} className="border-0" />
          ) : (
            <ul className="divide-y divide-border">
              {pagedEvents.map((event) => {
                const status = getEventStatus(event);
                const isExpired = status === "EXPIRED";
                const active = selectedEventId === event.id;
                return (
                  <li key={event.id} className={cn("flex gap-3 px-4 py-3 transition-colors sm:px-5", active ? "bg-primary/5" : "hover:bg-muted/40")}>
                    <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {event.imageUrl ? (
                        <img
                          src={optimizeCloudinaryImage(event.imageUrl, { width: 160, height: 160, crop: "fill" })}
                          alt=""
                          width="56"
                          height="56"
                          loading="lazy"
                          decoding="async"
                          className={cn("size-full object-cover", isExpired ? "opacity-65 grayscale" : "")}
                        />
                      ) : (
                        <div className="grid size-full place-items-center text-text-secondary/60">
                          <ImageOff className="size-4" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEventId(event.id);
                          setRegistrantPage(1);
                        }}
                        aria-pressed={active}
                        className={cn("block w-full truncate rounded text-left font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50", active ? "text-primary" : "text-text-primary")}
                      >
                        {event.title}
                      </button>
                      <p className="mt-0.5 truncate text-xs text-text-secondary">
                        {event.eventType} · {scopeLabel(event)} · {new Date(event.startsAt).toLocaleDateString()}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge tone={EVENT_STATUS_TONE[status] || "neutral"}>{EVENT_STATUS_LABEL[status] || status}</StatusBadge>
                        <span className="text-xs tabular-nums text-text-secondary">
                          {event.registrantCount || 0}/{event.registrationLimit} registered
                        </span>
                      </div>
                    </div>
                    {canManageEvents ? (
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-lg"
                          className="rounded-lg text-text-secondary"
                          onClick={() => {
                            startEdit(event);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                          <span className="sr-only">Edit {event.title}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-lg"
                          className="rounded-lg text-text-secondary hover:bg-danger/10 hover:text-danger"
                          disabled={deleteMutation.isPending}
                          onClick={() => setPendingDeleteEvent(event)}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">Delete {event.title}</span>
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          flush
          title={selectedEvent ? selectedEvent.title : "Event registrants"}
          description={
            selectedEvent
              ? `${registrants.length} registration${registrants.length === 1 ? "" : "s"} captured for this event.`
              : "Select an event to review registrations, export attendees, or cancel the event."
          }
          actions={
            selectedEvent ? (
              <Button type="button" variant="outline" className="h-9 rounded-lg" disabled={selectedEventQuery.isLoading} onClick={downloadCsv}>
                <Download className="size-4" />
                Download Registrants
              </Button>
            ) : null
          }
          footer={
            selectedEvent && registrants.length > REGISTRANT_PAGE_SIZE ? (
              <PaginationBar
                page={registrantPage}
                pages={totalRegistrantPages}
                onPageChange={(next) => setRegistrantPage(Math.min(Math.max(next, 1), totalRegistrantPages))}
              />
            ) : null
          }
        >
          {!selectedEvent ? (
            <EmptyState icon={Users} title="No event selected" description="Pick an event from the list to see who registered." className="border-0 py-12" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-3 text-sm text-text-secondary sm:px-5">
                <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden="true" />{new Date(selectedEvent.startsAt).toLocaleString()}</span>
                {selectedEvent.location ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden="true" />{selectedEvent.location}</span> : null}
                <span className="inline-flex items-center gap-1.5"><Globe2 className="size-4" aria-hidden="true" />{scopeLabel(selectedEvent)}</span>
              </div>

              {canManageEvents && getEventStatus(selectedEvent) === "ACTIVE" ? (
                <form
                  className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-end sm:px-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (cancelReason.trim() && !cancelMutation.isPending) setConfirmCancel(true);
                  }}
                >
                  <FormField label="Cancel this event" htmlFor="event-cancel-reason" hint="Registrants will see this reason." className="flex-1">
                    <Input id="event-cancel-reason" className="h-10 rounded-lg" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Cancellation reason" />
                  </FormField>
                  <Button type="submit" variant="ghost" className="h-10 rounded-lg text-danger hover:bg-danger/10 hover:text-danger" disabled={!cancelReason.trim() || cancelMutation.isPending}>
                    <Ban className="size-4" />
                    {cancelMutation.isPending ? "Cancelling..." : "Cancel Event"}
                  </Button>
                </form>
              ) : null}

              {selectedEventQuery.isLoading ? (
                <div className="space-y-2 p-4" aria-busy="true">
                  <SkeletonBlock className="h-10 rounded-lg" />
                  <SkeletonBlock className="h-10 rounded-lg" />
                </div>
              ) : selectedEventQuery.isError ? (
                <ErrorState className="m-4" title="Unable to load registrants" description={selectedEventQuery.error?.message || "Unable to load registrants."} onRetry={() => selectedEventQuery.refetch()} />
              ) : pagedRegistrants.length === 0 ? (
                <EmptyState icon={Users} title="No registrants yet" description="Registrations will appear here as students sign up." className="border-0" />
              ) : (
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium tracking-wide text-text-secondary uppercase">
                        <th className="h-10 px-4 first:pl-5">Name</th>
                        <th className="h-10 px-4">Email</th>
                        <th className="h-10 px-4 last:pr-5">Registered</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pagedRegistrants.map((registrant, index) => {
                        const student = registrant.student || registrant.user || registrant;
                        const name = student.fullName || student.name || registrant.fullName || "-";
                        const email = student.email || registrant.email || "-";
                        const registeredAt = registrant.registeredAt || registrant.createdAt || registrant.updatedAt;
                        return (
                          <tr key={registrant.id || `${email}-${index}`} className="hover:bg-muted/40">
                            <td className="px-4 py-3 font-medium text-text-primary first:pl-5">{name}</td>
                            <td className="px-4 py-3 text-text-secondary">{email}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-text-secondary last:pr-5">{registeredAt ? new Date(registeredAt).toLocaleDateString() : "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </SectionCard>
      </div>

      {canManageEvents ? (
        <Modal
          open={formOpen}
          onOpenChange={closeForm}
          size="xl"
          title={editingEventId ? "Edit Event" : "Create Event"}
          description="Event date/deadline with custom registration fields and participant cap."
          footer={
            <>
              <Button type="button" variant="outline" className="h-10 rounded-lg px-4" onClick={() => closeForm(false)}>Cancel</Button>
              <Button type="submit" form="admin-event-form" className="h-10 rounded-lg px-4" disabled={!canSave}>
                {editingEventId ? <Save className="size-4" /> : <Plus className="size-4" />}
                {saving ? "Saving..." : editingEventId ? "Save Event" : "Create Event"}
              </Button>
            </>
          }
        >
          <form
            id="admin-event-form"
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSave) saveEvent();
            }}
          >
            <FormGroup title="Details">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="space-y-4">
                  <FormField label="Title" htmlFor="event-title" required>
                    <Input id="event-title" className="h-10 rounded-lg" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
                  </FormField>
                  <FormField label="Description" htmlFor="event-description">
                    <Textarea id="event-description" className="min-h-24 rounded-lg" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
                  </FormField>
                </div>
                <FormField label="Event photo" hint="JPG/PNG only, max 2MB.">
                  <label className="group relative flex aspect-video cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-border bg-muted/40 text-sm text-text-secondary transition-colors hover:border-primary/50 hover:bg-primary/5 focus-within:ring-3 focus-within:ring-ring/50">
                    {eventImagePreview ? (
                      <img src={eventImagePreview} alt="Event preview" width="640" height="360" decoding="async" className="absolute inset-0 size-full object-cover" />
                    ) : (
                      <>
                        <Upload className="size-5" aria-hidden="true" />
                        <span className="font-medium">{eventImageFile ? "Change Photo" : "Upload Photo"}</span>
                      </>
                    )}
                    <input ref={eventImageInputRef} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={onEventImageSelected} />
                  </label>
                </FormField>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Event type" htmlFor="event-type">
                  <select id="event-type" className="ui-select w-full" value={form.eventType} onChange={(event) => setForm((prev) => ({ ...prev, eventType: event.target.value }))}>
                    {EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </FormField>
                <FormField label="Location" htmlFor="event-location">
                  <Input id="event-location" className="h-10 rounded-lg" value={form.location} onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))} />
                </FormField>
                <FormField label="Participation scope" htmlFor="event-visibility">
                  <select id="event-visibility" className="ui-select w-full" value={form.visibilityScope} onChange={(event) => setForm((prev) => ({ ...prev, visibilityScope: event.target.value }))}>
                    <option value="COLLEGE_ONLY">College Level Event</option>
                    <option value="INTER_COLLEGE">Inter-college Event (all colleges)</option>
                  </select>
                </FormField>
              </div>
            </FormGroup>

            <FormGroup title="Schedule">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Starts at" htmlFor="event-starts-at" required>
                  <Input id="event-starts-at" type="datetime-local" className="h-10 rounded-lg" value={form.startsAt} onChange={(event) => setForm((prev) => ({ ...prev, startsAt: event.target.value }))} />
                </FormField>
                <FormField label="Ends at" htmlFor="event-ends-at">
                  <Input id="event-ends-at" type="datetime-local" className="h-10 rounded-lg" value={form.endsAt} onChange={(event) => setForm((prev) => ({ ...prev, endsAt: event.target.value }))} />
                </FormField>
                <FormField label="Event date" htmlFor="event-date" required>
                  <Input id="event-date" type="date" className="h-10 rounded-lg" value={form.eventDate} onChange={(event) => setForm((prev) => ({ ...prev, eventDate: event.target.value }))} />
                </FormField>
                <FormField label="Registration deadline" htmlFor="event-registration-deadline">
                  <Input id="event-registration-deadline" type="date" className="h-10 rounded-lg" value={form.registrationDeadline} onChange={(event) => setForm((prev) => ({ ...prev, registrationDeadline: event.target.value }))} />
                </FormField>
              </div>
            </FormGroup>

            <FormGroup title="Registration">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Max participants" htmlFor="event-max-participants">
                  <Input id="event-max-participants" type="number" min={1} className="h-10 rounded-lg" value={form.registrationLimit} onChange={(event) => setForm((prev) => ({ ...prev, registrationLimit: Number(event.target.value) }))} />
                </FormField>
                <FormField label="Registration fees" htmlFor="event-fee-type">
                  <select id="event-fee-type" className="ui-select w-full" value={form.feeType} onChange={(event) => setForm((prev) => ({ ...prev, feeType: event.target.value, registrationFee: event.target.value === "free" ? "" : prev.registrationFee }))}>
                    <option value="free">Free</option>
                    <option value="paid">Paid</option>
                  </select>
                </FormField>
                {form.feeType === "paid" ? (
                  <FormField label="Amount" htmlFor="event-registration-fee" required>
                    <Input id="event-registration-fee" type="number" min={0} step="0.01" className="h-10 rounded-lg" value={form.registrationFee} onChange={(event) => setForm((prev) => ({ ...prev, registrationFee: event.target.value }))} />
                  </FormField>
                ) : null}
              </div>
              <FormField label="Registration URL" htmlFor="event-registration-url" hint="Optional">
                <Input id="event-registration-url" type="url" placeholder="https://" className="h-10 rounded-lg" value={form.registrationUrl} onChange={(event) => setForm((prev) => ({ ...prev, registrationUrl: event.target.value }))} />
              </FormField>
            </FormGroup>
          </form>
        </Modal>
      ) : null}

      <ConfirmActionDialog
        open={Boolean(pendingDeleteEvent)}
        onOpenChange={(open) => !open && setPendingDeleteEvent(null)}
        title="Delete event"
        description={`Delete “${pendingDeleteEvent?.title || "this event"}”? This cannot be undone.`}
        confirmLabel="Delete Event"
        confirmVariant="destructive"
        onConfirm={() => {
          const target = pendingDeleteEvent;
          setPendingDeleteEvent(null);
          if (target?.id) deleteMutation.mutate(target.id);
        }}
      />

      <ConfirmActionDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel event"
        description={`Cancel “${selectedEvent?.title || "this event"}”? Registrants will see the reason: “${cancelReason.trim()}”.`}
        confirmLabel="Cancel Event"
        cancelLabel="Keep Event"
        confirmVariant="destructive"
        onConfirm={() => cancelMutation.mutate({ eventId: selectedEventId, reason: cancelReason.trim() })}
      />
    </div>
  );
}
