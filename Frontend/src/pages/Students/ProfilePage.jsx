import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Mail, User, Upload } from "lucide-react";
import { toast } from "sonner";
import { ProfileSkeleton } from "@/components/common/page-skeletons";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { studentApi } from "@/services/studentApi";
import { profileQueryOptions } from "@/services/studentQueries";
import { cropImageToSquare, validateAvatarFile } from "@/lib/image";
import { optimizeCloudinaryImage } from "@/lib/cloudinary";
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
    return <div className="py-10 text-center text-sm text-text-secondary">{profileQuery.error?.message || "Unable to load profile."}</div>;
  }

  return (
    <section className="grid gap-5 lg:grid-cols-1 xl:grid-cols-[420px_1fr]">
      <article className={`${ui.card} ${ui.cardPaddingLg}`}>
        <div className="mx-auto flex flex-col items-center gap-3">
          <Avatar size="lg" className="size-24 rounded-2xl">
            <AvatarImage src={avatarDisplayUrl} alt="Profile avatar" className="rounded-2xl object-cover" />
            <AvatarFallback className="rounded-2xl bg-primary/15 text-primary">
              <User className="size-8" />
            </AvatarFallback>
          </Avatar>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary">
            <Upload className="size-3.5" />
            {uploading ? "Uploading..." : "Upload Avatar"}
            <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={uploading} onChange={onAvatarSelected} />
          </label>
          <p className="text-xs text-text-secondary">JPG/PNG only, max 2MB, auto-cropped to square.</p>
        </div>

        <h2 className="mt-4 text-center text-2xl font-semibold tracking-tight text-text-primary">{user?.fullName || user?.name || "Student"}</h2>
        <p className="text-center text-sm text-text-secondary">{user?.rollNumber || user?.studentId || "-"}</p>

        <div className="mt-6 space-y-3 text-sm">
          <div className="flex items-center gap-2 rounded-xl bg-background p-3 text-text-secondary"><Mail className="size-4" /> {user?.email || "-"}</div>
          <div className="flex items-center gap-2 rounded-xl bg-background p-3 text-text-secondary"><GraduationCap className="size-4" /> {user?.department?.name || user?.department || "Department"}</div>
        </div>
      </article>

      <article className={`${ui.card} ${ui.cardPaddingLg}`}>
        <h3 className="text-2xl font-semibold tracking-tight text-text-primary">Profile Details</h3>
        <p className="mt-1 text-sm text-text-secondary">Read-only academic identity details from your institution records.</p>

        <div className="mt-5 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[11px] font-semibold tracking-wide text-text-secondary uppercase">Name</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{user?.fullName || user?.name || "-"}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[11px] font-semibold tracking-wide text-text-secondary uppercase">Email</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{user?.email || "-"}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[11px] font-semibold tracking-wide text-text-secondary uppercase">Roll Number</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{user?.rollNumber || user?.studentId || "-"}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[11px] font-semibold tracking-wide text-text-secondary uppercase">College</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{user?.college?.name || user?.college || "-"}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[11px] font-semibold tracking-wide text-text-secondary uppercase">Department</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{user?.department?.name || user?.department || "-"}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[11px] font-semibold tracking-wide text-text-secondary uppercase">Year</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{yearLabel}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[11px] font-semibold tracking-wide text-text-secondary uppercase">Batch</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{batchLabel}</p>
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}
