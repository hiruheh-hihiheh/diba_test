// src/layouts/AdminLayout.tsx

import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { SidebarProvider, useSidebar } from "../hooks/useSidebar";
import { PageMetaProvider } from "../contexts/PageMetaContext";
import Sidebar from "../components/layout/Sidebar";
import TopBar from "../components/layout/TopBar";

function AdminLayoutInner() {
  const { session, profile, loading } = useAuth();
  const { collapsed, isMobile, mobileOpen } = useSidebar();
  const location = useLocation();

  // A route change should always return the admin to the top of the new screen —
  // but preserve the in-page scroll while working, which is handled by the
  // pages themselves (they no longer reset scroll on mutations).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  // While the mobile drawer is open the page behind it must not scroll.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  if (loading) {
    return (
      <div className="min-h-dvh-fallback bg-bg flex items-center justify-center" style={{ minHeight: "100dvh" }}>
        <div className="flex flex-col items-center gap-5">
          <Loader2 size={40} className="text-primary animate-spin" />
          <p className="text-text-muted text-base font-medium">Loading your workspace…</p>
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

  // Below `lg` the rail is an overlay drawer, so the content column takes the
  // full width instead of being squeezed into 280px - sidebarWidth.
  const contentMargin = isMobile ? 0 : collapsed ? 80 : 280;

  return (
    <div className="min-h-dvh-fallback bg-bg" style={{ minHeight: "100dvh" }}>
      <Sidebar />

      <div
        className="flex flex-col transition-[margin-left] duration-300 ease-in-out min-w-0"
        style={{ marginLeft: contentMargin }}
      >
        <TopBar />

        {/* `min-w-0` lets wide tables scroll inside the page instead of
            stretching the layout; padding shrinks on narrow windows. */}
        <main className="p-4 sm:p-6 lg:p-8 min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  return (
    <SidebarProvider>
      <PageMetaProvider>
        <AdminLayoutInner />
      </PageMetaProvider>
    </SidebarProvider>
  );
}
