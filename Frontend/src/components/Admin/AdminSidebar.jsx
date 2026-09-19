import { NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  LayoutDashboard,
  Building2,
  FileCheck2,
  BookOpenCheck,
  LibraryBig,
  Layers3,
  Users,
  ShieldUser,
  CalendarDays,
  BarChart3,
  ChartNoAxesCombined,
  Settings,
  LogOut,
} from "lucide-react";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { useAdminAuthState, getPortalAuthThunks } from "@/hooks/useAdminAuthState";
import { closeTestCreationDialog } from "@/features/Admin/testCreationSlice";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";

const createNavItems = (basePath) => {
  const collegeAdminOnlyItems = basePath === "/college-admin"
    ? [
        { to: `${basePath}/departments`, label: "Departments", icon: Building2, permissions: [ADMIN_PERMISSIONS.MANAGE_DEPARTMENTS] },
        { to: `${basePath}/admins`, label: "Admin Management", icon: ShieldUser, permissions: [ADMIN_PERMISSIONS.MANAGE_ADMINS] },
      ]
    : [];

  return [
    { to: `${basePath}/dashboard`, label: "Dashboard", icon: LayoutDashboard },
    ...collegeAdminOnlyItems,
    { to: `${basePath}/students`, label: "Students", icon: Users, permissions: [ADMIN_PERMISSIONS.MANAGE_STUDENTS, ADMIN_PERMISSIONS.VIEW_STUDENTS] },
    { to: `${basePath}/tests`, label: "All Tests", icon: FileCheck2, permissions: [ADMIN_PERMISSIONS.VIEW_TESTS, ADMIN_PERMISSIONS.EDIT_TEST, ADMIN_PERMISSIONS.MANAGE_QUESTIONS] },
    { to: `${basePath}/question-bank`, label: "Question Bank", icon: LibraryBig, permissions: [ADMIN_PERMISSIONS.MANAGE_QUESTIONS, ADMIN_PERMISSIONS.VIEW_QUESTION_BANK] },
    { to: `${basePath}/resources`, label: "Learning Resources", icon: BookOpenCheck, permissions: [ADMIN_PERMISSIONS.VIEW_RESOURCES, ADMIN_PERMISSIONS.MANAGE_RESOURCES] },
    { to: `${basePath}/batches`, label: "Batches", icon: Layers3, permissions: [ADMIN_PERMISSIONS.MANAGE_BATCHES, ADMIN_PERMISSIONS.VIEW_BATCHES] },
    { to: `${basePath}/events`, label: "Events", icon: CalendarDays, permissions: [ADMIN_PERMISSIONS.MANAGE_EVENTS, ADMIN_PERMISSIONS.VIEW_EVENTS] },
    { to: `${basePath}/reports`, label: "Reports", icon: BarChart3, permissions: [ADMIN_PERMISSIONS.VIEW_REPORTS] },
    { to: `${basePath}/analytics`, label: "Analytics", icon: ChartNoAxesCombined, permissions: [ADMIN_PERMISSIONS.VIEW_ANALYTICS] },
    { to: `${basePath}/settings`, label: "Settings", icon: Settings },
  ];
};

export default function AdminSidebar({
  basePath = "/admin",
  portalTitle = "Admin Portal",
  portalDescription = "College control and test management",
  logoutTitle = "Logout from Admin Portal",
  logoutDescription = "You will be signed out from this admin session and need to login again to continue.",
  mobile = false,
  onNavigate,
}) {
  const dispatch = useDispatch();
  const location = useLocation();
  const desktopCollapsed = useSelector((state) => state.adminUi?.sidebarCollapsed);
  const collapsed = mobile ? false : desktopCollapsed;
  const permissions = useAdminAuthState()?.permissions || [];
  const testCreationOpen = useSelector((state) => Boolean(state.testCreation?.open));
  const [logoutOpen, setLogoutOpen] = useState(false);
  const navItems = createNavItems(basePath);

  const permissionSet = new Set(permissions);
  const canShowItem = (item) => {
    if (item.allPermissions) {
      return item.allPermissions.every((permission) => permissionSet.has(permission));
    }

    return !item.permissions || item.permissions.some((permission) => permissionSet.has(permission));
  };
  const isNavItemActive = (item, isActive) => {
    const [itemPathname, itemSearch] = item.to.split("?");
    if (itemSearch) {
      return location.pathname === itemPathname && location.search === `?${itemSearch}`;
    }

    if (item.to === `${basePath}/tests`) {
      return isActive && location.search !== "?create=1";
    }

    return isActive;
  };

  return (
    <aside
      className={`${mobile ? "flex h-full w-full" : "fixed inset-y-0 left-0 z-40 hidden lg:flex"} flex-col border-r border-sidebar-border bg-linear-to-b from-primary-dark to-sidebar py-5 text-sidebar-foreground transition-all duration-200 ${
        collapsed ? "w-16 px-2" : mobile ? "px-4" : "w-64 px-4"
      }`}
    >
      <div className={`mb-6 flex items-start gap-3 ${collapsed ? "justify-center" : "justify-between"}`}>
        <div className="flex min-w-0 flex-1 flex-col items-center rounded-2xl border border-white/10 bg-white/5 px-3 py-4 text-center shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)] backdrop-blur-sm transition-transform hover:-translate-y-px">
          <img
            src="/analytics-logo-final.webp"
            alt="Analytics Logo"
            width="1976"
            height="630"
            decoding="async"
            className={`h-8 object-contain brightness-0 invert ${collapsed ? "w-10" : "w-full max-w-44"}`}
          />
          {!collapsed ? (
            <div className="mt-2 space-y-1">
              <p className="text-[15px] font-extrabold uppercase tracking-[0.35em] text-white ">
                {portalTitle}
              </p>
              <p className="text-sm leading-5 text-sidebar-foreground/85">
                {portalDescription}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
        {navItems.filter(canShowItem).map((item) => {
          const IconComponent = item.icon;

          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => {
                if (testCreationOpen) {
                  dispatch(closeTestCreationDialog());
                }
                onNavigate?.();
              }}
              className={({ isActive }) => {
                const active = isNavItemActive(item, isActive);
                return `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm shadow-primary/35 ring-1 ring-sidebar-ring/30"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`;
              }}
              title={collapsed ? item.label : undefined}
            >
              <IconComponent className="size-4" strokeWidth={2.1} />
              {!collapsed ? item.label : null}
            </NavLink>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => setLogoutOpen(true)}
        className="mt-auto flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/30 text-sm font-medium text-sidebar-foreground transition hover:bg-sidebar-accent/50"
        title={collapsed ? "Logout" : undefined}
      >
        <LogOut className="size-4" />
        {!collapsed ? "Logout" : null}
      </button>

      <ConfirmActionDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title={logoutTitle}
        description={logoutDescription}
        confirmLabel="Logout"
        confirmVariant="destructive"
        onConfirm={() => dispatch(getPortalAuthThunks().logout())}
      />
    </aside>
  );
}
