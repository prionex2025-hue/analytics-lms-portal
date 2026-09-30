import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Building2, Calendar, Camera, GraduationCap, Hash, Layers, Loader2, Mail, School, User } from "lucide-react";
import { toast } from "sonner";
import { ProfileSkeleton } from "@/components/common/page-skeletons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { studentApi } from "@/services/studentApi";
import { profileQueryOptions } from "@/services/studentQueries";
import { cropImageToSquare, validateAvatarFile } from "@/lib/image";
import { optimizeCloudinaryImage } from "@/lib/cloudinary";
import { Callout, ErrorState, PageHeader, StatusBadge } from "@/components/Students/ui/StudentUI";
import { cn } from "@/lib/utils";
import { ui } from "@/styles/ui-tokens";

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const [uploadPreview, setUploadPreview] = useState("");
  const [uploading, setUploading] = useState(false);

  const profileQuery = useQuery(profileQueryOptions());
  const user = profileQuery.data;
  const batchLabel = (() => {
    if (Array.isArray(user?.batches) && user.batches.length > 0) {
      return user.batches.map((batch) => batch?.name).filter(Boolean).join(", ") || "-";
    }

    return user?.batch?.name || user?.batch || "-";
  })();

  const yearLabel = (() => {
    if (user?.year === null || typeof user?.year === "undefined" || user?.year === "") {
      return "-";
    }

    return `${user.year} YEAR`;
  })();

  const uploadMutation = useMutation({
    mutationFn: (file) => studentApi.uploadMyAvatar(file),
    onSuccess: (payload) => {
      const nextUrl = payload?.avatar_url || payload?.avatarUrl || "";
      queryClient.setQueryData(["student", "profile"], (prev) => ({
        ...(prev || {}),
        avatarUrl: nextUrl || prev?.avatarUrl,
      }));
      setUploadPreview("");
      toast.success("Avatar updated successfully.");
    },
    onError: (error) => {
      setUploadPreview("");
      toast.error(error?.message || "Avatar upload failed.");
    },
    onSettled: () => {
      setUploading(false);
    },
  });

  const currentAvatar = useMemo(() => uploadPreview || user?.avatarUrl || "", [uploadPreview, user?.avatarUrl]);
  const avatarDisplayUrl = useMemo(
    () => optimizeCloudinaryImage(currentAvatar, { width: 256, height: 256, gravity: "face" }),
    [currentAvatar]
  );

  const onAvatarSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    const validationError = validateAvatarFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      const cropped = await cropImageToSquare(file);
      const localPreview = URL.createObjectURL(cropped);
      setUploadPreview(localPreview);
      setUploading(true);
      uploadMutation.mutate(cropped);
    } catch (error) {
      setUploadPreview("");
      toast.error(error?.message || "Unable to process avatar image.");
    }
  };

  if (profileQuery.isLoading) {
    return <ProfileSkeleton />;
  }

  if (profileQuery.isError) {
    return (
      <section className={ui.pageSection}>
        <PageHeader title="Profile" />
        <ErrorState
          title="Unable to load profile"
          description={profileQuery.error?.message || "Please try again in a moment."}
          onRetry={() => profileQuery.refetch()}
        />
      </section>
    );
  }

  const fullName = user?.fullName || user?.name || "Student";
  const rollNumber = user?.rollNumber || user?.studentId || "-";
  const departmentName = user?.department?.name || user?.department || "-";
  const collegeName = user?.college?.name || user?.college || "-";

  const details = [
    { label: "Full name", value: user?.fullName || user?.name || "-", icon: User },
    { label: "Email", value: user?.email || "-", icon: Mail },
    { label: "Roll number", value: rollNumber, icon: Hash },
    { label: "College", value: collegeName, icon: School },
    { label: "Department", value: departmentName, icon: Building2 },
    { label: "Year", value: yearLabel, icon: Calendar },
    { label: "Batch", value: batchLabel, icon: Layers },
  ];

  return (
    <section className={ui.pageSection}>
      <PageHeader title="Profile" description="Your academic identity as recorded by your institution." />

      <div className={cn(ui.card, "overflow-hidden")}>
        <div className="h-20 bg-linear-to-r from-primary/15 via-primary/5 to-transparent sm:h-24" aria-hidden="true" />
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:gap-5 sm:px-6 sm:pb-6">
          <div className="relative -mt-12 w-fit sm:-mt-14">
            <Avatar className="size-24 rounded-2xl border-4 border-card bg-card shadow-sm after:hidden sm:size-28">
              <AvatarImage src={avatarDisplayUrl} alt="Profile avatar" className="rounded-xl object-cover" />
              <AvatarFallback className="rounded-xl bg-primary/10 text-primary">
                <User className="size-9" />
              </AvatarFallback>
            </Avatar>
            <label
              className={cn(
                "absolute -right-2 -bottom-2 grid size-10 cursor-pointer place-items-center rounded-full border border-border bg-card text-text-primary shadow-sm transition-colors hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50",
                uploading ? "cursor-wait opacity-80" : ""
              )}
              title="Change avatar"
            >
              {uploading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Camera className="size-4" />}
              <span className="sr-only">{uploading ? "Uploading..." : "Upload Avatar"}</span>
              <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={uploading} onChange={onAvatarSelected} />
            </label>
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">{fullName}</h2>
            <p className="mt-0.5 text-sm text-text-secondary">{user?.email || "-"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge tone="info" icon={Hash}>{rollNumber}</StatusBadge>
              {departmentName !== "-" ? <StatusBadge tone="neutral" icon={GraduationCap}>{departmentName}</StatusBadge> : null}
              {yearLabel !== "-" ? <StatusBadge tone="neutral" icon={Calendar} className="capitalize">{yearLabel.toLowerCase()}</StatusBadge> : null}
            </div>
          </div>
        </div>
        <p className="border-t border-border px-5 py-3 text-xs text-text-secondary sm:px-6">
          {uploading ? "Uploading avatar…" : "Avatar: JPG or PNG, max 2MB. Images are auto-cropped to a square."}
        </p>
      </div>

      <div className={cn(ui.card, ui.cardPaddingLg)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={ui.titleLg}>Academic details</h3>
          <StatusBadge tone="neutral" icon={BadgeCheck}>Read-only</StatusBadge>
        </div>
        <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {details.map((item) => (
            <div key={item.label} className="flex min-w-0 gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-text-secondary">
                <item.icon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <dt className="text-xs text-text-secondary">{item.label}</dt>
                <dd className="mt-0.5 break-words text-sm font-medium text-text-primary">{item.value}</dd>
              </div>
            </div>
          ))}
        </dl>
        <Callout tone="info" className="mt-6">
          These details come from your institution&apos;s records. Contact your administrator if anything looks incorrect.
        </Callout>
      </div>
    </section>
  );
}
