// src/components/layout/TopBar.tsx

import { useLocation } from "react-router-dom";
import { User, Bell } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/dispatches": "Dispatches",
  "/labour": "Labour Management",
  "/processor": "Processor Management",
  "/stock-owner": "Stock by Owner",
  "/stock-company": "Stock by Company",
  "/group-bills": "Group Bills",
  "/group-drawings": "Group Drawings",
  "/folders": "Folders",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/folders/")) return "Folder Detail";
  if (pathname.startsWith("/dispatches/")) return "Dispatch Details";
  return "Admin Panel";
}

function getBreadcrumb(pathname: string): string[] {
  const crumbs: string[] = ["Admin"];
  if (pathname === "/") {
    crumbs.push("Dashboard");
  } else if (pathname.startsWith("/folders/")) {
    crumbs.push("Folders", "Detail");
  } else if (pathname.startsWith("/dispatches/")) {
    crumbs.push("Dispatches", "Details");
  } else {
    crumbs.push(getPageTitle(pathname));
  }
  return crumbs;
}

export default function TopBar() {
  const location = useLocation();
  const { adminUsername } = useAuth();

  const title = getPageTitle(location.pathname);
  const breadcrumbs = getBreadcrumb(location.pathname);

  return (
    <header className="h-[72px] bg-surface/80 backdrop-blur-xl border-b border-border flex items-center justify-between px-8 sticky top-0 z-30 min-w-0">
      {/* Left side — title + breadcrumb */}
      <div className="min-w-0 overflow-hidden">
        <h2 className="text-xl font-bold text-text leading-tight truncate">{title}</h2>
        <div className="flex items-center gap-2 text-[13px] text-text-muted mt-1">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-2 whitespace-nowrap">
              {i > 0 && <span className="text-border">/</span>}
              <span className={i === breadcrumbs.length - 1 ? "text-text-secondary" : ""}>
                {crumb}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Right side — notifications + profile */}
      <div className="flex items-center gap-4 shrink-0 ml-4">
        <button
          className="
            w-10 h-10 rounded-xl
            bg-surface-hover/50 border border-border
            flex items-center justify-center
            text-text-muted hover:text-text hover:bg-surface-hover
            transition-colors duration-200 cursor-pointer
            relative
          "
          title="Notifications"
        >
          <Bell size={20} />
        </button>

        <div className="flex items-center gap-3 pl-4 border-l border-border">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
            <User size={18} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-text leading-tight capitalize truncate">
              {adminUsername}
            </p>
            <p className="text-[11px] text-text-muted font-semibold mt-0.5">
              Administrator
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
