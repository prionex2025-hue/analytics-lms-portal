import { NavLink } from "react-router-dom";
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, School, ShieldUser, UserCog, Users, Building2, FileCheck2, BookOpen, BookOpenCheck, Layers3, CalendarDays, FileBarChart2, ShieldAlert, ChartNoAxesCombined, Settings, LogOut } from "lucide-react";
import { logoutSuperAdmin } from "@/features/SuperAdmin/superAdminAuthSlice";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import { SUPER_ESCALATIONS_QUERY_KEY } from "@/hooks/useSuperAdminEscalationsRealtime";
import { superAdminApi } from "@/services/api";

const navItems = [
  { to: "/super-admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/super-admin/colleges", label: "Colleges", icon: School },
  { to: "/super-admin/system-admins", label: "System Administrators", icon: UserCog },
  { to: "/super-admin/admins", label: "Admins", icon: ShieldUser },
  { to: "/super-admin/students", label: "Students", icon: Users },
  { to: "/super-admin/departments", label: "Departments", icon: Building2 },
  { to: "/super-admin/tests", label: "Tests", icon: FileCheck2 },
  { to: "/super-admin/question-bank", label: "Question Bank", icon: BookOpen },
  { to: "/super-admin/resources", label: "Learning Resources", icon: BookOpenCheck },
  { to: "/super-admin/batches", label: "Batches", icon: Layers3 },
  { to: "/super-admin/events", label: "Events", icon: CalendarDays },
  { to: "/super-admin/reports", label: "Reports", icon: FileBarChart2 },
  { to: "/super-admin/escalations", label: "Escalations", icon: ShieldAlert, badgeKey: "pendingEscalations" },
  { to: "/super-admin/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { to: "/super-admin/settings", label: "Settings", icon: Settings },
];

export default function SuperAdminSidebar({ mobile = false, onNavigate }) {
  const dispatch = useDispatch();
  const desktopCollapsed = useSelector((state) => state.superAdminUi?.sidebarCollapsed);
  const collapsed = mobile ? false : desktopCollapsed;
  const [logoutOpen, setLogoutOpen] = useState(false);

  // Pending-escalation count for the nav badge. Kept fresh by the layout's
  // realtime subscription; the interval is only a fallback if the socket drops.
  const pendingEscalationsQuery = useQuery({
    queryKey: [...SUPER_ESCALATIONS_QUERY_KEY, "pending-count"],
    queryFn: () => superAdminApi.getEscalatedAnomalies("?status=pending&limit=1"),
    staleTime: 30000,
    refetchInterval: 120000,
  });
  const badges = { pendingEscalations: Number(pendingEscalationsQuery.data?.summary?.pending || 0) };

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
              <p className="text-[15px] font-extrabold uppercase tracking-[0.35em] text-white">
                Super Admin Portal
              </p>
              <p className="text-sm leading-5 text-sidebar-foreground/85">
                Global control center for colleges
              </p>
            </div>
          ) : null}
        </div>
        
      </div>

      <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
        {navItems.map((item) => {
          const IconComponent = item.icon;
          const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;
          const badgeLabel = badgeCount > 99 ? "99+" : String(badgeCount);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm shadow-primary/35 ring-1 ring-sidebar-ring/30"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`
              }
              title={collapsed ? (badgeCount ? `${item.label} (${badgeCount} pending)` : item.label) : undefined}
            >
              <span className="relative">
                <IconComponent className="size-4" strokeWidth={2.1} />
                {collapsed && badgeCount ? <span className="absolute -right-1 -top-1 size-2 rounded-full bg-danger" aria-hidden="true" /> : null}
              </span>
              {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
              {!collapsed && badgeCount ? (
                <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold leading-none text-white tabular-nums" aria-label={`${badgeCount} pending`}>
                  {badgeLabel}
                </span>
              ) : null}
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
        title="Logout from Super Admin Portal"
        description="You will be signed out from this super admin session and need to login again to continue."
        confirmLabel="Logout"
        confirmVariant="destructive"
        onConfirm={() => dispatch(logoutSuperAdmin())}
      />
    </aside>
  );
}
