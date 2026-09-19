import { memo } from "react";
import { Link, NavLink } from "react-router-dom";
import { useDispatch } from "react-redux";
import {
  CalendarDays,
  FileText,
  BookOpenCheck,
  Medal,
  Settings,
  User,
  PlayCircle,
  Clock3,
  LogOut,
} from "lucide-react";
import { logoutStudent } from "@/features/Students/authSlice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/tests/ongoing", label: "Ongoing Tests", icon: PlayCircle },
  { to: "/tests/upcoming", label: "Upcoming Tests", icon: Clock3 },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/resources", label: "Learning Resources", icon: BookOpenCheck },
  { to: "/leaderboard", label: "Leaderboard", icon: Medal },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/profile", label: "Profile", icon: User },
];

function Sidebar({ collapsed, mobile = false, onNavigate, upcomingCount = 0 }) {
  const dispatch = useDispatch();
  const shellWidthClass = collapsed ? "w-12" : "w-60";
  const shellPositionClass = mobile
    ? "flex h-full w-full max-w-80"
    : `fixed inset-y-0 left-0 z-40 hidden lg:flex ${shellWidthClass}`;

  return (
    <aside
      className={`${shellPositionClass} flex-col border-r border-sidebar-border bg-linear-to-b from-primary-dark to-sidebar px-2 py-4 text-sidebar-foreground transition-all duration-200`}
    >
      <Link
        to="/tests/ongoing"
        onClick={onNavigate}
        className="mb-6 flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-4 text-center shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)] backdrop-blur-sm transition-transform hover:-translate-y-px"
      >
        <div className="flex w-full items-center justify-center">
          <img
            src="/analytics-logo-final.webp"
            alt="Analytics Logo"
            width="1976"
            height="630"
            decoding="async"
            className={`h-8 object-contain brightness-0 invert ${collapsed ? "w-10" : "w-full max-w-44"}`}
          />
        </div>
        {!collapsed ? (
          <div className="space-y-1">
            <p className="text-[10px] text-white font-extrabold uppercase tracking-[0.35em] ">
              Student Portal
            </p>
            <p className="text-sm leading-5 text-sidebar-foreground/85">
              Focused mode for tests and performance
            </p>
          </div>
        ) : null}
      </Link>

      <nav className="space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `group flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground ring-1 ring-sidebar-ring/30 shadow-sm shadow-primary/35"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`
            }
          >
            <item.icon className="size-4 shrink-0" strokeWidth={2.2} />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
            {!collapsed && item.to === "/tests/upcoming" ? (
              <Badge
                variant="secondary"
                className="ml-auto bg-sidebar-accent text-[10px] font-semibold text-sidebar-foreground"
              >
                {upcomingCount}
              </Badge>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-2.5 pt-6">
        <Button
          type="button"
          onClick={() => dispatch(logoutStudent())}
          variant="outline"
          className={`h-10 w-full rounded-lg border-sidebar-border bg-sidebar-accent/30 text-sidebar-foreground hover:bg-sidebar-accent/50 ${collapsed ? "px-0" : ""}`}
        >
          <LogOut className="size-4" />
          {!collapsed ? "Logout" : null}
        </Button>
      </div>
    </aside>
  );
}

export default memo(Sidebar);
