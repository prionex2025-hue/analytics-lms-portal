import { memo, useCallback, useMemo } from "react";
import { Outlet } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import Header from "@/components/Studetns/Header";
import Sidebar from "@/components/Studetns/Sidebar";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { setMobileSidebarOpen, toggleSidebar } from "@/features/Students/uiSlice";
import { upcomingTestsQueryOptions } from "@/services/studentQueries";

function AppShell() {
  const dispatch = useDispatch();
  const sidebarCollapsed = useSelector((state) => state.ui.sidebarCollapsed);
  const mobileSidebarOpen = useSelector((state) => state.ui.mobileSidebarOpen);

  const { data: upcomingPayload } = useQuery(upcomingTestsQueryOptions());

  const upcomingCount = useMemo(() => {
    const items = Array.isArray(upcomingPayload?.items) ? upcomingPayload.items : [];
    const uniqueIds = new Set(items.map((item) => item?.id || item?.test_id).filter(Boolean));
    return uniqueIds.size;
  }, [upcomingPayload]);

  const sidebarOffsetClass = sidebarCollapsed ? "lg:pl-16" : "lg:pl-64";
  const handleMobileSidebarChange = useCallback((open) => {
    dispatch(setMobileSidebarOpen(open));
  }, [dispatch]);
  const handleCloseMobileSidebar = useCallback(() => {
    dispatch(setMobileSidebarOpen(false));
  }, [dispatch]);
  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);
  const handleOpenMobileSidebar = useCallback(() => {
    dispatch(setMobileSidebarOpen(true));
  }, [dispatch]);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar collapsed={sidebarCollapsed} upcomingCount={upcomingCount} />

      <Sheet open={mobileSidebarOpen} onOpenChange={handleMobileSidebarChange}>
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
            <SheetDescription className="sr-only">Student portal sections</SheetDescription>
            <Sidebar
              mobile
              collapsed={false}
              upcomingCount={upcomingCount}
              onNavigate={handleCloseMobileSidebar}
            />
          </SheetContent>
        ) : null}
      </Sheet>

      <main id="main-content" className={`min-w-0 transition-[padding] duration-200 motion-reduce:transition-none ${sidebarOffsetClass}`}>
        <Header
          collapsed={sidebarCollapsed}
          onToggleSidebar={handleToggleSidebar}
          onOpenMobileSidebar={handleOpenMobileSidebar}
        />
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default memo(AppShell);
