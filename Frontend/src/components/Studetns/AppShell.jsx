import { memo, useCallback, useMemo } from "react";
import { Outlet } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import Header from "@/components/Studetns/Header";
import Sidebar from "@/components/Studetns/Sidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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

  const sidebarOffsetClass = sidebarCollapsed ? "lg:ml-12" : "lg:ml-60";
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
    <div className="min-h-screen bg-linear-to-b from-background via-background to-primary/5">
      <Sidebar collapsed={sidebarCollapsed} upcomingCount={upcomingCount} />

      <Sheet open={mobileSidebarOpen} onOpenChange={handleMobileSidebarChange}>
        {mobileSidebarOpen ? (
          <SheetContent side="left" className="w-72 sm:w-80 p-0" showCloseButton={false}>
            <Sidebar
              mobile
              collapsed={false}
              upcomingCount={upcomingCount}
              onNavigate={handleCloseMobileSidebar}
            />
          </SheetContent>
        ) : null}
      </Sheet>

      <main className={`min-w-0 transition-all duration-200 ${sidebarOffsetClass}`}>
        <Header
          collapsed={sidebarCollapsed}
          onToggleSidebar={handleToggleSidebar}
          onOpenMobileSidebar={handleOpenMobileSidebar}
        />
        <div className="p-3 sm:p-6 lg:p-7">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default memo(AppShell);
