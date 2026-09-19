import { ChevronDown, Menu, Search } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAdminAuthState } from "@/hooks/useAdminAuthState";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import AdminCommandPalette from "@/components/Admin/AdminCommandPalette";

const isCollegeAdminPath = (pathname) =>
  pathname === "/college-admin" || pathname.startsWith("/college-admin/");

export default function AdminHeader({ workspaceLabel = "Admin Workspace", basePath = null, onOpenMobileSidebar }) {
  const location = useLocation();
  const admin = useAdminAuthState()?.admin;
  const [searchOpen, setSearchOpen] = useState(false);
  const college = admin?.college;
  const resolvedBasePath = basePath || (isCollegeAdminPath(location.pathname) ? "/college-admin" : "/admin");

  return (
    <>
      <header className="flex min-w-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-3 shadow-sm sm:gap-4 sm:px-5 sm:py-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <Button type="button" variant="outline" size="icon" onClick={onOpenMobileSidebar} className="shrink-0 lg:hidden" aria-label="Open navigation menu">
            <Menu className="size-5" />
          </Button>
          <div className="hidden size-10 shrink-0 place-items-center rounded-xl bg-muted text-text-primary sm:grid">
            {(college?.name || "C").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm leading-none font-semibold tracking-tight text-text-primary sm:text-lg">{college?.name || "Your College"}</p>
            <p className="mt-1 truncate text-[11px] text-text-secondary sm:text-xs">{college?.code || "-"} - {workspaceLabel}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setSearchOpen(true)}
            className="size-10 gap-2 p-0 sm:w-auto sm:px-3"
            title="Search admin workspace"
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Search</span>
          </Button>

          <div className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-1.5 sm:px-2">
            <Avatar className="size-8 rounded-lg bg-primary/10 text-primary after:hidden">
              <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-bold text-primary">
                {(admin?.fullName || "AD")
                  .split(" ")
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <div className="hidden pr-1 sm:block">
              <p className="text-sm font-semibold text-text-primary">{admin?.fullName || "Admin"}</p>
              <p className="text-[11px] text-text-secondary">{admin?.employeeId || "---"}</p>
            </div>
            <ChevronDown className="hidden size-4 text-text-secondary sm:block" />
          </div>
        </div>
      </header>

      <AdminCommandPalette open={searchOpen} onOpenChange={setSearchOpen} basePath={resolvedBasePath} />
    </>
  );
}
