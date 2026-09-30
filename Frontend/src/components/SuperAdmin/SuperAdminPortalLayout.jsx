import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useSelector } from "react-redux";
import SuperAdminSidebar from "@/components/SuperAdmin/SuperAdminSidebar";
import SuperAdminHeader from "@/components/SuperAdmin/SuperAdminHeader";
import ImpersonationBanner from "@/components/SuperAdmin/ImpersonationBanner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import useSuperAdminEscalationsRealtime from "@/hooks/useSuperAdminEscalationsRealtime";

export default function SuperAdminPortalLayout() {
  const sidebarCollapsed = useSelector((state) => state.superAdminUi?.sidebarCollapsed);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  useSuperAdminEscalationsRealtime();

  return (
    <div className="min-h-screen bg-background">
      <SuperAdminSidebar />
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        {mobileSidebarOpen ? (
          <SheetContent
            side="left"
            className="w-72 p-0 sm:max-w-72"
            showCloseButton={false}
            onOpenAutoFocus={(event) => {
              // Start keyboard focus on the current page's link instead of letting
              // the dialog auto-focus an arbitrary control (e.g. Logout).
              const current = event.currentTarget?.querySelector?.('nav a[aria-current="page"]');
              if (current) {
                event.preventDefault();
                current.focus();
              }
            }}
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Super admin sections</SheetDescription>
            <SuperAdminSidebar mobile onNavigate={() => setMobileSidebarOpen(false)} />
          </SheetContent>
        ) : null}
      </Sheet>
      <main
        id="main-content"
        className={`min-w-0 transition-[padding] duration-200 motion-reduce:transition-none ${sidebarCollapsed ? "lg:pl-16" : "lg:pl-64"}`}
      >
        <ImpersonationBanner />
        <SuperAdminHeader onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
        <div className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
