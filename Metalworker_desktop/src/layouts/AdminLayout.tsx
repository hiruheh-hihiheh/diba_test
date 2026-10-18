// src/layouts/AdminLayout.tsx

import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Hexagon, Loader2 } from "lucide-react";
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
      <div
        className="min-h-dvh-fallback bg-bg flex items-center justify-center"
        style={{ minHeight: "100dvh" }}
      >
        <div className="flex flex-col items-center gap-5">
          <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center shadow-[0_10px_30px_-12px_rgba(201,128,82,0.8)]">
            <Hexagon size={22} className="text-[var(--theme-primary-text)]" strokeWidth={2.4} />
          </div>
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 size={14} className="animate-spin" />
            <p className="text-[13px] font-medium">Loading your workspace…</p>
          </div>
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
      {/* Keyboard users can jump past the rail and top bar straight into the
          page. Off-screen until focused, then it slides into view. */}
      <a
        href="#admin-content"
        className="fixed left-4 top-4 z-[300] -translate-y-24 focus:translate-y-0 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-[var(--theme-primary-text)] shadow-xl transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Skip to content
      </a>

      <Sidebar />

      <div
        className="flex flex-col transition-[margin-left] duration-300 ease-out min-w-0"
        style={{ marginLeft: contentMargin }}
      >
        <TopBar />

        {/* `min-w-0` lets wide tables scroll inside the page instead of
            stretching the layout; padding shrinks on narrow windows and grows on
            a large monitor so the content does not hug the window edge. */}
        <main
          id="admin-content"
          tabIndex={-1}
          className="px-4 sm:px-6 lg:px-8 py-5 sm:py-6 pb-14 min-w-0 flex-1 outline-none"
        >
          <div className="w-full max-w-[1720px] mx-auto">
            <Outlet />
          </div>
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
