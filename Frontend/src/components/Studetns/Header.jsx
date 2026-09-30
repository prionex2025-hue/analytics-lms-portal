import { memo } from "react";
import { ChevronDown, LogOut, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun, User } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutStudent } from "@/features/Students/authSlice";
import { setTheme } from "@/features/Students/uiSlice";
import { optimizeCloudinaryImage } from "@/lib/cloudinary";
import { resolvePageTitle } from "@/components/Studetns/navigation";

const THEME_CYCLE = { light: "dark", dark: "system", system: "light" };
const THEME_META = {
  light: { icon: Sun, label: "Light theme" },
  dark: { icon: Moon, label: "Dark theme" },
  system: { icon: Monitor, label: "System theme" },
};

const getInitials = (name) =>
  (name || "Student")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

function Header({ collapsed, onToggleSidebar, onOpenMobileSidebar }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = useSelector((state) => state.auth.user);
  const theme = useSelector((state) => state.ui.theme || "system");
  const { title, section } = resolvePageTitle(pathname);
  const ThemeIcon = (THEME_META[theme] || THEME_META.system).icon;
  const nextTheme = THEME_CYCLE[theme] || "light";

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/75 sm:px-6">
      <Button variant="ghost" size="icon-lg" className="size-10 -ml-1 lg:hidden" onClick={onOpenMobileSidebar}>
        <Menu className="size-5" />
        <span className="sr-only">Open navigation</span>
      </Button>

      <Button
        variant="ghost"
        size="icon-lg"
        className="size-10 -ml-2 hidden text-text-secondary lg:inline-flex"
        onClick={onToggleSidebar}
        aria-pressed={collapsed}
      >
        {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
        <span className="sr-only">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
      </Button>

      <div className="min-w-0 flex-1">
        {section ? <p className="hidden text-xs text-text-secondary sm:block">{section}</p> : null}
        <p className="truncate text-base font-semibold leading-tight text-text-primary">{title}</p>
      </div>

      <Button
        variant="ghost"
        size="icon-lg"
        className="size-10 text-text-secondary"
        onClick={() => dispatch(setTheme(nextTheme))}
        title={`${(THEME_META[theme] || THEME_META.system).label} — switch to ${nextTheme}`}
      >
        <ThemeIcon className="size-5" />
        <span className="sr-only">Switch to {nextTheme} theme</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 items-center gap-2.5 rounded-lg pr-1 pl-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:pr-2"
          >
            <Avatar className="size-8 rounded-full after:hidden">
              <AvatarImage
                src={optimizeCloudinaryImage(user?.avatarUrl, { width: 64, height: 64, gravity: "face" })}
                alt=""
                className="rounded-full object-cover"
              />
              <AvatarFallback className="rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {getInitials(user?.fullName)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-40 text-left sm:block">
              <span className="block truncate text-sm font-medium leading-tight text-text-primary">{user?.fullName || "Student"}</span>
              <span className="block truncate text-xs leading-tight text-text-secondary">{user?.studentId || "—"}</span>
            </span>
            <ChevronDown className="hidden size-4 text-text-secondary sm:block" aria-hidden="true" />
            <span className="sr-only">Open account menu</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-medium text-text-primary">{user?.fullName || "Student"}</p>
            <p className="truncate text-xs text-text-secondary">{user?.email || user?.studentId || ""}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem className="h-9 gap-2 px-2" onSelect={() => navigate("/profile")}>
              <User className="size-4" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem className="h-9 gap-2 px-2" onSelect={() => navigate("/settings")}>
              <Settings className="size-4" /> Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="h-9 gap-2 px-2" variant="destructive" onSelect={() => dispatch(logoutStudent())}>
            <LogOut className="size-4" /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

export default memo(Header);
