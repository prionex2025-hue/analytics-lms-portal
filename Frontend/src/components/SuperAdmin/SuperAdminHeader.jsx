import { useState } from "react";
import { ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import { logoutSuperAdmin } from "@/features/SuperAdmin/superAdminAuthSlice";
import { toggleSidebar } from "@/features/SuperAdmin/superAdminUiSlice";
import { resolveSuperAdminPageTitle } from "@/components/SuperAdmin/navigation";
import { cn } from "@/lib/utils";

const getInitials = (name) =>
  (name || "Super Admin")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

export default function SuperAdminHeader({ onOpenMobileSidebar }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const superAdmin = useSelector((state) => state.superAdminAuth.superAdmin);
  const collapsed = useSelector((state) => state.superAdminUi?.sidebarCollapsed);
  const { title, section } = resolveSuperAdminPageTitle(pathname);

  const rawEnvironment = (import.meta.env.VITE_ENVIRONMENT || import.meta.env.MODE || "development").toUpperCase();
  const environment = rawEnvironment.includes("PROD") ? "PROD" : rawEnvironment.includes("STAG") ? "STAGING" : "DEV";
  const environmentTone = environment === "PROD"
    ? "bg-danger/10 text-danger ring-danger/25"
    : environment === "STAGING"
      ? "bg-warning/15 text-amber-700 ring-warning/35"
      : "bg-primary/10 text-primary ring-primary/20";

  return (
    <header className="sticky top-0 z-30 flex h-16 min-w-0 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/75 sm:px-6">
      <Button type="button" variant="ghost" size="icon-lg" onClick={onOpenMobileSidebar} className="-ml-1 size-10 lg:hidden">
        <Menu className="size-5" />
        <span className="sr-only">Open navigation menu</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        onClick={() => dispatch(toggleSidebar())}
        className="-ml-2 hidden size-10 text-text-secondary lg:inline-flex"
        aria-pressed={Boolean(collapsed)}
      >
        {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
        <span className="sr-only">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
      </Button>

      <div className="min-w-0 flex-1">
        {section ? <p className="hidden text-xs text-text-secondary sm:block">{section}</p> : null}
        <p className="truncate text-base leading-tight font-semibold text-text-primary">{title}</p>
      </div>

      <span
        className={cn("hidden h-6 items-center rounded-full px-2.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset sm:inline-flex", environmentTone)}
        title="Deployment environment"
      >
        {environment}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 items-center gap-2.5 rounded-lg pr-1 pl-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:pr-2"
          >
            <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {getInitials(superAdmin?.fullName)}
            </span>
            <span className="hidden max-w-44 text-left md:block">
              <span className="block truncate text-sm leading-tight font-medium text-text-primary">{superAdmin?.fullName || "Super Admin"}</span>
              <span className="block truncate text-xs leading-tight text-text-secondary">Super Admin</span>
            </span>
            <ChevronDown className="hidden size-4 text-text-secondary md:block" aria-hidden="true" />
            <span className="sr-only">Open account menu</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-medium text-text-primary">{superAdmin?.fullName || "Super Admin"}</p>
            <p className="truncate text-xs text-text-secondary">{superAdmin?.email || "Platform administrator"}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="h-9 gap-2 px-2" onSelect={() => navigate("/super-admin/settings")}>
            <Settings className="size-4" /> Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="h-9 gap-2 px-2" variant="destructive" onSelect={() => setLogoutOpen(true)}>
            <LogOut className="size-4" /> Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmActionDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="Logout from Super Admin Portal"
        description="You will be signed out from this super admin session and need to login again to continue."
        confirmLabel="Logout"
        confirmVariant="destructive"
        onConfirm={() => dispatch(logoutSuperAdmin())}
      />
    </header>
  );
}
