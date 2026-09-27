// src/pages/Dashboard.tsx
//
// Admin landing screen.
//
// What was wrong and what changed:
//  * If `fetchAdminDispatches` returned an error (as opposed to throwing), the
//    dashboard silently kept an empty list and the panels said "No Dispatches
//    Yet" — i.e. a server error was presented as a fact about the business.
//    The failure is now reported.
//  * The stat cards were inert. Every one of them now links to the list it
//    summarises, with the status filter applied, so "Needs Review: 12" is one
//    click from the twelve dispatches that need review.
//  * The stat cards had no sub-label, so "4" next to "Inactive Users" gave no
//    hint at what was counted. Each says what it counts and what it is out of.
//  * "Needs Attention" showed the newest 5 of N with nothing saying so. It now
//    says "showing 5 of 12" and links to the rest.
//  * Quick Actions omitted the three most-used screens in the app — Labour
//    Jobs, With Material Jobs and Excel Import — and offered "Add User", which
//    navigates to the labour *list*, not an add form. The grid now leads with
//    jobs and import.
//  * The refresh button had no tooltip and reported nothing on success; a
//    background refresh is used so a refresh never blanks the dashboard.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  UserCog,
  UserCheck,
  UserX,
  Truck,
  Clock,
  CheckCircle2,
  XCircle,
  Plus,
  Package,
  FileText,
  PenTool,
  FolderOpen,
  RefreshCw,
  Loader2,
  ChevronRight,
  ArrowUpRight,
  FileSpreadsheet,
  ClipboardList,
  Layers,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { fetchWorkers } from "../services/admin";
import {
  fetchAdminDispatches,
  getMaterialLabel,
  getStatusColor,
} from "../services/dispatch";
import type { Profile } from "../types/profile";
import type { Dispatch } from "../types/dispatch";
import { usePageMeta } from "../contexts/PageMetaContext";
import { InlineRefreshBar } from "../components/ui/LoadingState";

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDispatchDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ═══════════════════════════════════════════
   STAT CARD
   ═══════════════════════════════════════════ */

function StatCard({
  title,
  value,
  caption,
  icon,
  color,
  bgColor,
  to,
  emptyHint,
}: {
  title: string;
  value: number;
  caption: string;
  icon: ReactNode;
  color: string;
  bgColor: string;
  to: string;
  /** Shown instead of the caption when there is nothing to see. */
  emptyHint?: string;
}) {
  const isEmpty = value === 0;
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="group bg-surface border border-border rounded-2xl p-5 text-left transition-all duration-200 hover:border-border-hover hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-3xl font-extrabold text-text leading-none tabular-nums">{value}</p>
          <p className="text-sm text-text mt-2 font-bold leading-tight">{title}</p>
          <p className="text-xs text-text-muted mt-1 leading-snug">
            {emptyHint && isEmpty ? emptyHint : caption}
          </p>
        </div>
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110"
          style={{ backgroundColor: bgColor }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
      </div>
      {/* Every card goes somewhere, so the link is stated rather than revealed
          on hover. */}
      <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-primary opacity-70 group-hover:opacity-100 transition-opacity">
        View list
        <ArrowUpRight size={12} />
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════ */

const ATTENTION_LIMIT = 5;
const RECENT_LIMIT = 5;

export default function DashboardPage() {
  const navigate = useNavigate();
  const { adminUsername } = useAuth();

  const [workers, setWorkers] = useState<Profile[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<{ workers?: string; dispatches?: string }>({});

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [workerList, dispatchRes] = await Promise.all([
        fetchWorkers(),
        fetchAdminDispatches(),
      ]);
      setWorkers(workerList);
      setErrors((p) => ({ ...p, workers: undefined }));

      if (dispatchRes.ok && dispatchRes.data) {
        setDispatches(dispatchRes.data);
        setErrors((p) => ({ ...p, dispatches: undefined }));
      } else {
        /* A failed fetch is not the same as "there are no dispatches"; saying so
           is what made this page misleading. */
        setDispatches([]);
        setErrors((p) => ({
          ...p,
          dispatches: dispatchRes.error || "The dispatch figures could not be loaded.",
        }));
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "The dashboard data could not be loaded.";
      setErrors({ workers: message, dispatches: message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  }

  const userStats = useMemo(() => {
    const total = workers.length;
    const labour = workers.filter((w) => w.role === "worker").length;
    const processor = workers.filter((w) => w.role === "processor").length;
    const active = workers.filter((w) => w.is_active).length;
    return { total, labour, processor, active, inactive: total - active };
  }, [workers]);

  const dispatchStats = useMemo(() => {
    const total = dispatches.length;
    const submitted = dispatches.filter((d) => d.status === "submitted").length;
    const approved = dispatches.filter((d) => d.status === "approved").length;
    const rejected = dispatches.filter((d) => d.status === "rejected").length;
    return { total, submitted, approved, rejected, reviewed: total - submitted - approved - rejected };
  }, [dispatches]);

  const needsAttention = useMemo(
    () =>
      dispatches
        .filter((d) => d.status === "submitted")
        .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()),
    [dispatches]
  );

  const recentDispatches = useMemo(
    () =>
      [...dispatches]
        .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
        .slice(0, RECENT_LIMIT),
    [dispatches]
  );

  usePageMeta(
    {
      title: "Dashboard",
      /* The dashboard is the root of the tree, so it has no trail to draw. */
      crumbs: [],
      subtitle: `${dispatchStats.submitted} dispatch${
        dispatchStats.submitted === 1 ? "" : "es"
      } need review · ${userStats.active} active user${userStats.active === 1 ? "" : "s"}`,
      /* The greeting block and the stat cards report the same figures. */
      selfTitles: true,
    },
    [dispatchStats.submitted, userStats.active]
  );

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-40 gap-4"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={40} className="text-primary animate-spin" />
        <p className="text-base text-text-muted font-medium">Loading dashboard…</p>
      </div>
    );
  }

  const anyError = errors.workers || errors.dispatches;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ── WELCOME HEADER ───────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-extrabold text-text leading-tight">
            Welcome back, <span className="text-primary capitalize">{adminUsername}</span>
          </h1>
          <p className="text-[15px] text-text-muted mt-2">
            {dispatchStats.submitted > 0
              ? `${dispatchStats.submitted} dispatch${
                  dispatchStats.submitted === 1 ? "" : "es"
                } are waiting for your review.`
              : "Nothing is waiting for review right now."}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Reload every figure on this page"
          className="self-start flex items-center gap-2.5 px-5 py-3 rounded-xl bg-surface border border-border text-sm font-semibold text-text-muted hover:text-text hover:bg-surface-hover hover:border-border-hover transition-all duration-200 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <InlineRefreshBar show={refreshing} />

      {anyError && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 rounded-xl bg-danger-muted border border-danger/20"
        >
          <p className="text-sm text-danger font-semibold flex-1">
            {errors.dispatches ?? errors.workers}
            {errors.dispatches && errors.workers
              ? " Some figures below may be incomplete."
              : errors.dispatches
                ? " The dispatch figures below may be incomplete."
                : ""}
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            className="self-start text-sm font-bold text-danger hover:underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── USERS ────────────────────────── */}
      <section aria-label="User counts">
        <h2 className="sr-only">Users</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          <StatCard
            title="Labour Users"
            value={userStats.labour}
            caption={`out of ${userStats.total} users`}
            emptyHint="none created yet"
            icon={<Users size={22} />}
            color="#8B5CF6"
            bgColor="#8B5CF615"
            to="/labour"
          />
          <StatCard
            title="Processor Users"
            value={userStats.processor}
            caption={`out of ${userStats.total} users`}
            emptyHint="none created yet"
            icon={<UserCog size={22} />}
            color="#3B82F6"
            bgColor="#3B82F615"
            to="/processor"
          />
          <StatCard
            title="Active Users"
            value={userStats.active}
            caption={`can sign in · ${userStats.inactive} cannot`}
            emptyHint="no users exist yet"
            icon={<UserCheck size={22} />}
            color="#10B981"
            bgColor="#10B98115"
            to="/labour?filter=active"
          />
          <StatCard
            title="Inactive Users"
            value={userStats.inactive}
            caption="kept for their history"
            emptyHint="everyone can sign in"
            icon={<UserX size={22} />}
            color="#94A3B8"
            bgColor="#94A3B815"
            to="/labour?filter=inactive"
          />
        </div>
      </section>

      {/* ── DISPATCHES ────────────────────── */}
      <section aria-label="Dispatch counts">
        <h2 className="sr-only">Dispatches</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          <StatCard
            title="Total Dispatches"
            value={dispatchStats.total}
            caption="all time"
            emptyHint="none submitted yet"
            icon={<Truck size={22} />}
            color="#3B82F6"
            bgColor="#3B82F615"
            to="/dispatches"
          />
          <StatCard
            title="Needs Review"
            value={dispatchStats.submitted}
            caption="waiting on you"
            emptyHint="nothing waiting"
            icon={<Clock size={22} />}
            color="#F59E0B"
            bgColor="#F59E0B15"
            to="/dispatches?status=submitted"
          />
          <StatCard
            title="Approved"
            value={dispatchStats.approved}
            caption={`of ${dispatchStats.total} decided`}
            emptyHint="none approved yet"
            icon={<CheckCircle2 size={22} />}
            color="#10B981"
            bgColor="#10B98115"
            to="/dispatches?status=approved"
          />
          <StatCard
            title="Rejected"
            value={dispatchStats.rejected}
            caption={`of ${dispatchStats.total} decided`}
            emptyHint="none rejected"
            icon={<XCircle size={22} />}
            color="#EF4444"
            bgColor="#EF444415"
            to="/dispatches?status=rejected"
          />
        </div>
      </section>

      {/* ── NEEDS ATTENTION + RECENT ─────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DispatchPanel
          title="Needs Attention"
          subtitle="Dispatches awaiting review, newest first"
          badge={`${dispatchStats.submitted}`}
          badgeClass="bg-warning-muted text-warning"
          items={needsAttention.slice(0, ATTENTION_LIMIT)}
          totalCount={dispatchStats.submitted}
          timeLabel={timeAgo}
          emptyIcon={<CheckCircle2 size={36} className="text-success" />}
          emptyTitle="All clear"
          emptyBody="Every dispatch has been reviewed."
          error={errors.dispatches}
        />

        <DispatchPanel
          title="Recent Dispatches"
          subtitle="Latest activity across all workers"
          badge={`${dispatchStats.total} total`}
          badgeClass="bg-primary-muted text-primary"
          items={recentDispatches}
          totalCount={dispatchStats.total}
          timeLabel={formatDispatchDate}
          emptyIcon={<Truck size={36} className="opacity-30" />}
          emptyTitle="No dispatches yet"
          emptyBody="When a worker submits a dispatch it appears here."
          error={errors.dispatches}
        />
      </div>

      {/* ── QUICK ACTIONS ────────────────── */}
      <div className="bg-surface border border-border rounded-2xl p-5 sm:p-7">
        <h2 className="text-base font-bold text-text mb-1">Quick Actions</h2>
        <p className="text-sm text-text-muted mb-5">The screens you use most, one click away.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          {[
            {
              label: "Labour Jobs",
              icon: <ClipboardList size={22} />,
              color: "#8B5CF6",
              bg: "#8B5CF615",
              path: "/jobs/labour",
            },
            {
              label: "With Material Jobs",
              icon: <Layers size={22} />,
              color: "#3B82F6",
              bg: "#3B82F615",
              path: "/jobs/with-material",
            },
            {
              label: "Import from Excel",
              icon: <FileSpreadsheet size={22} />,
              color: "#10B981",
              bg: "#10B98115",
              path: "/import",
            },
            {
              label: "Folders",
              icon: <FolderOpen size={22} />,
              color: "#3B82F6",
              bg: "#3B82F615",
              path: "/folders",
            },
            {
              label: "Dispatches",
              icon: <Truck size={22} />,
              color: "#F59E0B",
              bg: "#F59E0B15",
              path: "/dispatches",
            },
            {
              label: "Labour Users",
              icon: <Plus size={22} />,
              color: "#10B981",
              bg: "#10B98115",
              path: "/labour",
            },
            {
              label: "Owner Stock",
              icon: <Package size={22} />,
              color: "#3B82F6",
              bg: "#3B82F615",
              path: "/stock-owner",
            },
            {
              label: "Company Stock",
              icon: <Package size={22} />,
              color: "#8B5CF6",
              bg: "#8B5CF615",
              path: "/stock-company",
            },
            {
              label: "Group Bills",
              icon: <FileText size={22} />,
              color: "#F59E0B",
              bg: "#F59E0B15",
              path: "/group-bills",
            },
            {
              label: "Drawings",
              icon: <PenTool size={22} />,
              color: "#10B981",
              bg: "#10B98115",
              path: "/group-drawings",
            },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => navigate(action.path)}
              className="flex flex-col items-center gap-3 p-4 sm:p-5 rounded-2xl bg-bg/50 border border-border hover:border-border-hover hover:bg-surface-hover transition-all duration-200 group cursor-pointer"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-110"
                style={{ backgroundColor: action.bg }}
              >
                <span style={{ color: action.color }}>{action.icon}</span>
              </div>
              <span className="text-[13px] font-semibold text-text-muted group-hover:text-text text-center transition-colors leading-tight">
                {action.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   DISPATCH PANEL
   ═══════════════════════════════════════════ */

function DispatchPanel({
  title,
  subtitle,
  badge,
  badgeClass,
  items,
  totalCount,
  timeLabel,
  emptyIcon,
  emptyTitle,
  emptyBody,
  error,
}: {
  title: string;
  subtitle: string;
  badge: string;
  badgeClass: string;
  items: Dispatch[];
  /** How many exist in total, so "showing 5 of 12" can be said. */
  totalCount: number;
  timeLabel: (s: string) => string;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyBody: string;
  error?: string;
}) {
  const navigate = useNavigate();
  const remaining = totalCount - items.length;

  return (
    <section className="bg-surface border border-border rounded-2xl overflow-hidden flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-5 border-b border-border">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-text">{title}</h3>
          <p className="text-[13px] text-text-muted mt-0.5">{subtitle}</p>
        </div>
        <span className={`text-[13px] font-bold px-3 py-1.5 rounded-full shrink-0 ${badgeClass}`}>
          {badge}
        </span>
      </div>

      <div className="divide-y divide-border flex-1">
        {error ? (
          <div className="px-5 sm:px-6 py-10 text-center">
            <p className="text-sm text-danger font-semibold">{error}</p>
            <button
              type="button"
              onClick={() => navigate("/dispatches")}
              className="mt-3 text-sm font-bold text-primary hover:underline cursor-pointer"
            >
              Open the dispatch list
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted px-6 text-center">
            <span className="mb-3">{emptyIcon}</span>
            <p className="text-[15px] font-semibold text-text">{emptyTitle}</p>
            <p className="text-[13px] mt-1">{emptyBody}</p>
          </div>
        ) : (
          <>
            {items.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => navigate(`/dispatches/${d.id}`)}
                className="w-full flex items-center gap-4 px-5 sm:px-6 py-4 hover:bg-surface-hover transition-colors text-left cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-[15px] font-bold text-text truncate">
                      {d.worker_username}
                    </span>
                    <span
                      className="text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
                      style={{
                        backgroundColor: getStatusColor(d.status) + "20",
                        color: getStatusColor(d.status),
                      }}
                    >
                      {d.status}
                    </span>
                  </div>
                  <p className="text-[13px] text-text-muted mt-1 truncate">
                    {d.vehicle_number} · {getMaterialLabel(d.material_type)}
                  </p>
                </div>
                <span className="text-[13px] text-text-muted shrink-0 font-medium hidden sm:block">
                  {timeLabel(d.submitted_at)}
                </span>
                <ChevronRight size={18} className="text-text-muted shrink-0" />
              </button>
            ))}
            {remaining > 0 && (
              <p className="px-5 sm:px-6 py-2.5 text-xs text-text-muted bg-bg/40">
                Showing {items.length} of {totalCount}. {remaining} more waiting.
              </p>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate("/dispatches")}
        className="w-full flex items-center justify-center gap-2 px-5 sm:px-6 py-4 border-t border-border text-sm font-bold text-primary hover:bg-primary-muted transition-colors cursor-pointer"
      >
        View all dispatches
        <ArrowUpRight size={15} />
      </button>
    </section>
  );
}
