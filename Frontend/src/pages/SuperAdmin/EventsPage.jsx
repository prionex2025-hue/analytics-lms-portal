import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import { fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import { validateImageFile } from "@/lib/image";
import { optimizeCloudinaryImage } from "@/lib/cloudinary";

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

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"} className={banner.type === "warning" ? "border-warning/30 bg-warning/10 text-warning" : ""}>
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>{editingEventId ? "Edit Global Event" : "Create Global Event"}</CardTitle>
          <CardDescription>Admin-like event creation with super admin controls for multi-college targeting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="super-event-title" className="text-sm font-medium text-text-secondary">Title</label>
            <Input id="super-event-title" placeholder="Title" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="super-event-description" className="text-sm font-medium text-text-secondary">Description</label>
            <Textarea id="super-event-description" placeholder="Description" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
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
              <p className="text-xs text-text-secondary">JPG/PNG only, max 2MB. The image will be uploaded once and reused for targeted colleges.</p>
            </div>
            {eventImagePreview ? (
              <img
                src={eventImagePreview}
                alt="Global event preview"
                width="640"
                height="320"
                decoding="async"
                className="h-44 w-full rounded-xl border border-border object-cover sm:h-52"
              />
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="super-event-type" className="text-sm font-medium text-text-secondary">Event type</label>
              <select id="super-event-type" className="h-10 w-full rounded-md border border-border px-3 text-sm" value={form.eventType} onChange={(e) => setForm((prev) => ({ ...prev, eventType: e.target.value }))}>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="super-event-location" className="text-sm font-medium text-text-secondary">Location</label>
              <Input id="super-event-location" placeholder="Location" value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="super-event-max-participants" className="text-sm font-medium text-text-secondary">Max participants</label>
              <Input id="super-event-max-participants" type="number" min={1} placeholder="Max participants" value={form.registrationLimit} onChange={(e) => setForm((prev) => ({ ...prev, registrationLimit: Number(e.target.value) }))} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="super-event-fee-type" className="text-sm font-medium text-text-secondary">Registration fees</label>
              <select id="super-event-fee-type" className="h-10 w-full rounded-md border border-border px-3 text-sm" value={form.feeType} onChange={(e) => setForm((prev) => ({ ...prev, feeType: e.target.value, registrationFee: e.target.value === "free" ? "" : prev.registrationFee }))}>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            {form.feeType === "paid" ? (
              <div className="space-y-1.5">
                <label htmlFor="super-event-fee-amount" className="text-sm font-medium text-text-secondary">Amount</label>
                <Input id="super-event-fee-amount" type="number" min={0} step="0.01" placeholder="Amount" value={form.registrationFee} onChange={(e) => setForm((prev) => ({ ...prev, registrationFee: e.target.value }))} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label htmlFor="super-event-starts-at" className="text-sm font-medium text-text-secondary">Starts at</label>
              <Input id="super-event-starts-at" type="datetime-local" value={form.startsAt} onChange={(e) => setForm((prev) => ({ ...prev, startsAt: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="super-event-ends-at" className="text-sm font-medium text-text-secondary">Ends at</label>
              <Input id="super-event-ends-at" type="datetime-local" value={form.endsAt} onChange={(e) => setForm((prev) => ({ ...prev, endsAt: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="super-event-date" className="text-sm font-medium text-text-secondary">Event date</label>
              <Input id="super-event-date" type="date" value={form.eventDate} onChange={(e) => setForm((prev) => ({ ...prev, eventDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="super-event-deadline" className="text-sm font-medium text-text-secondary">Registration deadline</label>
              <Input id="super-event-deadline" type="date" value={form.registrationDeadline} onChange={(e) => setForm((prev) => ({ ...prev, registrationDeadline: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="super-event-registration-url" className="text-sm font-medium text-text-secondary">Registration URL (optional)</label>
              <Input id="super-event-registration-url" placeholder="Registration URL" value={form.registrationUrl} onChange={(e) => setForm((prev) => ({ ...prev, registrationUrl: e.target.value }))} />
            </div>
          </div>

          {!editingEventId ? (
          <div className="space-y-1.5">
            <label htmlFor="super-event-all-colleges" className="text-sm font-medium text-text-secondary">College assignment</label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input id="super-event-all-colleges" type="checkbox" checked={form.allColleges} onChange={(e) => setForm((prev) => ({ ...prev, allColleges: e.target.checked }))} />
              Assign to all colleges
            </label>
          </div>
          ) : null}

          {!editingEventId && !form.allColleges ? (
            <div className="space-y-1.5">
              <label htmlFor="super-event-colleges" className="text-sm font-medium text-text-secondary">Select colleges</label>
              <select id="super-event-colleges" multiple className="min-h-24 w-full rounded-lg border border-border p-2" value={form.collegeIds} onChange={(e) => setForm((prev) => ({ ...prev, collegeIds: Array.from(e.target.selectedOptions).map((option) => option.value) }))}>
                {colleges.map((college) => (
                  <option key={college.id} value={college.id}>{college.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button className="bg-primary/100 hover:bg-primary" onClick={save} disabled={!canCreate || submitting}>
              {submitting ? "Saving..." : editingEventId ? "Save Global Event" : "Create Global Event"}
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

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Global Events</CardTitle>
          <CardDescription>Admin-like event list with search and pagination for portfolio-wide visibility.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="super-event-search" className="text-sm font-medium text-text-secondary">Search events</label>
            <Input id="super-event-search" placeholder="Search by title, type, or college" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {loading ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
            </div>
          ) : null}

          {!loading && pagedEvents.length === 0 ? <p className="text-sm text-text-secondary">No global events found.</p> : null}

          {!loading ? (
            <div className="space-y-2">
              {pagedEvents.map((event) => {
                const status = getEventStatus(event);
                const isExpired = status === "EXPIRED";

                return (
                <div key={event.id} className="rounded-xl border border-border px-3 py-2">
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
                  <p className="font-medium text-text-primary">{event.title}</p>
                  <p className="text-xs text-text-secondary">{event.eventType} | {event.college?.name || "All colleges"}</p>
                  <p className="text-xs text-text-secondary">{event.startsAt ? new Date(event.startsAt).toLocaleString() : "-"} to {event.endsAt ? new Date(event.endsAt).toLocaleString() : "-"}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {status !== "ACTIVE" ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-text-secondary">{status}</span> : null}
                    <Button type="button" variant="outline" size="sm" onClick={() => startEdit(event)}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button type="button" variant="destructive" size="sm" disabled={submitting} onClick={() => deleteEvent(event.id)}>
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </div>
                </div>
                );
              })}
            </div>
          ) : null}

          {filteredEvents.length > PAGE_SIZE ? (
            <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
              <p>Page {page} of {totalPages}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}>Next</Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
