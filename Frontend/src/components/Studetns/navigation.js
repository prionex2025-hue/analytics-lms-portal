import {
  BookOpenCheck,
  CalendarDays,
  Clock3,
  FileText,
  Medal,
  PlayCircle,
  Settings,
  User,
} from "lucide-react";

// Single source of truth for student navigation: the sidebar renders the
// groups, and the header resolves the current page title from the same list.
export const NAV_GROUPS = [
  {
    label: "Tests",
    items: [
      { to: "/tests/ongoing", label: "Ongoing Tests", icon: PlayCircle },
      { to: "/tests/upcoming", label: "Upcoming Tests", icon: Clock3, badgeKey: "upcoming" },
    ],
  },
  {
    label: "Performance",
    items: [
      { to: "/reports", label: "Reports", icon: FileText },
      { to: "/leaderboard", label: "Leaderboard", icon: Medal },
    ],
  },
  {
    label: "Campus",
    items: [
      { to: "/events", label: "Events", icon: CalendarDays },
      { to: "/resources", label: "Learning Resources", icon: BookOpenCheck },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/profile", label: "Profile", icon: User },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const EXTRA_TITLES = [
  { match: /^\/results\//, title: "Test Result" },
  { match: /^\/tests\/?$/, title: "My Tests" },
];

export function resolvePageTitle(pathname) {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((entry) => pathname === entry.to || pathname.startsWith(`${entry.to}/`));
    if (item) {
      return { title: item.label, section: group.label };
    }
  }

  const extra = EXTRA_TITLES.find((entry) => entry.match.test(pathname));
  return { title: extra?.title || "Student Portal", section: null };
}
