import { Outlet } from "react-router-dom";
import Sidebar from "@/components/Studetns/Sidebar";
import Header from "@/components/Studetns/Header";

export default function PortalLayout() {
  return (
    <div className="min-h-screen bg-linear-to-b from-background via-background to-primary/5 lg:flex">
      <Sidebar />
      <main className="flex-1">
        <Header />
        <div className="p-4 sm:p-6 lg:p-7">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
