import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Globe2, ImageOff, MapPin, Pencil, Plus, Save, Trash2, Upload, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import { fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { validateImageFile } from "@/lib/image";
import { optimizeCloudinaryImage } from "@/lib/cloudinary";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import { Callout, EmptyState, FormField, PageHeader, PaginationBar, SearchInput, SectionCard, StatusBadge } from "@/components/common/page-kit";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

const EVENT_STATUS_TONE = { ACTIVE: "success", EXPIRED: "neutral", CANCELLED: "danger" };
const EVENT_STATUS_LABEL = { ACTIVE: "Active", EXPIRED: "Expired", CANCELLED: "Cancelled" };

const formatEventDateTime = (value) =>
  value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

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
const PAGE_SIZE = 8;

const EMPTY_FORM = {
  title: "",
  description: "",
  eventType: "Workshop",
  feeType: "free",
  registrationFee: "",
  startsAt: "",
  endsAt: "",
  eventDate: "",
  registrationDeadline: "",
  location: "",
  registrationLimit: 100,
  registrationUrl: "",
  allColleges: true,
  collegeIds: [],
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
  const dispatch = useDispatch();
  const colleges = useSelector((state) => state.superAdminPanel.colleges);
  const eventImageInputRef = useRef(null);

  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [form, setForm] = useState(EMPTY_FORM);
  const [eventImageFile, setEventImageFile] = useState(null);
  const [eventImagePreview, setEventImagePreview] = useState("");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingEventId, setEditingEventId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pendingDeleteEvent, setPendingDeleteEvent] = useState(null);

  useEffect(() => {
    return () => {
      if (eventImagePreview?.startsWith("blob:")) {
        URL.revokeObjectURL(eventImagePreview);
      }
    };
  }, [eventImagePreview]);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const response = await superAdminApi.getEvents("?page=1&limit=100");
      setEvents(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      setBanner({ type: "error", title: "Failed to load events", message: error?.message || "Unable to fetch global events." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    dispatch(fetchSuperColleges());
    loadEvents();
  }, [dispatch]);

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

  const startEdit = (event) => {
    const feeDetails = extractFeeDetails(event);
    setEditingEventId(event.id);
    setForm({
      title: event.title || "",
      description: event.description || "",
      eventType: event.eventType || "Workshop",
      feeType: feeDetails.feeType,
      registrationFee: feeDetails.registrationFee,
      startsAt: toDateTimeLocalValue(event.startsAt),
      endsAt: toDateTimeLocalValue(event.endsAt),
      eventDate: toDateInputValue(event.eventDate),
      registrationDeadline: toDateInputValue(event.registrationDeadline),
      location: event.location || "",
      registrationLimit: Number(event.registrationLimit || 100),
      registrationUrl: event.registrationUrl || "",
      allColleges: true,
      collegeIds: [],
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

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return events;
    return events.filter((item) => {
      const text = `${item.title || ""} ${item.eventType || ""} ${item.college?.name || ""}`.toLowerCase();
      return text.includes(term);
    });
  }, [events, search]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const pagedEvents = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredEvents.slice(start, start + PAGE_SIZE);
  }, [filteredEvents, page]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const buildPayload = () => {
    const registrationFee = form.feeType === "paid" ? Number(form.registrationFee || 0) : 0;
    const registrationFields = [
      {
        key: "registration_fee",
        label: "Registration Fee",
        type: "number",
        required: false,
        options: [],
        meta: {
          feeType: form.feeType,
          amount: registrationFee,
        },
      },
    ];

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      eventType: form.eventType,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      eventDate: form.eventDate ? new Date(`${form.eventDate}T00:00:00`).toISOString() : null,
      registrationDeadline: form.registrationDeadline ? new Date(`${form.registrationDeadline}T00:00:00`).toISOString() : null,
      location: form.location.trim() || null,
      registrationLimit: Number(form.registrationLimit),
      maxParticipants: Number(form.registrationLimit),
      registrationUrl: form.registrationUrl?.trim() ? form.registrationUrl.trim() : null,
      registrationFields,
      allColleges: form.allColleges,
      collegeIds: form.allColleges ? [] : form.collegeIds,
      feeType: form.feeType,
      registrationFee,
    };

    const formData = new FormData();
    formData.append("title", payload.title);
    formData.append("description", payload.description);
    formData.append("eventType", payload.eventType);
    formData.append("startsAt", payload.startsAt);
    formData.append("allColleges", String(payload.allColleges));
    formData.append("registrationLimit", String(payload.registrationLimit));
    formData.append("maxParticipants", String(payload.maxParticipants));
    formData.append("feeType", payload.feeType);
    formData.append("registrationFee", String(payload.registrationFee));
    formData.append("registrationFields", JSON.stringify(payload.registrationFields));
    formData.append("collegeIds", JSON.stringify(payload.collegeIds));

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

  const save = async () => {
    if (!form.title.trim() || !form.description.trim() || !form.startsAt || !form.endsAt) {
      setBanner({ type: "warning", title: "Missing details", message: "Title, description, starts at, and ends at are required." });
      return;
    }

    if (!editingEventId && !form.allColleges && form.collegeIds.length === 0) {
      setBanner({ type: "warning", title: "No college selected", message: "Select at least one college or choose all colleges." });
      return;
    }

    if (form.feeType === "paid" && Number(form.registrationFee || 0) <= 0) {
      setBanner({ type: "warning", title: "Invalid fee amount", message: "Enter a paid registration amount greater than 0." });
      return;
    }

    setSubmitting(true);
    try {
      if (editingEventId) {
        await superAdminApi.updateEvent(editingEventId, buildPayload());
        toast.success("Global event updated.");
        setBanner({ type: "success", title: "Global event updated", message: "Event details were saved successfully." });
      } else {
        await superAdminApi.createEvent(buildPayload());
        toast.success("Global event created.");
        setBanner({ type: "success", title: "Global event created", message: "Event has been rolled out to target colleges." });
      }
      resetForm();
      await loadEvents();
    } catch (error) {
      setBanner({ type: "error", title: editingEventId ? "Update failed" : "Create failed", message: error?.message || "Unable to save global event." });
      toast.error(error?.message || "Failed to save event.");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteEvent = async (eventId) => {
    setSubmitting(true);
    try {
      await superAdminApi.deleteEvent(eventId);
      toast.success("Global event deleted.");
      setBanner({ type: "success", title: "Global event deleted", message: "The event was removed from the global events list." });
      if (editingEventId === eventId) resetForm();
      await loadEvents();
    } catch (error) {
      setBanner({ type: "error", title: "Delete failed", message: error?.message || "Unable to delete global event." });
      toast.error(error?.message || "Failed to delete event.");
    } finally {
      setSubmitting(false);
    }
  };

  const canCreate = Boolean(form.title.trim() && form.description.trim() && form.startsAt && form.endsAt && Number(form.registrationLimit) > 0 && (editingEventId || form.allColleges || form.collegeIds.length > 0) && (form.feeType !== "paid" || Number(form.registrationFee || 0) > 0));

  const bannerTone = banner.type === "error" ? "danger" : banner.type === "warning" ? "warning" : "success";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Global events"
        description="Create events once and target one, several, or all colleges."
      />

      {banner.type ? (
        <Callout tone={bannerTone} title={banner.title}>
          {banner.message}
        </Callout>
      ) : null}

      <SectionCard
        title={editingEventId ? "Edit global event" : "Create global event"}
        description={editingEventId ? "Update the event details below. College targeting can't be changed after creation." : "Fields marked * are required."}
        className={editingEventId ? "ring-2 ring-primary/30" : ""}
      >
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (canCreate && !submitting) save();
          }}
        >
          <FormGroup title="Details">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-4">
                <FormField label="Title" htmlFor="super-event-title" required>
                  <Input id="super-event-title" className={ui.field} value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
                </FormField>
                <FormField label="Description" htmlFor="super-event-description" required>
                  <Textarea id="super-event-description" className="min-h-28 rounded-lg" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
                </FormField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Event type" htmlFor="super-event-type">
                    <select id="super-event-type" className="ui-select w-full" value={form.eventType} onChange={(e) => setForm((prev) => ({ ...prev, eventType: e.target.value }))}>
                      {EVENT_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Location" htmlFor="super-event-location">
                    <Input id="super-event-location" className={ui.field} value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} />
                  </FormField>
                </div>
              </div>

              <FormField label="Event photo" hint="JPG/PNG only, max 2MB. Uploaded once and reused for targeted colleges.">
                <label
                  className={cn(
                    "group relative flex aspect-video cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-border bg-muted/40 text-sm text-text-secondary transition-colors hover:border-primary/50 hover:bg-primary/5 focus-within:ring-3 focus-within:ring-ring/50"
                  )}
                >
                  {eventImagePreview ? (
                    <>
                      <img src={eventImagePreview} alt="Global event preview" width="640" height="360" decoding="async" className="absolute inset-0 size-full object-cover" />
                      <span className="relative inline-flex items-center gap-1.5 rounded-md bg-card/95 px-2.5 py-1 text-xs font-medium text-text-primary shadow-sm opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <Upload className="size-3.5" />
                        Change photo
                      </span>
                    </>
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
          </FormGroup>

          <FormGroup title="Schedule">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Starts at" htmlFor="super-event-starts-at" required>
                <Input id="super-event-starts-at" type="datetime-local" className={ui.field} value={form.startsAt} onChange={(e) => setForm((prev) => ({ ...prev, startsAt: e.target.value }))} />
              </FormField>
              <FormField label="Ends at" htmlFor="super-event-ends-at" required>
                <Input id="super-event-ends-at" type="datetime-local" className={ui.field} value={form.endsAt} onChange={(e) => setForm((prev) => ({ ...prev, endsAt: e.target.value }))} />
              </FormField>
              <FormField label="Event date" htmlFor="super-event-date">
                <Input id="super-event-date" type="date" className={ui.field} value={form.eventDate} onChange={(e) => setForm((prev) => ({ ...prev, eventDate: e.target.value }))} />
              </FormField>
              <FormField label="Registration deadline" htmlFor="super-event-deadline">
                <Input id="super-event-deadline" type="date" className={ui.field} value={form.registrationDeadline} onChange={(e) => setForm((prev) => ({ ...prev, registrationDeadline: e.target.value }))} />
              </FormField>
            </div>
          </FormGroup>

          <FormGroup title="Registration">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Max participants" htmlFor="super-event-max-participants" required>
                <Input id="super-event-max-participants" type="number" min={1} className={ui.field} value={form.registrationLimit} onChange={(e) => setForm((prev) => ({ ...prev, registrationLimit: Number(e.target.value) }))} />
              </FormField>
              <FormField label="Registration fees" htmlFor="super-event-fee-type">
                <select id="super-event-fee-type" className="ui-select w-full" value={form.feeType} onChange={(e) => setForm((prev) => ({ ...prev, feeType: e.target.value, registrationFee: e.target.value === "free" ? "" : prev.registrationFee }))}>
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                </select>
              </FormField>
              {form.feeType === "paid" ? (
                <FormField label="Amount" htmlFor="super-event-fee-amount" required>
                  <Input id="super-event-fee-amount" type="number" min={0} step="0.01" className={ui.field} value={form.registrationFee} onChange={(e) => setForm((prev) => ({ ...prev, registrationFee: e.target.value }))} />
                </FormField>
              ) : null}
              <FormField label="Registration URL" htmlFor="super-event-registration-url" hint="Optional" className={form.feeType === "paid" ? "" : "lg:col-span-2"}>
                <Input id="super-event-registration-url" type="url" placeholder="https://" className={ui.field} value={form.registrationUrl} onChange={(e) => setForm((prev) => ({ ...prev, registrationUrl: e.target.value }))} />
              </FormField>
            </div>
          </FormGroup>

          {!editingEventId ? (
            <FormGroup title="Audience">
              <label htmlFor="super-event-all-colleges" className="flex w-fit cursor-pointer items-center gap-2.5 text-sm text-text-primary">
                <input className="ui-checkbox" id="super-event-all-colleges" type="checkbox" checked={form.allColleges} onChange={(e) => setForm((prev) => ({ ...prev, allColleges: e.target.checked }))} />
                Assign to all colleges
              </label>
              {!form.allColleges ? (
                <FormField label="Select colleges" htmlFor="super-event-colleges" hint={`Hold Ctrl/⌘ to select several · ${form.collegeIds.length} selected`} required>
                  <select id="super-event-colleges" multiple className="ui-select w-full max-w-xl" value={form.collegeIds} onChange={(e) => setForm((prev) => ({ ...prev, collegeIds: Array.from(e.target.selectedOptions).map((option) => option.value) }))}>
                    {colleges.map((college) => (
                      <option key={college.id} value={college.id}>{college.name}</option>
                    ))}
                  </select>
                </FormField>
              ) : null}
            </FormGroup>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
            <Button type="submit" className={ui.btn} disabled={!canCreate || submitting}>
              {editingEventId ? <Save className="size-4" /> : <Plus className="size-4" />}
              {submitting ? "Saving..." : editingEventId ? "Save Global Event" : "Create Global Event"}
            </Button>
            {editingEventId ? (
              <Button type="button" variant="outline" className={ui.btn} onClick={resetForm}>
                <X className="size-4" />
                Cancel Edit
              </Button>
            ) : null}
            {!canCreate && !submitting ? <p className="text-xs text-text-secondary">Complete the required fields to continue.</p> : null}
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="All global events"
        description={`${filteredEvents.length} event${filteredEvents.length === 1 ? "" : "s"}`}
        actions={
          <SearchInput
            id="super-event-search"
            className="w-full sm:w-72"
            label="Search events"
            placeholder="Search by title, type, or college"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
        footer={
          filteredEvents.length > PAGE_SIZE ? (
            <PaginationBar page={page} pages={totalPages} total={filteredEvents.length} onPageChange={(next) => setPage(Math.min(Math.max(next, 1), totalPages))} />
          ) : null
        }
      >
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-72" />
            ))}
          </div>
        ) : pagedEvents.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={search ? "No events match your search" : "No global events found"}
            description={search ? "Try a different title, type, or college." : "Create the first global event using the form above."}
            className="border-0 py-8"
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {pagedEvents.map((event) => {
              const status = getEventStatus(event);
              const isExpired = status === "EXPIRED";
              const isEditing = editingEventId === event.id;

              return (
                <li
                  key={event.id}
                  className={cn(
                    "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card transition-colors",
                    isEditing ? "border-primary ring-2 ring-primary/25" : "border-border hover:border-primary/40"
                  )}
                >
                  <div className="relative aspect-video bg-muted">
                    {event.imageUrl ? (
                      <img
                        src={optimizeCloudinaryImage(event.imageUrl, { width: 640, height: 360, crop: "fill" })}
                        alt={`${event.title} cover`}
                        width="640"
                        height="360"
                        loading="lazy"
                        decoding="async"
                        className={cn("size-full object-cover", isExpired ? "opacity-65 grayscale" : "")}
                      />
                    ) : (
                      <div className="grid size-full place-items-center text-text-secondary/60">
                        <ImageOff className="size-6" aria-hidden="true" />
                      </div>
                    )}
                    <div className="absolute top-2 left-2 flex gap-1.5">
                      <span className="rounded-full bg-card/95 px-2 py-0.5 text-xs font-medium text-text-primary shadow-sm">{event.eventType}</span>
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 font-medium text-text-primary">{event.title}</p>
                      <StatusBadge tone={EVENT_STATUS_TONE[status] || "neutral"}>{EVENT_STATUS_LABEL[status] || status}</StatusBadge>
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-text-secondary">
                      <p className="flex items-center gap-1.5">
                        <Globe2 className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{event.college?.name || "All colleges"}</span>
                      </p>
                      <p className="flex items-center gap-1.5">
                        <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                        <span>{formatEventDateTime(event.startsAt)} – {formatEventDateTime(event.endsAt)}</span>
                      </p>
                      {event.location ? (
                        <p className="flex items-center gap-1.5">
                          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{event.location}</span>
                        </p>
                      ) : null}
                      {event.registrationLimit ? (
                        <p className="flex items-center gap-1.5">
                          <Users className="size-3.5 shrink-0" aria-hidden="true" />
                          <span>{event.registrationLimit} max participants</span>
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-auto flex gap-2 pt-3">
                      <Button type="button" variant="outline" className="h-9 flex-1 rounded-lg" onClick={() => startEdit(event)}>
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 flex-1 rounded-lg text-danger hover:bg-danger/10 hover:text-danger"
                        disabled={submitting}
                        onClick={() => setPendingDeleteEvent(event)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <ConfirmActionDialog
        open={Boolean(pendingDeleteEvent)}
        onOpenChange={(open) => !open && setPendingDeleteEvent(null)}
        title="Delete global event"
        description={`Delete “${pendingDeleteEvent?.title || "this event"}”? It will be removed from every targeted college. This cannot be undone.`}
        confirmLabel="Delete Event"
        confirmVariant="destructive"
        onConfirm={async () => {
          const target = pendingDeleteEvent;
          setPendingDeleteEvent(null);
          if (target?.id) await deleteEvent(target.id);
        }}
      />
    </div>
  );
}
