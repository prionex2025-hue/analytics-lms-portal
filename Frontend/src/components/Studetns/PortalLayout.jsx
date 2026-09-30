import { Outlet } from "react-router-dom";
import Sidebar from "@/components/Studetns/Sidebar";
import Header from "@/components/Studetns/Header";

export default function PortalLayout() {
  return (
    <div className="min-h-screen bg-background lg:flex">
      <Sidebar />
      <main className="flex-1">
        <Header />
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
