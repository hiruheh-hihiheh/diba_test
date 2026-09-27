// src/pages/Dispatches.tsx
//
// Admin list of material dispatches, grouped by the worker who submitted them.
//
// What was wrong and what changed:
//  * The search box was a bare input with no clear button, no scope and no
//    result count. It is now the shared `SearchInput`, so it is identical to
//    every other search box in the app and announces "N of M".
//  * The status filter chips carried no counts, so you could not tell whether
//    "rejected" meant 1 or 200 before clicking. They do now, and the active
//    filter is exposed with `aria-pressed`.
//  * The list rendered every dispatch at once. With a few hundred dispatches
//    that meant thousands of DOM rows and a sluggish page. It is paged, and the
//    page survives a refresh or a filter change.
//  * There was no expand-all / collapse-all, so seeing every worker's dispatches
//    meant clicking each one.
//  * The empty state was an icon and one line of text with no way forward. It
//    now explains why the list is empty and offers the action that fixes it.
//  * A failed load left the error banner sitting above a list that looked
//    complete but was empty.
//  * Group header rows did not expose `aria-expanded`, so a screen-reader user
//    had no idea whether a row opened anything.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Truck,
  Loader2,
  RefreshCw,
  ChevronRight,
  ChevronUp,
  Inbox,
  ChevronsUpDown,
  SearchX,
  CircleCheck,
  Clock,
  Eye,
  Ban,
} from "lucide-react";
import {
  fetchAdminDispatches,
  getMaterialLabel,
  getStatusColor,
} from "../services/dispatch";
import type { Dispatch, DispatchStatus } from "../types/dispatch";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import IconButton from "../components/ui/IconButton";
import Pagination, { usePagination } from "../components/ui/Pagination";
import { usePageMeta } from "../contexts/PageMetaContext";
import { ErrorState, InlineRefreshBar } from "../components/ui/LoadingState";

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

interface UserGroup {
  username: string;
  dispatches: Dispatch[];
}

const STATUS_META: Record<DispatchStatus, { label: string; icon: typeof Clock; blurb: string }> = {
  submitted: {
    label: "Submitted",
    icon: Clock,
    blurb: "waiting for you to review",
  },
  reviewed: { label: "Reviewed", icon: Eye, blurb: "reviewed, awaiting a decision" },
  approved: { label: "Approved", icon: CircleCheck, blurb: "approved" },
  rejected: { label: "Rejected", icon: Ban, blurb: "rejected" },
};

const FILTER_ORDER: (DispatchStatus | "all")[] = [
  "all",
  "submitted",
  "reviewed",
  "approved",
  "rejected",
];

const PAGE_SIZE = 15;

/**
 * While the whole list is this small, the worker grouping is decoration rather
 * than navigation, so every group starts open and the dispatches themselves are
 * visible on arrival. Past this size the grouping earns its keep and the list
 * starts collapsed so the page is scannable.
 */
const ALWAYS_OPEN_LIMIT = 24;

export default function DispatchesPage() {
  /* The dashboard links here with ?status=submitted so a stat card can
     deep-link to a filtered list. */
  const [searchParams, setSearchParams] = useSearchParams();
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [filter, setFilter] = useState<DispatchStatus | "all">(() => {
    const s = searchParams.get("status");
    return s && FILTER_ORDER.includes(s as DispatchStatus) ? (s as DispatchStatus) : "all";
  });
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  const loadDispatches = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetchAdminDispatches();
      if (res.ok && res.data) {
        setDispatches(res.data);
        setError(null);
      } else {
        setError(res.error || "The dispatch list could not be loaded.");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The dispatch list could not be loaded. Check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDispatches();
  }, [loadDispatches]);

  /* Keep the URL in step with the visible filters, so a filtered view can be
     bookmarked, shared and reached from the dashboard stat cards. */
  useEffect(() => {
    const next = new URLSearchParams();
    if (filter !== "all") next.set("status", filter);
    if (search.trim()) next.set("q", search.trim());
    setSearchParams(next, { replace: true });
  }, [filter, search, setSearchParams]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadDispatches(true);
    setRefreshing(false);
  }

  /* ── Filtering ────────────────────────────────────── */

  const counts = useMemo(() => {
    const c: Record<DispatchStatus | "all", number> = {
      all: dispatches.length,
      submitted: 0,
      reviewed: 0,
      approved: 0,
      rejected: 0,
    };
    for (const d of dispatches) c[d.status] += 1;
    return c;
  }, [dispatches]);

  const filteredDispatches = useMemo(() => {
    let result = dispatches;
    if (filter !== "all") result = result.filter((d) => d.status === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (d) =>
          d.worker_username.toLowerCase().includes(q) ||
          d.vehicle_number.toLowerCase().includes(q) ||
          getMaterialLabel(d.material_type).toLowerCase().includes(q)
      );
    }
    return result;
  }, [dispatches, filter, search]);

  const allGrouped = useMemo(() => {
    const groups = new Map<string, Dispatch[]>();
    filteredDispatches.forEach((d) => {
      const list = groups.get(d.worker_username);
      if (list) list.push(d);
      else groups.set(d.worker_username, [d]);
    });
    const result: UserGroup[] = [];
    /* Alphabetical: the list is scanned by looking for a name, not by recency. */
    [...groups.keys()]
      .sort((a, b) => a.localeCompare(b))
      .forEach((username) => result.push({ username, dispatches: groups.get(username)! }));
    return result;
  }, [filteredDispatches]);

  const pagination = usePagination(allGrouped.length, PAGE_SIZE);
  const groupedDispatches = pagination.pageItems(allGrouped);

  /* Expansion rules.

     Collapsing by default was right for a big list, but it was applied to the
     *filtered* case too, which is backwards: tapping "Rejected (1)" is an
     explicit request to see the matching dispatch, and the old code hid it
     inside a collapsed worker group. The user got a chip saying 1 match, a
     group header, and no rows at all — which reads as "the filter is broken".

     So: filtering always opens the groups. On the unfiltered list, open them
     only while the whole set is small enough to read at once, because that is
     when the grouping is decoration rather than navigation. */
  const isFiltering = search.trim() !== "" || filter !== "all";
  const filterSignature = `${filter}|${search.trim().toLowerCase()}`;
  const [lastSignature, setLastSignature] = useState(filterSignature);
  const [seeded, setSeeded] = useState(false);
  const usernames = groupedDispatches.map((g) => g.username);

  if (filterSignature !== lastSignature) {
    setLastSignature(filterSignature);
    setExpandedUsers(
      isFiltering && usernames.length > 0 ? new Set(usernames) : new Set<string>()
    );
  }

  /* First paint once data lands. */
  useEffect(() => {
    if (seeded || allGrouped.length === 0) return;
    setSeeded(true);
    if (dispatches.length <= ALWAYS_OPEN_LIMIT) {
      setExpandedUsers(new Set(allGrouped.map((g) => g.username)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGrouped.length, dispatches.length, seeded]);

  const allVisibleExpanded =
    groupedDispatches.length > 0 &&
    groupedDispatches.every((g) => expandedUsers.has(g.username));

  function toggleUser(username: string) {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  function toggleAllVisible() {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (groupedDispatches.every((g) => next.has(g.username))) {
        groupedDispatches.forEach((g) => next.delete(g.username));
      } else {
        groupedDispatches.forEach((g) => next.add(g.username));
      }
      return next;
    });
  }

  usePageMeta(
    {
      title: "Dispatch Management",
      crumbs: [{ label: "Dispatches" }],
      subtitle:
        filter === "all"
          ? `${counts.all} dispatch${counts.all === 1 ? "" : "es"} from ${
              allGrouped.length
            } worker${allGrouped.length === 1 ? "" : "s"}`
          : `${counts[filter]} ${STATUS_META[filter as DispatchStatus].label.toLowerCase()} · ${
              allGrouped.length
            } worker${allGrouped.length === 1 ? "" : "s"}`,
      /* The body header prints this count next to the action buttons, so the
         TopBar must not print it a second time. */
      selfTitles: true,
    },
    [counts, filter, allGrouped.length]
  );

  /* ── Render ───────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32" role="status" aria-live="polite">
        <Loader2 size={32} className="text-primary animate-spin" />
        <span className="sr-only">Loading dispatches</span>
      </div>
    );
  }

  const searching = isFiltering;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header
          No <h1> here: the TopBar already carries "Dispatch Management", so
          repeating it made every screen look double-titled. What stays is the
          live count — which reacts to the search box and the status chips, so
          it is the one place worth reading — and the actions. */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-primary-muted flex items-center justify-center shrink-0">
            <Truck size={24} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">
              {searching ? "Matching dispatches" : "All dispatches"}
            </p>
            <p className="text-sm text-text-muted mt-0.5">
              {searching ? (
                <>
                  <strong className="text-text">{filteredDispatches.length}</strong> of{" "}
                  {dispatches.length} dispatches
                </>
              ) : (
                <>
                  {counts.all} dispatch{counts.all === 1 ? "" : "es"} · {allGrouped.length}{" "}
                  worker{allGrouped.length === 1 ? "" : "s"}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {allGrouped.length > 1 && (
            <button
              type="button"
              onClick={toggleAllVisible}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface border border-border text-sm font-semibold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
            >
              {allVisibleExpanded ? <ChevronUp size={16} /> : <ChevronsUpDown size={16} />}
              {allVisibleExpanded ? "Collapse all" : "Expand all"}
            </button>
          )}
          <IconButton
            label="Refresh dispatches"
            icon={<RefreshCw size={17} className={refreshing ? "animate-spin" : ""} />}
            onClick={handleRefresh}
            busy={refreshing}
            variant="surface"
            size="md"
          />
        </div>
      </div>

      {error ? (
        <ErrorState title="Could not load dispatches" message={error} onRetry={handleRefresh} />
      ) : (
        <>
          {/* Search & filters */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              scope="dispatches"
              resultCount={filteredDispatches.length}
              totalCount={dispatches.length}
              placeholder="Search worker, vehicle or material…"
              className="lg:max-w-md"
            />
            <div
              className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1.5 overflow-x-auto scrollbar-none"
              role="group"
              aria-label="Filter dispatches by status"
            >
              {FILTER_ORDER.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={`px-3.5 py-2 rounded-lg text-[13px] font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                    filter === f
                      ? "bg-primary text-white"
                      : "text-text-muted hover:text-text hover:bg-surface-hover"
                  }`}
                >
                  {f !== "all" && (
                    <StatusDot status={f as DispatchStatus} className="w-2 h-2 rounded-full shrink-0" />
                  )}
                  {f === "all" ? "All" : STATUS_META[f as DispatchStatus].label}
                  <span className={filter === f ? "opacity-80" : "opacity-60 tabular-nums"}>
                    ({counts[f]})
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <InlineRefreshBar show={refreshing} />

            {allGrouped.length === 0 ? (
              <EmptyState
                icon={searching ? <SearchX size={24} /> : <Inbox size={24} />}
                title={
                  searching
                    ? "No dispatches match"
                    : counts.all === 0
                      ? "No dispatches yet"
                      : `No ${STATUS_META[filter as DispatchStatus].label.toLowerCase()} dispatches`
                }
                description={
                  searching
                    ? `Nothing matches your search${
                        filter !== "all" ? ` and the ${STATUS_META[filter as DispatchStatus].label.toLowerCase()} filter` : ""
                      }. ${counts.all} dispatch${counts.all === 1 ? " is" : "s are"} in total.`
                    : counts.all === 0
                      ? "When a worker submits a dispatch it appears here for review. Nothing to do until then."
                      : `There ${
                          counts[filter as DispatchStatus] === 1 ? "is 1" : `are ${counts[filter as DispatchStatus]}`
                        } ${
                          counts[filter as DispatchStatus] === 1 ? "dispatch" : "dispatches"
                        } with this status.`
                }
                action={
                  searching ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setFilter("all");
                      }}
                      className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                    >
                      Clear search and filter
                    </button>
                  ) : null
                }
              />
            ) : (
              <>
                <div className="divide-y divide-border">
                  {groupedDispatches.map((group) => {
                    const single = group.dispatches.length === 1;

                    if (single) {
                      const d = group.dispatches[0];
                      return (
                        <Link
                          key={d.id}
                          to={`/dispatches/${d.id}`}
                          className="w-full flex items-center gap-4 px-5 sm:px-6 py-5 hover:bg-surface-hover/50 transition-colors text-left"
                        >
                          <div className="w-11 h-11 rounded-xl bg-primary-muted flex items-center justify-center text-primary font-bold text-sm shrink-0">
                            {group.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[15px] font-bold text-text truncate">
                                {group.username}
                              </span>
                              <StatusPill status={d.status} />
                            </div>
                            <p className="text-[13px] text-text-muted mt-1 truncate">
                              {d.vehicle_number} · {getMaterialLabel(d.material_type)} · 1 dispatch
                            </p>
                          </div>
                          <p className="text-[13px] text-text-muted shrink-0 font-medium hidden sm:block">
                            {formatDate(d.submitted_at)}
                          </p>
                          <ChevronRight size={16} className="text-text-muted shrink-0" />
                        </Link>
                      );
                    }

                    const isExpanded = expandedUsers.has(group.username);
                    const statusTally = group.dispatches.reduce<Record<string, number>>((acc, d) => {
                      acc[d.status] = (acc[d.status] ?? 0) + 1;
                      return acc;
                    }, {});

                    return (
                      <div key={group.username}>
                        <button
                          type="button"
                          onClick={() => toggleUser(group.username)}
                          aria-expanded={isExpanded}
                          className="w-full flex items-center gap-4 px-5 sm:px-6 py-5 hover:bg-surface-hover/50 transition-colors text-left cursor-pointer"
                        >
                          <div className="w-11 h-11 rounded-xl bg-primary-muted flex items-center justify-center text-primary font-bold text-sm shrink-0">
                            {group.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[15px] font-bold text-text">
                              {group.username}
                            </span>
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                              <span className="text-[13px] text-text-muted">
                                {group.dispatches.length} dispatches
                              </span>
                              {(Object.keys(statusTally) as DispatchStatus[]).map((s) => (
                                <span
                                  key={s}
                                  className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                                  style={{
                                    backgroundColor: getStatusColor(s) + "20",
                                    color: getStatusColor(s),
                                  }}
                                >
                                  {statusTally[s]} {STATUS_META[s].label.toLowerCase()}
                                </span>
                              ))}
                            </div>
                          </div>
                          <ChevronRight
                            size={16}
                            className={`text-text-muted shrink-0 transition-transform ${
                              isExpanded ? "rotate-90" : ""
                            }`}
                          />
                        </button>

                        {isExpanded && (
                          <div className="border-t border-border/50 bg-bg/40">
                            {group.dispatches.map((d) => (
                              /* Opening a dispatch is navigation, so it is a real
                                 link: middle-click and ⌘-click open a new tab, the
                                 address can be copied, and browser history behaves. */
                              <Link
                                key={d.id}
                                to={`/dispatches/${d.id}`}
                                className="w-full flex items-center gap-4 pl-16 pr-5 sm:pr-6 py-4 hover:bg-surface-hover/30 transition-colors text-left border-b border-border/30 last:border-b-0"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2.5 flex-wrap">
                                    <span className="text-[14px] text-text font-medium">
                                      {d.vehicle_number}
                                    </span>
                                    <StatusPill status={d.status} />
                                  </div>
                                  <p className="text-[13px] text-text-muted mt-1 truncate">
                                    {getMaterialLabel(d.material_type)} ·{" "}
                                    {formatDate(d.submitted_at)}
                                    {d.location_name ? ` · ${d.location_name}` : ""}
                                  </p>
                                </div>
                                <ChevronRight size={16} className="text-text-muted shrink-0" />
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <Pagination {...pagination} itemLabel="workers" />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Small pieces ───────────────────────────────────── */

function StatusDot({ status, className = "" }: { status: DispatchStatus; className?: string }) {
  return <span className={className} style={{ backgroundColor: getStatusColor(status) }} aria-hidden="true" />;
}

function StatusPill({ status }: { status: DispatchStatus }) {
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
      style={{ backgroundColor: getStatusColor(status) + "20", color: getStatusColor(status) }}
    >
      {status}
    </span>
  );
}
