// src/components/layout/TopBar.tsx

import { useLocation, Link } from "react-router-dom";
import { Sun, Moon, Menu, ChevronRight, User } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../contexts/ThemeContext";
import { useCurrentPageMeta } from "../../contexts/PageMetaContext";
import { useSidebar } from "../../hooks/useSidebar";

/**
 * Route-derived fallbacks. The previous map had no entry for any `/jobs/*`
 * route, so Labour Jobs, With Material Jobs and Import from Excel all rendered
 * the title "Admin Panel".
 */
const routeMeta: Record<string, { title: string; crumbs: { label: string; to?: string }[] }> = {
  /* The dashboard is the root of the tree, so it has no trail to show. */
  "/": { title: "Dashboard", crumbs: [] },
  "/dispatches": { title: "Dispatches", crumbs: [{ label: "Dispatches" }] },
  "/labour": { title: "Labour Users", crumbs: [{ label: "People" }, { label: "Labour Users" }] },
  "/processor": {
    title: "Processor Users",
    crumbs: [{ label: "People" }, { label: "Processor Users" }],
  },
  "/jobs/labour": {
    title: "Labour Jobs",
    crumbs: [{ label: "Jobs" }, { label: "Labour Jobs" }],
  },
  "/jobs/with-material": {
    title: "With Material Jobs",
    crumbs: [{ label: "Jobs" }, { label: "With Material Jobs" }],
  },
  "/jobs/import": {
    title: "Import from Excel",
    crumbs: [{ label: "Jobs" }, { label: "Import from Excel" }],
  },
  "/stock-owner": {
    title: "Stock by Owner",
    crumbs: [{ label: "Inventory" }, { label: "Stock by Owner" }],
  },
  "/stock-company": {
    title: "Stock by Company",
    crumbs: [{ label: "Inventory" }, { label: "Stock by Company" }],
  },
  "/bills": {
    title: "Bills",
    crumbs: [{ label: "Documents" }, { label: "Bills" }],
  },
  "/company-bills": {
    title: "Company Bills",
    crumbs: [{ label: "Documents" }, { label: "Company Bills" }],
  },
  "/bills/create": {
    title: "Create Bill",
    crumbs: [{ label: "Documents" }, { label: "Bills", to: "/bills" }, { label: "Create" }],
  },
  "/bills/logos": {
    title: "Logo Library",
    crumbs: [{ label: "Documents" }, { label: "Bills", to: "/bills" }, { label: "Logo Library" }],
  },
  "/bills/profile": {
    title: "Invoice Profile",
    crumbs: [{ label: "Documents" }, { label: "Bills", to: "/bills" }, { label: "Invoice Profile" }],
  },
  "/group-bills": {
    title: "Group Bills",
    crumbs: [{ label: "Documents" }, { label: "Group Bills" }],
  },
  "/group-drawings": {
    title: "Group Drawings",
    crumbs: [{ label: "Documents" }, { label: "Group Drawings" }],
  },
  "/folders": { title: "Folders", crumbs: [{ label: "Organize" }, { label: "Folders" }] },
  "/settings": { title: "Settings", crumbs: [{ label: "Settings" }] },
};

function resolveRoute(pathname: string) {
  if (routeMeta[pathname]) return routeMeta[pathname];
  if (pathname.startsWith("/folders/"))
    return {
      title: "Folder",
      crumbs: [{ label: "Organize" }, { label: "Folders", to: "/folders" }, { label: "Folder" }],
    };
  if (pathname.startsWith("/dispatches/"))
    return {
      title: "Dispatch Details",
      crumbs: [{ label: "Dispatches", to: "/dispatches" }, { label: "Details" }],
    };
  return { title: "Admin Panel", crumbs: [{ label: "Admin Panel" }] };
}

export default function TopBar() {
  const location = useLocation();
  const { adminUsername } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isMobile, openMobile } = useSidebar();
  const pageMeta = useCurrentPageMeta();

  const fallback = resolveRoute(location.pathname);
  const title = pageMeta.title ?? fallback.title;
  const crumbs = pageMeta.crumbs ?? fallback.crumbs;
  const isDark = theme === "dark";

  return (
    <header className="h-16 bg-bg/85 backdrop-blur-xl border-b border-border flex items-center gap-3 pl-4 pr-4 sm:pl-6 sm:pr-6 sticky top-0 z-30">
      {isMobile && (
        <button
          type="button"
          onClick={openMobile}
          aria-label="Open navigation"
          title="Open navigation"
          className="w-9 h-9 shrink-0 -ml-1 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
        >
          <Menu size={19} />
        </button>
      )}

      <div className="min-w-0 flex-1">
        {/* Real, clickable breadcrumbs. They were previously decorative text, so
            there was no way back to a parent section from the top bar.

            They render *above* the title and are independent of the subtitle: an
            earlier version drew them only when no subtitle was published, which
            meant they silently disappeared on every page once each page started
            reporting its own record count.

            The trail is drawn whenever the page publishes at least one crumb,
            because "Admin" is already prepended here. A page with no parent —
            the Dashboard — publishes no crumbs at all, so nothing is drawn. */}
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="hidden sm:block mb-1">
            <ol className="flex items-center gap-1.5 text-[11px] leading-none text-text-muted">
              <li className="flex items-center gap-1.5">
                <Link
                  to="/"
                  className="hover:text-text transition-colors"
                  onClick={(e) => {
                    if (location.pathname === "/") e.preventDefault();
                  }}
                >
                  Admin
                </Link>
              </li>
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <li key={`${c.label}-${i}`} className="flex items-center gap-1.5 min-w-0">
                    <ChevronRight size={10} className="shrink-0 opacity-40" />
                    {c.to && !last ? (
                      <Link to={c.to} className="hover:text-text transition-colors truncate">
                        {c.label}
                      </Link>
                    ) : (
                      <span
                        aria-current={last ? "page" : undefined}
                        className={`truncate ${last ? "text-text-secondary font-medium" : ""}`}
                      >
                        {c.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        <div className="flex items-baseline gap-2.5 min-w-0">
          <h1 className="text-[17px] sm:text-[18px] font-semibold text-text truncate leading-tight tracking-[-0.015em]">
            {title}
          </h1>
          {/* The count/filter line is only shown here when the page does not
              already print it in its own header — printing "12 of 1 240 jobs" in
              both places is noise, not information. */}
          {pageMeta.subtitle && !pageMeta.selfTitles && (
            <>
              <span aria-hidden="true" className="text-border-hover text-[13px] leading-none">
                /
              </span>
              <p className="hidden md:block text-[12px] text-text-muted truncate leading-none">
                {pageMeta.subtitle}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          title={isDark ? "Switch to light theme" : "Switch to dark theme"}
          className="w-9 h-9 rounded-lg flex items-center justify-center border border-transparent text-text-muted hover:text-text hover:bg-surface-hover hover:border-border transition-colors cursor-pointer"
        >
          {isDark ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <div
          className="flex items-center gap-2 sm:gap-2.5 pl-2 sm:pl-3 sm:border-l border-border min-w-0"
          title={adminUsername ? `Signed in as ${adminUsername}` : undefined}
        >
          <div className="relative w-8 h-8 rounded-full bg-primary-muted border border-primary/25 flex items-center justify-center shrink-0">
            <User size={14} className="text-primary" />
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success border-2 border-bg"
            />
          </div>
          <div className="hidden sm:block min-w-0 leading-tight">
            <p className="text-[12.5px] font-semibold text-text truncate max-w-[11rem]">
              {adminUsername || "Admin"}
            </p>
            <p className="text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted leading-tight mt-0.5">
              Administrator
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
