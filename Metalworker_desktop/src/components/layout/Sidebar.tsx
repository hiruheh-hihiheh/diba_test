// src/components/layout/Sidebar.tsx

import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Truck,
  Users,
  UserCog,
  Package,
  Building2,
  FileText,
  PenTool,
  FolderOpen,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Hexagon,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useSidebar } from "../../hooks/useSidebar";

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", icon: <LayoutDashboard size={22} />, path: "/" },
      { label: "Dispatches", icon: <Truck size={22} />, path: "/dispatches" },
    ],
  },
  {
    title: "PEOPLE",
    items: [
      { label: "Labour", icon: <Users size={22} />, path: "/labour" },
      { label: "Processor", icon: <UserCog size={22} />, path: "/processor" },
    ],
  },
  {
    title: "INVENTORY",
    items: [
      { label: "Stock by Owner", icon: <Package size={22} />, path: "/stock-owner" },
      { label: "Stock by Company", icon: <Building2 size={22} />, path: "/stock-company" },
    ],
  },
  {
    title: "DOCUMENTS",
    items: [
      { label: "Group Bills", icon: <FileText size={22} />, path: "/group-bills" },
      { label: "Group Drawings", icon: <PenTool size={22} />, path: "/group-drawings" },
    ],
  },
  {
    title: "ORGANIZATION",
    items: [
      { label: "Folders", icon: <FolderOpen size={22} />, path: "/folders" },
    ],
  },
];

export default function Sidebar() {
  const { collapsed, toggle } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  async function handleLogout() {
    if (window.confirm("Are you sure you want to sign out?")) {
      await signOut();
      navigate("/login");
    }
  }

  return (
    <aside
      className={`
        fixed left-0 top-0 bottom-0 z-40
        flex flex-col
        bg-surface border-r border-border
        transition-[width] duration-300 ease-in-out
        ${collapsed ? "w-[80px]" : "w-[280px]"}
      `}
    >
      {/* ── LOGO ─────────────────────────── */}
      <div className="flex items-center gap-3.5 px-5 h-[72px] border-b border-border shrink-0">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0 shadow-lg shadow-primary/25">
          <Hexagon size={22} className="text-white" />
        </div>
        {!collapsed && (
          <div className="animate-fade-in overflow-hidden">
            <h1 className="text-[15px] font-extrabold text-text tracking-wide whitespace-nowrap">
              METALWORKER
            </h1>
            <p className="text-[11px] font-semibold text-text-muted tracking-[0.15em]">
              ADMIN PANEL
            </p>
          </div>
        )}
      </div>

      {/* ── NAVIGATION ───────────────────── */}
      <nav className="flex-1 overflow-y-auto py-5 px-3.5 space-y-7">
        {navSections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <p className="text-[11px] font-bold text-text-muted/70 tracking-[0.15em] px-3 mb-2.5">
                {section.title}
              </p>
            )}
            <div className="space-y-1.5">
              {section.items.map((item) => {
                const active = isActive(item.path);
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    title={collapsed ? item.label : undefined}
                    className={`
                      w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl
                      text-[14px] font-semibold transition-colors duration-200
                      cursor-pointer
                      ${
                        active
                          ? "bg-primary text-white shadow-lg shadow-primary/25"
                          : "text-text-muted hover:text-text hover:bg-surface-hover"
                      }
                      ${collapsed ? "justify-center px-0" : ""}
                    `}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {!collapsed && (
                      <span className="truncate">{item.label}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── BOTTOM ACTIONS ───────────────── */}
      <div className="border-t border-border p-3.5 space-y-1.5 shrink-0">
        <button
          onClick={() => navigate("/settings")}
          title={collapsed ? "Settings" : undefined}
          className={`
            w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl
            text-[14px] font-semibold text-text-muted
            hover:text-text hover:bg-surface-hover
            transition-colors duration-200 cursor-pointer
            ${collapsed ? "justify-center px-0" : ""}
          `}
        >
          <Settings size={22} />
          {!collapsed && <span>Settings</span>}
        </button>

        <button
          onClick={handleLogout}
          title={collapsed ? "Logout" : undefined}
          className={`
            w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl
            text-[14px] font-semibold text-danger
            hover:bg-danger-muted
            transition-colors duration-200 cursor-pointer
            ${collapsed ? "justify-center px-0" : ""}
          `}
        >
          <LogOut size={22} />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>

      {/* ── COLLAPSE TOGGLE ──────────────── */}
      <button
        onClick={toggle}
        className="
          absolute -right-3.5 top-[82px]
          w-7 h-7 rounded-full
          bg-surface border border-border
          flex items-center justify-center
          text-text-muted hover:text-text hover:bg-surface-hover
          transition-colors duration-200
          shadow-lg cursor-pointer z-50
        "
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </button>
    </aside>
  );
}
