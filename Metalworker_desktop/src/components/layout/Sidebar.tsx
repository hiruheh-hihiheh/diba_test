// src/components/layout/Sidebar.tsx

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Truck,
  Users,
  UserCog,
  Package,
  Building2,
  FileText,
  FolderArchive,
  FilePlus2,
  Receipt,
  ImagePlus,
  PenTool,
  FolderOpen,
  ClipboardList,
  Layers,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Hexagon,
  UploadCloud,
  X,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useSidebar } from "../../hooks/useSidebar";
import { useConfirm } from "../../hooks/useConfirm";

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
    title: "Workspace",
    items: [
      { label: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
      { label: "Dispatches", icon: <Truck size={18} />, path: "/dispatches" },
    ],
  },
  {
    title: "People",
    items: [
      { label: "Labour Users", icon: <Users size={18} />, path: "/labour" },
      { label: "Processor Users", icon: <UserCog size={18} />, path: "/processor" },
    ],
  },
  {
    title: "Jobs",
    items: [
      { label: "Labour Jobs", icon: <ClipboardList size={18} />, path: "/jobs/labour" },
      {
        label: "With Material Jobs",
        icon: <Layers size={18} />,
        path: "/jobs/with-material",
      },
      { label: "Import from Excel", icon: <UploadCloud size={18} />, path: "/jobs/import" },
    ],
  },
  {
    title: "Inventory",
    items: [
      { label: "Stock by Owner", icon: <Package size={18} />, path: "/stock-owner" },
      { label: "Stock by Company", icon: <Building2 size={18} />, path: "/stock-company" },
    ],
  },
  {
    title: "Documents",
    items: [
      { label: "Bills", icon: <Receipt size={18} />, path: "/bills" },
      { label: "Company Bills", icon: <FolderArchive size={18} />, path: "/company-bills" },
      // How a bill gets made, next to the list of bills that exist. Both entry modes —
      // blank, and blank with the Invoice Business Profile preloaded — and the copy flow
      // are one screen reached three ways, so there is one entry rather than three.
      { label: "Create Bill", icon: <FilePlus2 size={18} />, path: "/bills/create" },
      // The reusable letterheads invoices print. Nested under Bills because a logo
      // is only ever used through an invoice — on its own it is an asset, and the
      // "used on N bills" count on that screen only makes sense next to the bills.
      { label: "Logo Library", icon: <ImagePlus size={18} />, path: "/bills/logos" },
      // The company-level defaults: name, address, bank block, terms, footer
      // wording. Nested beside the Logo Library and kept separate from it - one is an
      // image asset, the other is text - but they answer the same question, so they
      // sit together.
      { label: "Invoice Profile", icon: <Building2 size={18} />, path: "/bills/profile" },
      { label: "Group Bills", icon: <FileText size={18} />, path: "/group-bills" },
      { label: "Group Drawings", icon: <PenTool size={18} />, path: "/group-drawings" },
      { label: "Drawing Upload", icon: <FileText size={18} />, path: "/drawing-upload" },
    ],
  },
  {
    title: "Organize",
    items: [{ label: "Folders", icon: <FolderOpen size={18} />, path: "/folders" }],
  },
];

/** Where the floating label sits, in viewport coordinates. */
interface RailTipState {
  label: string;
  top: number;
  left: number;
}

export default function Sidebar() {
  const { collapsed, toggle, isMobile, mobileOpen, closeMobile } = useSidebar();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const confirm = useConfirm();

  /* Only one tooltip exists for the whole rail, shown while the pointer or
     keyboard focus is on an item and the labels are hidden. A per-item tooltip
     would be clipped by the nav's own scroll container. */
  const [railTip, setRailTip] = useState<RailTipState | null>(null);

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
      message:
        "You will be returned to the login screen. Any unsaved edits on this screen are lost.",
      confirmLabel: "Sign out",
      tone: "primary",
    });
    if (!ok) return;
    await signOut();
    navigate("/login", { replace: true });
  }

  const railCollapsed = !isMobile && collapsed;

  const showTip = (label: string, el: HTMLElement) => {
    if (!railCollapsed) return;
    const rect = el.getBoundingClientRect();
    /* Anchor to the RAIL's right edge, not the link's: the links are inset by
       8px, so anchoring to the link makes the label overlap the rail. */
    const railRight = el.closest("aside")?.getBoundingClientRect().right ?? rect.right;
    setRailTip({ label, top: rect.top + rect.height / 2, left: railRight + 10 });
  };
  const hideTip = () => setRailTip(null);

  /* Shared between the nav links and the bottom action links so the active,
     hover and focus states are identical everywhere in the rail. */
  const linkBase = `relative w-full flex items-center gap-2.5 h-9 rounded-[9px] px-2.5
    text-[13px] font-medium transition-colors duration-150 cursor-pointer select-none
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
    focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar`;

  const body = (
    <>
      {/* ── BRAND ─────────────────────────── */}
      <div
        className={`flex items-center gap-2.5 h-16 shrink-0 border-b border-border/80 ${
          railCollapsed ? "justify-center px-2" : "px-3.5"
        }`}
      >
        <div className="relative shrink-0">
          <div className="w-8 h-8 rounded-[9px] bg-primary flex items-center justify-center shadow-[0_6px_16px_-8px_rgba(201,128,82,0.7)]">
            <Hexagon size={17} className="text-[var(--theme-primary-text)]" strokeWidth={2.4} />
          </div>
        </div>

        {!railCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold text-text tracking-[0.14em] leading-none">
              METALWORKER
            </p>
            <p className="text-[10px] font-semibold text-text-muted/70 tracking-[0.16em] mt-1.5 leading-none">
              ADMIN CONSOLE
            </p>
          </div>
        )}

        {isMobile ? (
          <button
            type="button"
            onClick={closeMobile}
            aria-label="Close navigation"
            className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        ) : (
          !railCollapsed && (
            <button
              type="button"
              onClick={toggle}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted/70 hover:text-text hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
            >
              <PanelLeftClose size={16} />
            </button>
          )
        )}
      </div>

      {/* ── NAVIGATION ───────────────────── */}
      <nav
        className={`flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin py-3 ${
          railCollapsed ? "px-2" : "px-2.5"
        }`}
        aria-label="Main"
      >
        {navSections.map((section, index) => (
          <div key={section.title} className={index === 0 ? "" : "mt-5"}>
            {/* In the collapsed rail a section rule keeps the groups readable
                without a label. */}
            {railCollapsed ? (
              index > 0 && <div className="h-px mx-2 mb-2 bg-border/70" aria-hidden="true" />
            ) : (
              <div className="flex items-center gap-2 px-2.5 mb-1.5" aria-hidden="true">
                <span className="text-[10px] font-bold text-text-muted/60 tracking-[0.14em] uppercase whitespace-nowrap">
                  {section.title}
                </span>
                <span className="h-px flex-1 bg-border/60" />
              </div>
            )}

            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.path}>
                  {/* Real links, not buttons: middle-click and ⌘-click open a
                      page in a new tab, "Copy link address" works, and assistive
                      tech announces them as navigation rather than as an
                      unlabelled action. */}
                  <NavLink
                    to={item.path}
                    /* `/bills` is a prefix of the three other Documents
                       entries, and NavLink matches on prefix by default — so
                       Bills lit up on Create Bill, Logo Library and Invoice
                       Profile at the same time as their own item. `end` keeps
                       each of those screens showing exactly one active row. */
                    end={item.path === "/" || item.path === "/bills"}
                    onClick={() => {
                      if (isMobile) closeMobile();
                    }}
                    onMouseEnter={(e) => showTip(item.label, e.currentTarget)}
                    onMouseLeave={hideTip}
                    onFocus={(e) => showTip(item.label, e.currentTarget)}
                    onBlur={hideTip}
                    aria-label={railCollapsed ? item.label : undefined}
                    className={({ isActive: active }) => `
                        ${linkBase}
                        ${
                          active
                            ? "bg-primary-muted text-primary font-semibold"
                            : "text-text-secondary/80 hover:text-text hover:bg-surface-hover"
                        }
                        ${railCollapsed ? "justify-center px-0" : ""}
                      `}
                  >
                    {({ isActive: active }) => (
                      <>
                        {/* A 2px rail on the active row, instead of a solid
                            accent block: it keeps the whole sidebar quiet while
                            still being unmistakable. */}
                        {active && !railCollapsed && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2.5px] rounded-full bg-primary"
                          />
                        )}
                        <span className="shrink-0 flex items-center justify-center w-[18px]">
                          {item.icon}
                        </span>
                        {!railCollapsed && <span className="truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── BOTTOM ACTIONS ───────────────── */}
      <div className={`border-t border-border/80 shrink-0 ${railCollapsed ? "p-2" : "p-2.5"}`}>
        <NavLink
          to="/settings"
          onClick={() => {
            if (isMobile) closeMobile();
          }}
          onMouseEnter={(e) => showTip("Settings", e.currentTarget)}
          onMouseLeave={hideTip}
          onFocus={(e) => showTip("Settings", e.currentTarget)}
          onBlur={hideTip}
          aria-label={railCollapsed ? "Settings" : undefined}
          className={({ isActive: active }) => `
            ${linkBase}
            ${active ? "bg-surface-hover text-text" : "text-text-secondary/80 hover:text-text hover:bg-surface-hover"}
            ${railCollapsed ? "justify-center px-0" : ""}
          `}
        >
          <span className="shrink-0 flex items-center justify-center w-[18px]">
            <Settings size={18} />
          </span>
          {!railCollapsed && <span>Settings</span>}
        </NavLink>

        <button
          type="button"
          onClick={handleLogout}
          onMouseEnter={(e) => showTip("Sign out", e.currentTarget)}
          onMouseLeave={hideTip}
          onFocus={(e) => showTip("Sign out", e.currentTarget)}
          onBlur={hideTip}
          aria-label="Sign out"
          className={`
            ${linkBase}
            text-text-muted hover:text-danger hover:bg-danger-muted
            ${railCollapsed ? "justify-center px-0" : ""}
          `}
        >
          <span className="shrink-0 flex items-center justify-center w-[18px]">
            <LogOut size={18} />
          </span>
          {!railCollapsed && <span>Sign out</span>}
        </button>
      </div>

      {/* ── EXPAND CONTROL (collapsed rail) ── */}
      {railCollapsed && (
        <button
          type="button"
          onClick={toggle}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="absolute -right-3 top-[52px] w-6 h-6 rounded-full bg-surface border border-border flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors shadow-md cursor-pointer z-50"
        >
          <PanelLeftOpen size={13} />
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
          className={`fixed inset-0 bg-black/60 backdrop-blur-[2px] z-40 transition-opacity duration-200 ${
            mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        />
        <aside
          aria-label="Navigation"
          aria-hidden={!mobileOpen}
          className={`fixed inset-y-0 left-0 z-50 w-[272px] max-w-[85vw] flex flex-col
            bg-sidebar border-r border-border shadow-2xl
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
    <>
      <aside
        aria-label="Navigation"
        className={`fixed left-0 top-0 bottom-0 z-40 flex flex-col bg-sidebar border-r border-border
          transition-[width] duration-300 ease-out ${collapsed ? "w-20" : "w-[280px]"}`}
      >
        {body}
      </aside>

      {/* Floating label for the collapsed rail. Portalled so the nav's own
          scroll container cannot clip it, and `display`-toggled so it never
          occupies layout. */}
      {railTip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: railTip.top, left: railTip.left }}
            className="fixed z-[160] -translate-y-1/2 pointer-events-none rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] font-semibold text-text shadow-xl animate-appear whitespace-nowrap"
          >
            {railTip.label}
          </div>,
          document.body
        )}
    </>
  );
}
