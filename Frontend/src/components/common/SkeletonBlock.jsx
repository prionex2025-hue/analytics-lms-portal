import { Skeleton } from "@/components/ui/skeleton";

export default function SkeletonBlock({ className = "" }) {
  return <Skeleton className={`rounded-xl ${className}`} />;
}
