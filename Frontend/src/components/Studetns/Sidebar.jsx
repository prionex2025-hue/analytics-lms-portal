import { memo } from "react";
import { Link, NavLink } from "react-router-dom";
import { useDispatch } from "react-redux";
import { LogOut } from "lucide-react";
import { logoutStudent } from "@/features/Students/authSlice";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "@/components/Studetns/navigation";

function Sidebar({ collapsed, mobile = false, onNavigate, upcomingCount = 0 }) {
  const dispatch = useDispatch();
  const shellWidthClass = collapsed ? "w-16" : "w-64";
  const shellPositionClass = mobile
    ? "flex h-full w-full"
    : `fixed inset-y-0 left-0 z-40 hidden lg:flex ${shellWidthClass}`;
  const badges = { upcoming: upcomingCount };

  return (
    <aside
      aria-label="Student navigation"
      className={cn(
        shellPositionClass,
        "flex-col border-r border-border bg-card text-text-primary transition-[width] duration-200 motion-reduce:transition-none"
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center border-b border-border", collapsed ? "justify-center px-2" : "px-5")}>
        <Link
          to="/tests/ongoing"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="Student portal home"
        >
          <img
            src="/analytics-logo-final.webp"
            alt="Analytics"
            width="1976"
            height="630"
            decoding="async"
            className={cn("h-7 object-contain object-left dark:brightness-0 dark:invert", collapsed ? "w-9 object-center" : "w-auto max-w-36")}
          />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label} className={groupIndex > 0 ? "mt-5" : ""}>
            {collapsed ? (
              groupIndex > 0 ? <div className="mx-2 mb-3 border-t border-border" aria-hidden="true" /> : null
            ) : (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-text-secondary/80">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const badge = item.badgeKey ? badges[item.badgeKey] : 0;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex h-10 items-center gap-3 rounded-lg text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                          collapsed ? "justify-center px-0" : "px-3",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-text-secondary hover:bg-muted hover:text-text-primary"
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && !collapsed ? (
                            <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />
                          ) : null}
                          <item.icon className="size-[18px] shrink-0" aria-hidden="true" />
                          {!collapsed ? <span className="truncate">{item.label}</span> : null}
                          {badge > 0 ? (
                            collapsed ? (
                              <span className="absolute top-1.5 right-2 size-2 rounded-full bg-primary" aria-label={`${badge} upcoming`} />
                            ) : (
                              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">
                                {badge}
                              </span>
                            )
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
          onClick={() => dispatch(logoutStudent())}
          title={collapsed ? "Log out" : undefined}
          className={cn(
            "flex h-10 w-full items-center gap-3 rounded-lg text-sm font-medium text-text-secondary outline-none transition-colors hover:bg-danger/10 hover:text-danger focus-visible:ring-3 focus-visible:ring-ring/50",
            collapsed ? "justify-center" : "px-3"
          )}
        >
          <LogOut className="size-[18px] shrink-0" aria-hidden="true" />
          {!collapsed ? "Log out" : <span className="sr-only">Log out</span>}
        </button>
      </div>
    </aside>
  );
}

export default memo(Sidebar);
