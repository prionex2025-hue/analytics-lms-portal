import {
  BookOpen,
  BookOpenCheck,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  FileBarChart2,
  FileCheck2,
  LayoutDashboard,
  Layers3,
  School,
  Settings,
  ShieldAlert,
  ShieldUser,
  UserCog,
  Users,
} from "lucide-react";

// Single source of truth for super-admin navigation: the sidebar renders the
// groups and the header resolves the current page title from the same list.
export const SUPER_ADMIN_NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { to: "/super-admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/super-admin/analytics", label: "Analytics", icon: ChartNoAxesCombined },
    ],
  },
  {
    label: "Institutions",
    items: [
      { to: "/super-admin/colleges", label: "Colleges", icon: School },
      { to: "/super-admin/departments", label: "Departments", icon: Building2 },
      { to: "/super-admin/batches", label: "Batches", icon: Layers3 },
    ],
  },
  {
    label: "People",
    items: [
      { to: "/super-admin/system-admins", label: "System Administrators", icon: UserCog },
      { to: "/super-admin/admins", label: "Admins", icon: ShieldUser },
      { to: "/super-admin/students", label: "Students", icon: Users },
    ],
  },
  {
    label: "Assessments",
    items: [
      { to: "/super-admin/tests", label: "Tests", icon: FileCheck2 },
      { to: "/super-admin/question-bank", label: "Question Bank", icon: BookOpen },
      { to: "/super-admin/resources", label: "Learning Resources", icon: BookOpenCheck },
    ],
  },
  {
    label: "Oversight",
    items: [
      { to: "/super-admin/reports", label: "Reports", icon: FileBarChart2 },
      { to: "/super-admin/escalations", label: "Escalations", icon: ShieldAlert, badgeKey: "pendingEscalations" },
      { to: "/super-admin/events", label: "Events", icon: CalendarDays },
    ],
  },
  {
    label: "System",
    items: [{ to: "/super-admin/settings", label: "Settings", icon: Settings }],
  },
];

const EXTRA_TITLES = [
  { match: /^\/super-admin\/tests\/create/, title: "Create Test", section: "Assessments" },
  { match: /^\/super-admin\/tests\/[^/]+\/monitoring/, title: "Live Monitoring", section: "Assessments" },
];

export function resolveSuperAdminPageTitle(pathname) {
  const extra = EXTRA_TITLES.find((entry) => entry.match.test(pathname));
  if (extra) return { title: extra.title, section: extra.section };

  for (const group of SUPER_ADMIN_NAV_GROUPS) {
    const item = group.items.find((entry) => pathname === entry.to || pathname.startsWith(`${entry.to}/`));
    if (item) return { title: item.label, section: group.label };
  }
  return { title: "Super Admin", section: null };
}
