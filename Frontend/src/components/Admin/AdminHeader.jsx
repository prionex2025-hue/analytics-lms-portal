import { ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings } from "lucide-react";
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { useAdminAuthState, getPortalAuthThunks } from "@/hooks/useAdminAuthState";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AdminCommandPalette from "@/components/Admin/AdminCommandPalette";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import { toggleSidebar } from "@/features/Admin/adminUiSlice";
import { resolveAdminPageTitle } from "@/components/Admin/navigation";

const isCollegeAdminPath = (pathname) =>
  pathname === "/college-admin" || pathname.startsWith("/college-admin/");

const getInitials = (name) =>
  (name || "Admin")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

export default function AdminHeader({
  workspaceLabel = "Admin Workspace",
  basePath = null,
  onOpenMobileSidebar,
  logoutTitle = "Logout from Admin Portal",
  logoutDescription = "You will be signed out from this admin session and need to login again to continue.",
}) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const admin = useAdminAuthState()?.admin;
  const collapsed = useSelector((state) => state.adminUi?.sidebarCollapsed);
  const [searchOpen, setSearchOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const college = admin?.college;
  const resolvedBasePath = basePath || (isCollegeAdminPath(location.pathname) ? "/college-admin" : "/admin");
  const { title } = resolveAdminPageTitle(location.pathname, resolvedBasePath);

  return (
    <>
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
          <p className="hidden truncate text-xs text-text-secondary sm:block">
            {college?.name || "Your College"}
            {college?.code ? ` · ${college.code}` : ""} · {workspaceLabel}
          </p>
          <p className="truncate text-base leading-tight font-semibold text-text-primary">{title}</p>
        </div>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-text-secondary outline-none transition-colors hover:border-primary/40 hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50 md:w-64"
          title="Search admin workspace"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden flex-1 text-left md:inline">Search…</span>
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] text-text-secondary md:inline">Ctrl K</kbd>
          <span className="sr-only md:hidden">Search admin workspace</span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-10 items-center gap-2.5 rounded-lg pr-1 pl-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:pr-2"
            >
              <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{getInitials(admin?.fullName)}</span>
              <span className="hidden max-w-40 text-left lg:block">
                <span className="block truncate text-sm leading-tight font-medium text-text-primary">{admin?.fullName || "Admin"}</span>
                <span className="block truncate text-xs leading-tight text-text-secondary">{admin?.employeeId || (isCollegeAdminPath(location.pathname) ? "College Admin" : "Admin")}</span>
              </span>
              <ChevronDown className="hidden size-4 text-text-secondary lg:block" aria-hidden="true" />
              <span className="sr-only">Open account menu</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="truncate text-sm font-medium text-text-primary">{admin?.fullName || "Admin"}</p>
              <p className="truncate text-xs text-text-secondary">{admin?.email || admin?.employeeId || ""}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="h-9 gap-2 px-2" onSelect={() => navigate(`${resolvedBasePath}/settings`)}>
              <Settings className="size-4" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="h-9 gap-2 px-2" variant="destructive" onSelect={() => setLogoutOpen(true)}>
              <LogOut className="size-4" /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <AdminCommandPalette open={searchOpen} onOpenChange={setSearchOpen} basePath={resolvedBasePath} />
      <ConfirmActionDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title={logoutTitle}
        description={logoutDescription}
        confirmLabel="Logout"
        confirmVariant="destructive"
        onConfirm={() => dispatch(getPortalAuthThunks().logout())}
      />
    </>
  );
}
