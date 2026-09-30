import {
  BarChart3,
  BookOpenCheck,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  FileCheck2,
  LayoutDashboard,
  Layers3,
  LibraryBig,
  Settings,
  ShieldUser,
  Users,
} from "lucide-react";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";

// Navigation for the Admin and College Admin portals (they share one shell).
// Items keep their original permission rules; empty groups are hidden.
export const createAdminNavGroups = (basePath) => {
  const isCollegeAdmin = basePath === "/college-admin";
  return [
    {
      label: "Overview",
      items: [
        { to: `${basePath}/dashboard`, label: "Dashboard", icon: LayoutDashboard },
        { to: `${basePath}/reports`, label: "Reports", icon: BarChart3, permissions: [ADMIN_PERMISSIONS.VIEW_REPORTS] },
        { to: `${basePath}/analytics`, label: "Analytics", icon: ChartNoAxesCombined, permissions: [ADMIN_PERMISSIONS.VIEW_ANALYTICS] },
      ],
    },
    {
      label: "Assessments",
      items: [
        { to: `${basePath}/tests`, label: "All Tests", icon: FileCheck2, permissions: [ADMIN_PERMISSIONS.VIEW_TESTS, ADMIN_PERMISSIONS.EDIT_TEST, ADMIN_PERMISSIONS.MANAGE_QUESTIONS] },
        { to: `${basePath}/question-bank`, label: "Question Bank", icon: LibraryBig, permissions: [ADMIN_PERMISSIONS.MANAGE_QUESTIONS, ADMIN_PERMISSIONS.VIEW_QUESTION_BANK] },
        { to: `${basePath}/resources`, label: "Learning Resources", icon: BookOpenCheck, permissions: [ADMIN_PERMISSIONS.VIEW_RESOURCES, ADMIN_PERMISSIONS.MANAGE_RESOURCES] },
      ],
    },
    {
      label: "People",
      items: [
        { to: `${basePath}/students`, label: "Students", icon: Users, permissions: [ADMIN_PERMISSIONS.MANAGE_STUDENTS, ADMIN_PERMISSIONS.VIEW_STUDENTS] },
        { to: `${basePath}/batches`, label: "Batches", icon: Layers3, permissions: [ADMIN_PERMISSIONS.MANAGE_BATCHES, ADMIN_PERMISSIONS.VIEW_BATCHES] },
        ...(isCollegeAdmin
          ? [
              { to: `${basePath}/departments`, label: "Departments", icon: Building2, permissions: [ADMIN_PERMISSIONS.MANAGE_DEPARTMENTS] },
              { to: `${basePath}/admins`, label: "Admin Management", icon: ShieldUser, permissions: [ADMIN_PERMISSIONS.MANAGE_ADMINS] },
            ]
          : []),
      ],
    },
    {
      label: "Campus",
      items: [{ to: `${basePath}/events`, label: "Events", icon: CalendarDays, permissions: [ADMIN_PERMISSIONS.MANAGE_EVENTS, ADMIN_PERMISSIONS.VIEW_EVENTS] }],
    },
    {
      label: "Account",
      items: [{ to: `${basePath}/settings`, label: "Settings", icon: Settings }],
    },
  ];
};

const EXTRA_TITLES = [
  { match: /\/tests\/create$/, title: "Create Test", section: "Assessments" },
  { match: /\/tests\/[^/]+\/monitoring$/, title: "Live Monitoring", section: "Assessments" },
];

export function resolveAdminPageTitle(pathname, basePath) {
  const extra = EXTRA_TITLES.find((entry) => entry.match.test(pathname));
  if (extra) return { title: extra.title, section: extra.section };
  for (const group of createAdminNavGroups(basePath)) {
    const item = group.items.find((entry) => pathname === entry.to || pathname.startsWith(`${entry.to}/`));
    if (item) return { title: item.label, section: group.label };
  }
  return { title: "Dashboard", section: null };
}
