// src/layouts/AdminLayout.tsx

import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { SidebarProvider, useSidebar } from "../hooks/useSidebar";
import Sidebar from "../components/layout/Sidebar";
import TopBar from "../components/layout/TopBar";

function AdminLayoutInner() {
  const { session, profile, loading } = useAuth();
  const { collapsed } = useSidebar();

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-5">
          <Loader2 size={44} className="text-primary animate-spin" />
          <p className="text-text-muted text-base font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (profile && (profile.role !== "admin" || !profile.is_active)) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar />

      <div
        className="transition-all duration-300 ease-in-out"
        style={{ marginLeft: collapsed ? 80 : 280 }}
      >
        <TopBar />
        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  return (
    <SidebarProvider>
      <AdminLayoutInner />
    </SidebarProvider>
  );
}
