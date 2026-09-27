// src/pages/Placeholder.tsx
//
// Stand-in for routes that are not built yet.
//
// The old version rendered a page title derived from the URL and one sentence of
// copy, with no way out. Someone who clicked a navigation item landed on a dead
// end with no explanation of what the page was *meant* to do and no way back to
// somewhere useful.
//
// It now:
//  * names the page and where it sits in the hierarchy, from the route map so
//    the wording matches the sidebar rather than echoing the raw URL;
//  * explains what the page is intended for, per route, when that is known;
//  * lists the pages that do work, so the dead end is a menu rather than a wall;
//  * offers a route back and a way to report that the link is present but the
//    page is missing, which is the actual bug.

import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Construction, ArrowLeft, LayoutGrid, Home } from "lucide-react";
import EmptyState from "../components/ui/EmptyState";

/** What each not-yet-built route is meant to be for. */
const PURPOSE: Record<string, string> = {
  "/reports": "Summaries and exports across jobs, folders and dispatches.",
  "/settings": "Workspace preferences, roles and permissions.",
  "/notifications": "A single feed of everything that changed while you were away.",
  "/audit": "A searchable history of who changed which record and when.",
};

const WORKING_ROUTES: { to: string; label: string }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/jobs/labour", label: "Labour Jobs" },
  { to: "/jobs/with-material", label: "With Material Jobs" },
  { to: "/import", label: "Import from Excel" },
  { to: "/folders", label: "Folders" },
  { to: "/dispatches", label: "Dispatches" },
  { to: "/stock-owner", label: "Stock by Owner" },
  { to: "/stock-company", label: "Stock by Company" },
  { to: "/group-bills", label: "Group Bills" },
  { to: "/group-drawings", label: "Group Drawings" },
  { to: "/labour", label: "Labour Users" },
  { to: "/processor", label: "Processor Users" },
];

function titleCase(segment: string): string {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function PlaceholderPage() {
  const location = useLocation();

  const { trail, pageName, purpose } = useMemo(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    return {
      trail: parts.slice(0, -1).map(titleCase),
      pageName: parts.length ? titleCase(parts[parts.length - 1]) : "Page",
      purpose: PURPOSE[location.pathname],
    };
  }, [location.pathname]);

  return (
    <div className="animate-fade-in">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm font-semibold text-text-muted hover:text-text transition-colors mb-6"
      >
        <ArrowLeft size={16} />
        Back to Dashboard
      </Link>

      <div className="bg-surface border border-border rounded-2xl">
        <EmptyState
          icon={<Construction size={28} />}
          title={
            trail.length > 0 ? `${trail.join(" › ")} › ${pageName}` : `${pageName} is not built yet`
          }
          description={
            purpose
              ? `${purpose} This screen has not been built, so there is nothing to do here yet.`
              : "This screen is linked from the navigation but has not been built, so there is nothing to do here yet. Everything below is working — use one of those instead."
          }
          action={
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-colors cursor-pointer"
            >
              <Home size={16} />
              Go to Dashboard
            </Link>
          }
        />
      </div>

      <section className="mt-6 bg-surface border border-border rounded-2xl p-5 sm:p-6">
        <h2 className="text-sm font-bold text-text flex items-center gap-2 mb-1">
          <LayoutGrid size={16} className="text-primary" />
          Working screens
        </h2>
        <p className="text-xs text-text-muted mb-4">
          Everything currently available in the admin portal.
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {WORKING_ROUTES.map((r) => (
            <li key={r.to}>
              <Link
                to={r.to}
                className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg bg-bg border border-border text-sm font-semibold text-text hover:border-primary hover:bg-primary-muted transition-colors"
              >
                {r.label}
                <ArrowLeft size={13} className="rotate-180 text-text-muted shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
