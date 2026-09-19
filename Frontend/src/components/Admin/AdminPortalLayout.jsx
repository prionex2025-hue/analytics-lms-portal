import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useSelector } from "react-redux";
import AdminSidebar from "@/components/Admin/AdminSidebar";
import AdminHeader from "@/components/Admin/AdminHeader";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export default function AdminPortalLayout({
  basePath = "/admin",
  portalTitle = "Admin Portal",
  portalDescription = "College control and test management",
  logoutTitle = "Logout from Admin Portal",
  logoutDescription = "You will be signed out from this admin session and need to login again to continue.",
  workspaceLabel = "Admin Workspace",
}) {
  const sidebarCollapsed = useSelector((state) => state.adminUi?.sidebarCollapsed);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background lg:flex">
      <AdminSidebar
        basePath={basePath}
        portalTitle={portalTitle}
        portalDescription={portalDescription}
        logoutTitle={logoutTitle}
        logoutDescription={logoutDescription}
      />
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        {mobileSidebarOpen ? (
          <SheetContent side="left" className="w-72 p-0 sm:w-80" showCloseButton={false}>
            <AdminSidebar basePath={basePath} portalTitle={portalTitle} portalDescription={portalDescription} logoutTitle={logoutTitle} logoutDescription={logoutDescription} mobile onNavigate={() => setMobileSidebarOpen(false)} />
          </SheetContent>
        ) : null}
      </Sheet>
      <main className={`min-w-0 flex-1 transition-all duration-200 ${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"}`}>
        <AdminHeader workspaceLabel={workspaceLabel} basePath={basePath} onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
        <div className="min-w-0 p-3 sm:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
