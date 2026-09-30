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
  "/group-bills": {
    title: "Group Bills",
    crumbs: [{ label: "Documents" }, { label: "Group Bills" }],
  },
  "/group-drawings": {
    title: "Group Drawings",
    crumbs: [{ label: "Documents" }, { label: "Group Drawings" }],
  },
  "/folders": { title: "Folders", crumbs: [{ label: "Folders" }] },
  "/settings": { title: "Settings", crumbs: [{ label: "Settings" }] },
};

function resolveRoute(pathname: string) {
  if (routeMeta[pathname]) return routeMeta[pathname];
  if (pathname.startsWith("/folders/"))
    return {
      title: "Folder",
      crumbs: [{ label: "Folders", to: "/folders" }, { label: "Folder" }],
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

  return (
    <header
      className="h-[72px] bg-surface/85 backdrop-blur-xl border-b border-border flex items-center gap-3 px-4 sm:px-8 sticky top-0 z-30"
    >
      {isMobile && (
        <button
          type="button"
          onClick={openMobile}
          aria-label="Open navigation"
          title="Open navigation"
          className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
        >
          <Menu size={21} />
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
            because "Admin" is already prepended here. The old `length > 1` gate
            hid the trail entirely on the top-level pages (Dashboard,
            Dispatches, Folders), which is exactly where a user most needs a home
            link. A page with no parent — the Dashboard — publishes no crumbs at
            all, so nothing is drawn. */}
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="hidden sm:block mb-0.5">
            <ol className="flex items-center gap-1 text-[11px] text-text-muted">
              <li className="flex items-center gap-1">
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
                  <li key={`${c.label}-${i}`} className="flex items-center gap-1 min-w-0">
                    <ChevronRight size={11} className="shrink-0 opacity-60" />
                    {c.to && !last ? (
                      <Link to={c.to} className="hover:text-text transition-colors truncate">
                        {c.label}
                      </Link>
                    ) : (
                      <span
                        aria-current={last ? "page" : undefined}
                        className={`truncate ${last ? "text-text font-semibold" : ""}`}
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

        <h1 className="text-lg sm:text-xl font-extrabold text-text truncate leading-tight">
          {title}
        </h1>

        {/* The count/filter line is only shown here when the page does not
            already print it in its own header — printing "12 of 1 240 jobs" in
            both places is noise, not information. */}
        {pageMeta.subtitle && !pageMeta.selfTitles && (
          <p className="text-xs text-text-muted truncate">{pageMeta.subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
        >
          {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        <div
          className="flex items-center gap-2.5 pl-2 sm:pl-3 sm:border-l border-border max-w-[9rem] sm:max-w-none"
          title={adminUsername ? `Signed in as ${adminUsername}` : undefined}
        >
          <div className="w-9 h-9 rounded-full bg-primary-muted flex items-center justify-center shrink-0">
            <User size={17} className="text-primary" />
          </div>
          <div className="hidden sm:block min-w-0">
            <p className="text-[13px] font-bold text-text truncate leading-tight">
              {adminUsername || "Admin"}
            </p>
            <p className="text-[11px] text-text-muted leading-tight">Administrator</p>
          </div>
        </div>
      </div>
    </header>
  );
}
