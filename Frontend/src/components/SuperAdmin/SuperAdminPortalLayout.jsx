import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useSelector } from "react-redux";
import SuperAdminSidebar from "@/components/SuperAdmin/SuperAdminSidebar";
import SuperAdminHeader from "@/components/SuperAdmin/SuperAdminHeader";
import ImpersonationBanner from "@/components/SuperAdmin/ImpersonationBanner";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export default function SuperAdminPortalLayout() {
  const sidebarCollapsed = useSelector((state) => state.superAdminUi?.sidebarCollapsed);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background lg:flex">
      <SuperAdminSidebar />
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        {mobileSidebarOpen ? (
          <SheetContent side="left" className="w-72 p-0 sm:w-80" showCloseButton={false}>
            <SuperAdminSidebar mobile onNavigate={() => setMobileSidebarOpen(false)} />
          </SheetContent>
        ) : null}
      </Sheet>
      <main className={`min-w-0 flex-1 transition-all duration-200 ${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"}`}>
        <ImpersonationBanner />
        <SuperAdminHeader onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
        <div className="min-w-0 p-3 sm:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
