import { Link, NavLink } from "react-router-dom";
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { logoutSuperAdmin } from "@/features/SuperAdmin/superAdminAuthSlice";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import { SUPER_ESCALATIONS_QUERY_KEY } from "@/hooks/useSuperAdminEscalationsRealtime";
import { superAdminApi } from "@/services/api";
import { SUPER_ADMIN_NAV_GROUPS } from "@/components/SuperAdmin/navigation";
import { cn } from "@/lib/utils";

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
      aria-label="Super admin navigation"
      className={cn(
        mobile ? "flex h-full w-full" : "fixed inset-y-0 left-0 z-40 hidden lg:flex",
        "flex-col border-r border-border bg-card text-text-primary transition-[width] duration-200 motion-reduce:transition-none",
        !mobile && (collapsed ? "w-16" : "w-64")
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center gap-2.5 border-b border-border", collapsed ? "justify-center px-2" : "px-5")}>
        <Link
          to="/super-admin/dashboard"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="Super admin dashboard"
        >
          <img
            src="/analytics-logo-final.webp"
            alt="Analytics"
            width="1976"
            height="630"
            decoding="async"
            className={cn("h-7 object-contain", collapsed ? "w-9 object-center" : "w-auto max-w-32 object-left")}
          />
        </Link>
        {!collapsed ? (
          <span className="ml-auto rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
            Super
          </span>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        {SUPER_ADMIN_NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label} className={groupIndex > 0 ? "mt-5" : ""}>
            {collapsed ? (
              groupIndex > 0 ? <div className="mx-2 mb-3 border-t border-border" aria-hidden="true" /> : null
            ) : (
              <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-text-secondary/80 uppercase">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const IconComponent = item.icon;
                const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;
                const badgeLabel = badgeCount > 99 ? "99+" : String(badgeCount);
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={onNavigate}
                      title={collapsed ? (badgeCount ? `${item.label} (${badgeCount} pending)` : item.label) : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex h-10 items-center gap-3 rounded-lg text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                          collapsed ? "justify-center px-0" : "px-3",
                          isActive ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-muted hover:text-text-primary"
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && !collapsed ? (
                            <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />
                          ) : null}
                          <span className="relative">
                            <IconComponent className="size-[18px]" aria-hidden="true" />
                            {collapsed && badgeCount ? (
                              <span className="absolute -top-1 -right-1 size-2 rounded-full bg-danger ring-2 ring-card" aria-hidden="true" />
                            ) : null}
                          </span>
                          {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
                          {!collapsed && badgeCount ? (
                            <span
                              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white tabular-nums"
                              aria-label={`${badgeCount} pending`}
                            >
                              {badgeLabel}
                            </span>
                          ) : null}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <button
          type="button"
          onClick={() => setLogoutOpen(true)}
          className={cn(
            "flex h-10 w-full items-center gap-3 rounded-lg text-sm font-medium text-text-secondary outline-none transition-colors hover:bg-danger/10 hover:text-danger focus-visible:ring-3 focus-visible:ring-ring/50",
            collapsed ? "justify-center" : "px-3"
          )}
          title={collapsed ? "Logout" : undefined}
        >
          <LogOut className="size-[18px]" aria-hidden="true" />
          {!collapsed ? "Logout" : <span className="sr-only">Logout</span>}
        </button>
      </div>

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
