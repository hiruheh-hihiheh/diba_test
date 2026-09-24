// src/pages/Dashboard.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
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
  AlertTriangle,
  Loader2,
  ChevronRight,
  Eye,
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

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
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
  icon,
  color,
  bgColor,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 hover:border-border-hover transition-all duration-200 group">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-3xl font-extrabold text-text leading-none">{value}</p>
          <p className="text-[14px] text-text-muted mt-2 font-medium">{title}</p>
        </div>
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-110"
          style={{ backgroundColor: bgColor }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════ */

export default function DashboardPage() {
  const navigate = useNavigate();
  const { adminUsername } = useAuth();

  const [workers, setWorkers] = useState<Profile[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [workerList, dispatchRes] = await Promise.all([
        fetchWorkers(),
        fetchAdminDispatches(),
      ]);
      setWorkers(workerList);
      if (dispatchRes.ok && dispatchRes.data) {
        setDispatches(dispatchRes.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  const userStats = useMemo(() => {
    const total = workers.length;
    const labour = workers.filter((w) => w.role === "worker").length;
    const processor = workers.filter((w) => w.role === "processor").length;
    const active = workers.filter((w) => w.is_active).length;
    const inactive = total - active;
    return { total, labour, processor, active, inactive };
  }, [workers]);

  const dispatchStats = useMemo(() => {
    const total = dispatches.length;
    const submitted = dispatches.filter((d) => d.status === "submitted").length;
    const approved = dispatches.filter((d) => d.status === "approved").length;
    const rejected = dispatches.filter((d) => d.status === "rejected").length;
    return { total, submitted, approved, rejected };
  }, [dispatches]);

  const needsAttention = useMemo(() => {
    return dispatches
      .filter((d) => d.status === "submitted")
      .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
      .slice(0, 5);
  }, [dispatches]);

  const recentDispatches = useMemo(() => {
    return [...dispatches]
      .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
      .slice(0, 5);
  }, [dispatches]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-40">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="text-primary animate-spin" />
          <p className="text-base text-text-muted font-medium">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ── WELCOME HEADER ───────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-extrabold text-text leading-tight">
            Welcome back, <span className="text-primary capitalize">{adminUsername}</span>
          </h1>
          <p className="text-[15px] text-text-muted mt-2">
            Here's what's happening in your workspace today.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="
            flex items-center gap-2.5 px-5 py-3 rounded-xl
            bg-surface border border-border
            text-[14px] font-semibold text-text-muted
            hover:text-text hover:bg-surface-hover hover:border-border-hover
            transition-all duration-200
            disabled:opacity-50 cursor-pointer
          "
        >
          <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* ── ERROR BANNER ─────────────────── */}
      {error && (
        <div className="flex items-center gap-3 px-5 py-4 rounded-xl bg-danger-muted border border-danger/20">
          <AlertTriangle size={20} className="text-danger shrink-0" />
          <p className="text-[14px] text-danger flex-1 font-medium">{error}</p>
          <button onClick={handleRefresh} className="text-[14px] font-bold text-danger hover:underline cursor-pointer">Retry</button>
        </div>
      )}

      {/* ── STAT CARDS ROW 1 ─────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard title="Labour" value={userStats.labour} icon={<Users size={22} />} color="#8B5CF6" bgColor="#8B5CF615" />
        <StatCard title="Processor" value={userStats.processor} icon={<UserCog size={22} />} color="#3B82F6" bgColor="#3B82F615" />
        <StatCard title="Active Users" value={userStats.active} icon={<UserCheck size={22} />} color="#10B981" bgColor="#10B98115" />
        <StatCard title="Inactive Users" value={userStats.inactive} icon={<UserX size={22} />} color="#94A3B8" bgColor="#94A3B815" />
      </div>

      {/* ── STAT CARDS ROW 2 ─────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard title="Total Dispatches" value={dispatchStats.total} icon={<Truck size={22} />} color="#3B82F6" bgColor="#3B82F615" />
        <StatCard title="Needs Review" value={dispatchStats.submitted} icon={<Clock size={22} />} color="#F59E0B" bgColor="#F59E0B15" />
        <StatCard title="Approved" value={dispatchStats.approved} icon={<CheckCircle2 size={22} />} color="#10B981" bgColor="#10B98115" />
        <StatCard title="Rejected" value={dispatchStats.rejected} icon={<XCircle size={22} />} color="#EF4444" bgColor="#EF444415" />
      </div>

      {/* ── NEEDS ATTENTION + RECENT ─────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Needs Attention */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-5 border-b border-border">
            <div>
              <h3 className="text-[16px] font-bold text-text">Needs Attention</h3>
              <p className="text-[13px] text-text-muted mt-1">Dispatches awaiting review</p>
            </div>
            <span className="text-[13px] font-bold px-3 py-1.5 rounded-full bg-warning-muted text-warning">
              {dispatchStats.submitted}
            </span>
          </div>

          <div className="divide-y divide-border">
            {needsAttention.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-text-muted">
                <CheckCircle2 size={36} className="mb-3 text-success" />
                <p className="text-[15px] font-semibold">All Clear</p>
                <p className="text-[13px] mt-1">No dispatches require attention.</p>
              </div>
            ) : (
              needsAttention.map((d) => (
                <button
                  key={d.id}
                  onClick={() => navigate(`/dispatches/${d.id}`)}
                  className="w-full flex items-center gap-4 px-6 py-4 hover:bg-surface-hover transition-colors text-left cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[15px] font-bold text-text truncate">{d.worker_username}</span>
                      <span
                        className="text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
                        style={{ backgroundColor: getStatusColor(d.status) + "20", color: getStatusColor(d.status) }}
                      >
                        {d.status}
                      </span>
                    </div>
                    <p className="text-[13px] text-text-muted mt-1">
                      {d.vehicle_number} · {getMaterialLabel(d.material_type)}
                    </p>
                  </div>
                  <span className="text-[13px] text-text-muted shrink-0 font-medium">{timeAgo(d.submitted_at)}</span>
                  <ChevronRight size={18} className="text-text-muted shrink-0" />
                </button>
              ))
            )}
          </div>

          <button
            onClick={() => navigate("/dispatches")}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 border-t border-border text-[14px] font-bold text-primary hover:bg-primary-muted transition-colors cursor-pointer"
          >
            <Eye size={16} />
            View All Dispatches
          </button>
        </div>

        {/* Recent Dispatches */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-5 border-b border-border">
            <div>
              <h3 className="text-[16px] font-bold text-text">Recent Dispatches</h3>
              <p className="text-[13px] text-text-muted mt-1">Latest activity</p>
            </div>
            <span className="text-[13px] font-bold px-3 py-1.5 rounded-full bg-primary-muted text-primary">
              {dispatchStats.total} total
            </span>
          </div>

          <div className="divide-y divide-border">
            {recentDispatches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-text-muted">
                <Truck size={36} className="mb-3 opacity-30" />
                <p className="text-[15px] font-semibold">No Dispatches Yet</p>
                <p className="text-[13px] mt-1">Dispatch records will appear here.</p>
              </div>
            ) : (
              recentDispatches.map((d) => (
                <button
                  key={d.id}
                  onClick={() => navigate(`/dispatches/${d.id}`)}
                  className="w-full flex items-center gap-4 px-6 py-4 hover:bg-surface-hover transition-colors text-left cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[15px] font-bold text-text truncate">{d.worker_username}</span>
                      <span
                        className="text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide"
                        style={{ backgroundColor: getStatusColor(d.status) + "20", color: getStatusColor(d.status) }}
                      >
                        {d.status}
                      </span>
                    </div>
                    <p className="text-[13px] text-text-muted mt-1">
                      {d.vehicle_number} · {getMaterialLabel(d.material_type)}
                    </p>
                  </div>
                  <span className="text-[13px] text-text-muted shrink-0 font-medium">{formatDispatchDate(d.submitted_at)}</span>
                  <ChevronRight size={18} className="text-text-muted shrink-0" />
                </button>
              ))
            )}
          </div>

          <button
            onClick={() => navigate("/dispatches")}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 border-t border-border text-[14px] font-bold text-primary hover:bg-primary-muted transition-colors cursor-pointer"
          >
            <Eye size={16} />
            View All Dispatches
          </button>
        </div>
      </div>

      {/* ── QUICK ACTIONS ────────────────── */}
      <div className="bg-surface border border-border rounded-2xl p-7">
        <h3 className="text-[16px] font-bold text-text mb-5">Quick Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
          {[
            { label: "Add User", icon: <Plus size={22} />, color: "#10B981", bg: "#10B98115", path: "/labour" },
            { label: "Dispatches", icon: <Truck size={22} />, color: "#3B82F6", bg: "#3B82F615", path: "/dispatches" },
            { label: "Owner Stock", icon: <Package size={22} />, color: "#3B82F6", bg: "#3B82F615", path: "/stock-owner" },
            { label: "Company Stock", icon: <Package size={22} />, color: "#8B5CF6", bg: "#8B5CF615", path: "/stock-company" },
            { label: "Group Bills", icon: <FileText size={22} />, color: "#F59E0B", bg: "#F59E0B15", path: "/group-bills" },
            { label: "Drawings", icon: <PenTool size={22} />, color: "#10B981", bg: "#10B98115", path: "/group-drawings" },
            { label: "Folders", icon: <FolderOpen size={22} />, color: "#3B82F6", bg: "#3B82F615", path: "/folders" },
          ].map((action) => (
            <button
              key={action.label}
              onClick={() => navigate(action.path)}
              className="
                flex flex-col items-center gap-3 p-5 rounded-2xl
                bg-bg/50 border border-border
                hover:border-border-hover hover:bg-surface-hover
                transition-all duration-200
                group cursor-pointer
              "
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
