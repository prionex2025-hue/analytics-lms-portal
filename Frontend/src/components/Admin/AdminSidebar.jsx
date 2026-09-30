import { Link, NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { LogOut } from "lucide-react";
import { useAdminAuthState, getPortalAuthThunks } from "@/hooks/useAdminAuthState";
import { closeTestCreationDialog } from "@/features/Admin/testCreationSlice";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import { createAdminNavGroups } from "@/components/Admin/navigation";
import { cn } from "@/lib/utils";

export default function AdminSidebar({
  basePath = "/admin",
  portalTitle = "Admin Portal",
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

  const groups = createAdminNavGroups(basePath)
    .map((group) => ({ ...group, items: group.items.filter(canShowItem) }))
    .filter((group) => group.items.length > 0);
  const badgeLabel = basePath === "/college-admin" ? "College" : "Admin";

  return (
    <aside
      aria-label={`${portalTitle} navigation`}
      className={cn(
        mobile ? "flex h-full w-full" : "fixed inset-y-0 left-0 z-40 hidden lg:flex",
        "flex-col border-r border-border bg-card text-text-primary transition-[width] duration-200 motion-reduce:transition-none",
        !mobile && (collapsed ? "w-16" : "w-64")
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center gap-2.5 border-b border-border", collapsed ? "justify-center px-2" : "px-5")}>
        <Link
          to={`${basePath}/dashboard`}
          onClick={onNavigate}
          className="flex min-w-0 items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`${portalTitle} dashboard`}
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
            {badgeLabel}
          </span>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        {groups.map((group, groupIndex) => (
          <div key={group.label} className={groupIndex > 0 ? "mt-5" : ""}>
            {collapsed ? (
              groupIndex > 0 ? <div className="mx-2 mb-3 border-t border-border" aria-hidden="true" /> : null
            ) : (
              <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-text-secondary/80 uppercase">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const IconComponent = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={() => {
                        if (testCreationOpen) {
                          dispatch(closeTestCreationDialog());
                        }
                        onNavigate?.();
                      }}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex h-10 items-center gap-3 rounded-lg text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                          collapsed ? "justify-center px-0" : "px-3",
                          isNavItemActive(item, isActive) ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-muted hover:text-text-primary"
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isNavItemActive(item, isActive) && !collapsed ? (
                            <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />
                          ) : null}
                          <IconComponent className="size-[18px] shrink-0" aria-hidden="true" />
                          {!collapsed ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
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
        title={logoutTitle}
        description={logoutDescription}
        confirmLabel="Logout"
        confirmVariant="destructive"
        onConfirm={() => dispatch(getPortalAuthThunks().logout())}
      />
    </aside>
  );
}
