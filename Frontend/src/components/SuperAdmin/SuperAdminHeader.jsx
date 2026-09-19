import { Menu } from "lucide-react";
import { useSelector } from "react-redux";
import { Button } from "@/components/ui/button";

export default function SuperAdminHeader({ onOpenMobileSidebar }) {
  const superAdmin = useSelector((state) => state.superAdminAuth.superAdmin);
  const rawEnvironment = (import.meta.env.VITE_ENVIRONMENT || import.meta.env.MODE || "development").toUpperCase();
  const environment = rawEnvironment.includes("PROD") ? "PROD" : rawEnvironment.includes("STAG") ? "STAGING" : "DEV";
  const environmentTone = environment === "PROD"
    ? "border-danger/30 bg-danger/10 text-danger"
    : environment === "STAGING"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-primary/30 bg-primary/10 text-primary";

  return (
    <header className="flex min-w-0 items-start border-b border-border bg-card px-3 py-3 sm:px-5 sm:py-4">
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:gap-3">
        <Button type="button" variant="outline" size="icon" onClick={onOpenMobileSidebar} className="mt-0.5 shrink-0 lg:hidden" aria-label="Open navigation menu">
          <Menu className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-text-secondary uppercase">LMS Platform</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${environmentTone}`}>{environment}</span>
        </div>
        <p className="truncate text-xl leading-tight font-semibold tracking-tight text-text-primary sm:text-3xl sm:leading-none">
          Welcome, {superAdmin?.fullName?.split(" ")?.[0] || "Super Admin"}
        </p>
        <p className="mt-1 hidden truncate text-sm text-text-secondary sm:block">Global command center for colleges, users, tests, and analytics</p>
        </div>
      </div>
    </header>
  );
}
