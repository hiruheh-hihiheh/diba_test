// src/components/layout/Sidebar.tsx

import { useEffect, type ReactNode } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Truck,
  Users,
  UserCog,
  Package,
  Building2,
  FileText,
  Receipt,
  PenTool,
  FolderOpen,
  ClipboardList,
  Layers,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Hexagon,
  UploadCloud,
  X,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useSidebar } from "../../hooks/useSidebar";
import { useConfirm } from "../ui/ConfirmDialog";

interface NavItem {
  label: string;
  icon: ReactNode;
  path: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Labels are deliberately disambiguated. The previous list showed "Labour"
 * twice — once under PEOPLE (user accounts) and once under JOBS (job records) —
 * with nothing on screen to tell them apart.
 *
 * The two job entries also shared a single `Briefcase` icon, so in the collapsed
 * rail they were literally the same picture twice in a row. They use the same
 * icons as the Dashboard quick actions, so the icon means the same thing
 * everywhere in the app.
 */
const navSections: NavSection[] = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", icon: <LayoutDashboard size={20} />, path: "/" },
      { label: "Dispatches", icon: <Truck size={20} />, path: "/dispatches" },
    ],
  },
  {
    title: "PEOPLE",
    items: [
      { label: "Labour Users", icon: <Users size={20} />, path: "/labour" },
      { label: "Processor Users", icon: <UserCog size={20} />, path: "/processor" },
    ],
  },
  {
    title: "JOBS",
    items: [
      { label: "Labour Jobs", icon: <ClipboardList size={20} />, path: "/jobs/labour" },
      {
        label: "With Material Jobs",
        icon: <Layers size={20} />,
        path: "/jobs/with-material",
      },
      { label: "Import from Excel", icon: <UploadCloud size={20} />, path: "/jobs/import" },
    ],
  },
  {
    title: "INVENTORY",
    items: [
      { label: "Stock by Owner", icon: <Package size={20} />, path: "/stock-owner" },
      { label: "Stock by Company", icon: <Building2 size={20} />, path: "/stock-company" },
    ],
  },
  {
    title: "DOCUMENTS",
    items: [
      { label: "Bills", icon: <Receipt size={20} />, path: "/bills" },
      { label: "Group Bills", icon: <FileText size={20} />, path: "/group-bills" },
      { label: "Group Drawings", icon: <PenTool size={20} />, path: "/group-drawings" },
    ],
  },
  {
    title: "ORGANIZE",
    items: [
      { label: "Folders", icon: <FolderOpen size={20} />, path: "/folders" },
    ],
  },
];

export default function Sidebar() {
  const { collapsed, toggle, isMobile, mobileOpen, closeMobile } = useSidebar();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const confirm = useConfirm();

  /* Escape closes the mobile drawer. */
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobile();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen, closeMobile]);

  async function handleLogout() {
    const ok = await confirm({
      title: "Sign out?",
      message: "You will be returned to the login screen. Any unsaved edits on this screen are lost.",
      confirmLabel: "Sign out",
      tone: "primary",
    });
    if (!ok) return;
    await signOut();
    navigate("/login", { replace: true });
  }

  const railCollapsed = !isMobile && collapsed;

  /* Shared between the nav links and the bottom action links so the active,
     hover and focus states are identical everywhere in the rail. */
  const linkBase = `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl
    text-[14px] font-semibold transition-colors duration-200 cursor-pointer
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
    focus-visible:ring-offset-2 focus-visible:ring-offset-surface`;

  const body = (
    <>
      {/* ── LOGO ─────────────────────────── */}
      <div className="flex items-center gap-3 px-5 h-[72px] border-b border-border shrink-0">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0 shadow-lg shadow-primary/25">
          <Hexagon size={22} className="text-white" />
        </div>
        {!railCollapsed && (
          <div className="min-w-0">
            <h1 className="text-[15px] font-extrabold text-text tracking-wide whitespace-nowrap">
              METALWORKER
            </h1>
            <p className="text-[11px] font-semibold text-text-muted tracking-[0.15em]">
              ADMIN PANEL
            </p>
          </div>
        )}
        {isMobile && (
          <button
            type="button"
            onClick={closeMobile}
            aria-label="Close navigation"
            className="ml-auto w-9 h-9 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover cursor-pointer"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* ── NAVIGATION ───────────────────── */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-5 px-3 space-y-6" aria-label="Main">
        {navSections.map((section) => (
          <div key={section.title}>
            {!railCollapsed && (
              <p className="text-[11px] font-bold text-text-muted/70 tracking-[0.15em] px-3 mb-2">
                {section.title}
              </p>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item.path}>
                  {/* Real links, not buttons: middle-click and ⌘-click open a
                      page in a new tab, "Copy link address" works, and assistive
                      tech announces them as navigation rather than as an
                      unlabelled action. */}
                  <NavLink
                    to={item.path}
                    end={item.path === "/"}
                    onClick={() => {
                      if (isMobile) closeMobile();
                    }}
                    title={railCollapsed ? item.label : undefined}
                    className={({ isActive: active }) => `
                        ${linkBase}
                        ${
                          active
                            ? "bg-primary text-white shadow-lg shadow-primary/25"
                            : "text-text-muted hover:text-text hover:bg-surface-hover"
                        }
                        ${railCollapsed ? "justify-center px-0" : ""}
                      `}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {!railCollapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── BOTTOM ACTIONS ───────────────── */}
      <div className="border-t border-border p-3 space-y-1 shrink-0">
        <NavLink
          to="/settings"
          onClick={() => {
            if (isMobile) closeMobile();
          }}
          title={railCollapsed ? "Settings" : undefined}
          className={({ isActive: active }) => `
            ${linkBase}
            ${active ? "bg-surface-hover text-text" : "text-text-muted hover:text-text hover:bg-surface-hover"}
            ${railCollapsed ? "justify-center px-0" : ""}
          `}
        >
          <Settings size={20} />
          {!railCollapsed && <span>Settings</span>}
        </NavLink>

        <button
          type="button"
          onClick={handleLogout}
          title={railCollapsed ? "Sign out" : undefined}
          aria-label="Sign out"
          className={`
            ${linkBase}
            text-danger hover:bg-danger-muted
            ${railCollapsed ? "justify-center px-0" : ""}
          `}
        >
          <LogOut size={20} />
          {!railCollapsed && <span>Sign out</span>}
        </button>
      </div>

      {/* ── COLLAPSE TOGGLE (desktop only) ── */}
      {!isMobile && (
        <button
          type="button"
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
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      )}
    </>
  );

  /* ── Mobile: off-canvas drawer ─────────── */
  if (isMobile) {
    return (
      <>
        {/* Scrim */}
        <div
          onClick={closeMobile}
          aria-hidden="true"
          className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-200 ${
            mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        />
        <aside
          aria-label="Navigation"
          aria-hidden={!mobileOpen}
          className={`fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] flex flex-col
            bg-surface border-r border-border shadow-2xl
            transition-transform duration-300 ease-out
            ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          {body}
        </aside>
      </>
    );
  }

  /* ── Desktop: persistent rail ──────────── */
  return (
    <aside
      aria-label="Navigation"
      className={`fixed left-0 top-0 bottom-0 z-40 flex flex-col bg-surface border-r border-border
        transition-[width] duration-300 ease-in-out ${collapsed ? "w-20" : "w-[280px]"}`}
    >
      {body}
    </aside>
  );
}
