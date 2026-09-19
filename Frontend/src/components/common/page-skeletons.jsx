import SkeletonBlock from "@/components/common/SkeletonBlock";

export function DashboardSkeleton() {
  return (
    <section className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr]">
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-64" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <SkeletonBlock className="h-80" />
        <SkeletonBlock className="h-80" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <SkeletonBlock className="h-80" />
        <SkeletonBlock className="h-80" />
      </div>
    </section>
  );
}

export function TestsSkeleton() {
  return (
    <section className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <SkeletonBlock className="h-130" />
        <div className="space-y-4">
          <SkeletonBlock className="h-70" />
          <SkeletonBlock className="h-48" />
        </div>
      </div>
      <SkeletonBlock className="h-52" />
    </section>
  );
}

export function ReportsSkeleton() {
  return (
    <section className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-24" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonBlock className="h-80" />
        <SkeletonBlock className="h-80" />
      </div>
      <SkeletonBlock className="h-72" />
    </section>
  );
}

export function LeaderboardSkeleton() {
  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-20" />
      </div>
      <SkeletonBlock className="h-28" />
      <SkeletonBlock className="h-96" />
    </section>
  );
}

export function EventsSkeleton() {
  return (
    <section className="space-y-5">
      <SkeletonBlock className="h-64" />
      <div className="flex gap-2">
        <SkeletonBlock className="h-8 w-18" />
        <SkeletonBlock className="h-8 w-24" />
        <SkeletonBlock className="h-8 w-24" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-64" />
      </div>
    </section>
  );
}

export function ProfileSkeleton() {
  return (
    <section className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <SkeletonBlock className="h-80" />
      <SkeletonBlock className="h-80" />
    </section>
  );
}
