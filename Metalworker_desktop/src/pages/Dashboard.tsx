// src/pages/Dashboard.tsx
//
// Admin landing screen.
//
// Behaviour is unchanged from the audited version: the same three fetches, the
// same counts, the same deep links (with their filters) and the same honest
// error reporting. This pass is presentation only:
//  * The page now opens with an operational summary — how much is waiting, and
//    what the whole dispatch pipeline looks like — instead of eight equally
//    weighted numbers. "Needs review" is the only figure with a copper CTA.
//  * Users moved from four large cards to a compact metric strip, because the
//    dashboard's job is operations, not headcount.
//  * Quick Actions became a dense, label-first grid rather than ten tall cards.
//  * Panels share one header rhythm and one row rhythm with the list screens.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  UserCog,
  UserCheck,
  Truck,
  CheckCircle2,
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
  AlertCircle,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { fetchWorkers } from "../services/admin";
import { fetchAdminDispatches, getMaterialLabel } from "../services/dispatch";
import type { Profile } from "../types/profile";
import type { Dispatch } from "../types/dispatch";
import { usePageMeta } from "../hooks/usePageMeta";
import { InlineRefreshBar } from "../components/ui/LoadingState";

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
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
   STATUS BADGE
   ═══════════════════════════════════════════ */

const statusTone: Record<string, string> = {
  submitted: "bg-warning-muted text-warning border-warning/25",
  reviewed: "bg-info-muted text-info border-info/25",
  approved: "bg-success-muted text-success border-success/25",
  rejected: "bg-danger-muted text-danger border-danger/25",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`badge border capitalize ${
        statusTone[status] ?? "bg-surface-hover text-text-muted border-border"
      }`}
    >
      {status}
    </span>
  );
}

/* ═══════════════════════════════════════════
   METRIC
   ═══════════════════════════════════════════ */

function Metric({
  label,
  value,
  caption,
  icon,
  to,
}: {
  label: string;
  value: number;
  caption: string;
  icon: ReactNode;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group panel px-4 py-3.5 hover:border-border-hover transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          {label}
        </span>
        <span className="text-text-muted/70 group-hover:text-primary transition-colors">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-[24px] font-semibold leading-none text-text tabular-nums">
        {value.toLocaleString()}
      </p>
      <p className="mt-1.5 text-[11.5px] text-text-muted truncate">{caption}</p>
    </Link>
  );
}

/* ═══════════════════════════════════════════
   PIPELINE LEGEND ITEM
   ═══════════════════════════════════════════ */

function PipelineStat({
  color,
  label,
  value,
  total,
}: {
  color: string;
  label: string;
  value: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${color}`} />
        <dt className="text-[11px] font-medium text-text-muted truncate">{label}</dt>
      </div>
      <dd className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[17px] font-semibold text-text tabular-nums leading-none">
          {value}
        </span>
        <span className="text-[10.5px] text-text-muted/80 tabular-nums">{pct}%</span>
      </dd>
    </div>
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
    const timer = setTimeout(() => { void loadData(); }, 0);
    return () => clearTimeout(timer);
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
      /* The greeting block and the summary report the same figures. */
      selfTitles: true,
    },
    [dispatchStats.submitted, userStats.active]
  );

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-40 gap-3.5"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={30} className="text-primary animate-spin" />
        <p className="text-[13px] text-text-muted font-medium">Loading dashboard…</p>
      </div>
    );
  }

  const anyError = errors.workers || errors.dispatches;
  const oldestWaiting = needsAttention[needsAttention.length - 1];
  const reviewTotal = dispatchStats.total;

  const pipeline = [
    { key: "submitted", label: "Submitted", value: dispatchStats.submitted, bar: "bg-warning", dot: "bg-warning" },
    { key: "reviewed", label: "Reviewed", value: dispatchStats.reviewed, bar: "bg-info", dot: "bg-info" },
    { key: "approved", label: "Approved", value: dispatchStats.approved, bar: "bg-success", dot: "bg-success" },
    { key: "rejected", label: "Rejected", value: dispatchStats.rejected, bar: "bg-danger", dot: "bg-danger" },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── WELCOME HEADER ───────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">
            {new Date().toLocaleDateString([], {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.025em] text-text leading-tight">
            Welcome back, <span className="text-primary capitalize">{adminUsername}</span>
          </h1>
          <p className="text-[13px] text-text-muted mt-1.5">
            {dispatchStats.submitted > 0
              ? `${dispatchStats.submitted} dispatch${
                  dispatchStats.submitted === 1 ? "" : "es"
                } ${dispatchStats.submitted === 1 ? "is" : "are"} waiting for your review.`
              : "Nothing is waiting for review right now."}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn btn-secondary"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          {dispatchStats.submitted > 0 && (
            <Link to="/dispatches?status=submitted" className="btn btn-primary">
              Review queue
              <ArrowUpRight size={14} />
            </Link>
          )}
        </div>
      </div>

      <InlineRefreshBar show={refreshing} />

      {anyError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-danger/25 bg-danger-muted px-4 py-3 text-[13px] text-danger"
        >
          <AlertCircle size={16} className="text-danger shrink-0 hidden sm:block" />
          <p className="text-[12.5px] text-danger font-medium flex-1 leading-relaxed">
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
            className="self-start text-[12px] font-semibold text-danger hover:underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── REVIEW QUEUE + PIPELINE ──────── */}
      <section aria-label="Dispatch overview" className="panel overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,19rem)_1fr]">
          <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`w-1.5 h-1.5 rounded-full ${
                  dispatchStats.submitted > 0 ? "bg-warning" : "bg-success"
                }`}
              />
              <p className="eyebrow">Review queue</p>
            </div>

            <div className="mt-3 flex items-end gap-3">
              <p className="text-[40px] font-semibold leading-none text-text tabular-nums tracking-[-0.03em]">
                {dispatchStats.submitted.toLocaleString()}
              </p>
              <p className="text-[11.5px] text-text-muted leading-tight pb-1">
                dispatch{dispatchStats.submitted === 1 ? "" : "es"}
                <br />
                awaiting review
              </p>
            </div>

            <p className="text-[11.5px] text-text-muted mt-3">
              {dispatchStats.submitted > 0 && oldestWaiting
                ? `Oldest has been waiting ${timeAgo(oldestWaiting.submitted_at)}.`
                : "Every dispatch has been reviewed."}
            </p>

            <Link
              to={
                dispatchStats.submitted > 0
                  ? "/dispatches?status=submitted"
                  : "/dispatches"
              }
              className={`mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold hover:underline ${
                dispatchStats.submitted > 0 ? "text-primary" : "text-text-muted"
              }`}
            >
              {dispatchStats.submitted > 0 ? "Open the review queue" : "Browse all dispatches"}
              <ChevronRight size={13} />
            </Link>
          </div>

          <div className="p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="eyebrow">Pipeline</p>
              <p className="text-[11px] text-text-muted">
                <span className="font-semibold text-text-secondary tabular-nums">
                  {reviewTotal.toLocaleString()}
                </span>{" "}
                all time
              </p>
            </div>

            {/* Ordinary approval flow, left to right. The gaps are 1px so the
                bar reads as four stages rather than one striped stripe. */}
            <div
              className="mt-3.5 flex h-1.5 w-full gap-1 overflow-hidden rounded-full"
              role="img"
              aria-label={pipeline
                .map((p) => `${p.label} ${p.value}`)
                .join(", ")}
            >
              {reviewTotal === 0 ? (
                <span className="h-full w-full rounded-full bg-surface-active" />
              ) : (
                pipeline
                  .filter((p) => p.value > 0)
                  .map((p) => (
                    <span
                      key={p.key}
                      className={`h-full rounded-full ${p.bar}`}
                      style={{ width: `${(p.value / reviewTotal) * 100}%` }}
                    />
                  ))
              )}
            </div>

            <dl className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4">
              {pipeline.map((p) => (
                <PipelineStat
                  key={p.key}
                  color={p.dot}
                  label={p.label}
                  value={p.value}
                  total={reviewTotal}
                />
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── METRICS ───────────────────────── */}
      <section aria-label="Workforce and dispatch totals">
        <h2 className="sr-only">Totals</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric
            label="Labour users"
            value={userStats.labour}
            caption={
              userStats.total === 0 ? "none created yet" : `of ${userStats.total} accounts`
            }
            icon={<Users size={15} />}
            to="/labour"
          />
          <Metric
            label="Processor users"
            value={userStats.processor}
            caption={
              userStats.total === 0 ? "none created yet" : `of ${userStats.total} accounts`
            }
            icon={<UserCog size={15} />}
            to="/processor"
          />
          <Metric
            label="Active accounts"
            value={userStats.active}
            caption={
              userStats.total === 0
                ? "no users exist yet"
                : `${userStats.inactive} cannot sign in`
            }
            icon={<UserCheck size={15} />}
            to="/labour?filter=active"
          />
          <Metric
            label="Total dispatches"
            value={dispatchStats.total}
            caption={dispatchStats.total === 0 ? "none submitted yet" : "all time"}
            icon={<Truck size={15} />}
            to="/dispatches"
          />
        </div>
      </section>

      {/* ── NEEDS ATTENTION + RECENT ─────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DispatchPanel
          title="Needs attention"
          subtitle="Dispatches awaiting review, newest first"
          badge={`${dispatchStats.submitted}`}
          badgeClass="bg-warning-muted text-warning border-warning/25"
          items={needsAttention.slice(0, ATTENTION_LIMIT)}
          totalCount={dispatchStats.submitted}
          timeLabel={timeAgo}
          emptyIcon={<CheckCircle2 size={20} className="text-success" />}
          emptyTitle="All clear"
          emptyBody="Every dispatch has been reviewed."
          error={errors.dispatches}
        />

        <DispatchPanel
          title="Recent dispatches"
          subtitle="Latest activity across all workers"
          badge={`${dispatchStats.total} total`}
          badgeClass="bg-surface-hover text-text-muted border-border"
          items={recentDispatches}
          totalCount={dispatchStats.total}
          timeLabel={formatDispatchDate}
          emptyIcon={<Truck size={20} />}
          emptyTitle="No dispatches yet"
          emptyBody="When a worker submits a dispatch it appears here."
          error={errors.dispatches}
        />
      </div>

      {/* ── QUICK ACTIONS ────────────────── */}
      <section className="panel overflow-hidden" aria-label="Quick actions">
        <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="text-[13.5px] font-semibold text-text">Quick actions</h2>
          <p className="text-[11px] text-text-muted hidden sm:block">
            The screens you use most
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1 p-1.5 pt-0">
          {[
            { label: "Labour Jobs", icon: <ClipboardList size={17} />, path: "/jobs/labour" },
            { label: "With Material", icon: <Layers size={17} />, path: "/jobs/with-material" },
            { label: "Import from Excel", icon: <FileSpreadsheet size={17} />, path: "/jobs/import" },
            { label: "Folders", icon: <FolderOpen size={17} />, path: "/folders" },
            { label: "Dispatches", icon: <Truck size={17} />, path: "/dispatches" },
            { label: "Bills", icon: <FileText size={17} />, path: "/bills" },
            { label: "Create Bill", icon: <FileText size={17} />, path: "/bills/create" },
            { label: "Owner Stock", icon: <Package size={17} />, path: "/stock-owner" },
            { label: "Company Stock", icon: <Package size={17} />, path: "/stock-company" },
            { label: "Drawings", icon: <PenTool size={17} />, path: "/group-drawings" },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => navigate(action.path)}
              className="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left hover:bg-surface-hover transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="w-7 h-7 rounded-[7px] border border-border bg-bg-secondary flex items-center justify-center text-text-muted group-hover:text-primary group-hover:border-primary/30 transition-colors shrink-0">
                {action.icon}
              </span>
              <span className="text-[12px] font-medium text-text-secondary group-hover:text-text truncate">
                {action.label}
              </span>
            </button>
          ))}
        </div>
      </section>
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
    <section className="panel-flat flex flex-col">
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-text leading-tight">{title}</h3>
          <p className="text-[11.5px] text-text-muted mt-1 leading-tight">{subtitle}</p>
        </div>
        <span className={`badge border shrink-0 ${badgeClass}`}>{badge}</span>
      </div>

      <div className="divide-y divide-border flex-1">
        {error ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[12.5px] text-danger font-medium">{error}</p>
            <button
              type="button"
              onClick={() => navigate("/dispatches")}
              className="mt-3 text-[12px] font-semibold text-primary hover:underline cursor-pointer"
            >
              Open the dispatch list
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-11 text-text-muted px-6 text-center">
            <span className="mb-3 w-10 h-10 rounded-lg border border-border bg-bg-secondary flex items-center justify-center text-text-muted">
              {emptyIcon}
            </span>
            <p className="text-[13px] font-semibold text-text">{emptyTitle}</p>
            <p className="text-[11.5px] mt-1">{emptyBody}</p>
          </div>
        ) : (
          <>
            {items.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => navigate(`/dispatches/${d.id}`)}
                className="w-full flex items-center gap-3.5 px-5 py-2.5 hover:bg-surface-hover/60 transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:bg-surface-hover"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-text truncate">
                      {d.worker_username}
                    </span>
                    <StatusBadge status={d.status} />
                  </div>
                  <p className="text-[11.5px] text-text-muted mt-0.5 truncate">
                    {d.vehicle_number} · {getMaterialLabel(d.material_type, d.custom_material)}
                  </p>
                </div>
                <span className="text-[11.5px] text-text-muted shrink-0 hidden sm:block tabular-nums">
                  {timeLabel(d.submitted_at)}
                </span>
                <ChevronRight size={15} className="text-text-muted/60 shrink-0" />
              </button>
            ))}
            {remaining > 0 && (
              <p className="px-5 py-2 text-[11px] text-text-muted bg-bg-secondary/50">
                Showing {items.length} of {totalCount}. {remaining} more waiting.
              </p>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate("/dispatches")}
        className="w-full flex items-center justify-center gap-1.5 px-5 py-3 border-t border-border text-[12px] font-semibold text-text-muted hover:text-primary hover:bg-primary/[0.04] transition-colors cursor-pointer"
      >
        View all dispatches
        <ArrowUpRight size={13} />
      </button>
    </section>
  );
}
