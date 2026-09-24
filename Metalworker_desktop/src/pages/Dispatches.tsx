// src/pages/Dispatches.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Truck,
  Search,
  Loader2,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Inbox,
} from "lucide-react";
import {
  fetchAdminDispatches,
  getMaterialLabel,
  getStatusColor,
} from "../services/dispatch";
import type { Dispatch, DispatchStatus } from "../types/dispatch";

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

interface UserGroup {
  username: string;
  dispatches: Dispatch[];
}

export default function DispatchesPage() {
  const navigate = useNavigate();
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DispatchStatus | "all">("all");
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  const loadDispatches = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchAdminDispatches();
      if (res.ok && res.data) {
        setDispatches(res.data);
      } else {
        setError(res.error || "Failed to load dispatches.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dispatches.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDispatches(); }, [loadDispatches]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadDispatches();
    setRefreshing(false);
  }

  const filteredDispatches = useMemo(() => {
    let result = dispatches;
    if (filter !== "all") result = result.filter((d) => d.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) => d.worker_username.toLowerCase().includes(q) || d.vehicle_number.toLowerCase().includes(q)
      );
    }
    return result;
  }, [dispatches, filter, search]);

  const groupedDispatches = useMemo(() => {
    const groups = new Map<string, Dispatch[]>();
    filteredDispatches.forEach((d) => {
      if (!groups.has(d.worker_username)) groups.set(d.worker_username, []);
      groups.get(d.worker_username)!.push(d);
    });
    const result: UserGroup[] = [];
    groups.forEach((dispatches, username) => result.push({ username, dispatches }));
    return result;
  }, [filteredDispatches]);

  function toggleUser(username: string) {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  const filterOptions: (DispatchStatus | "all")[] = ["all", "submitted", "reviewed", "approved", "rejected"];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary-muted flex items-center justify-center">
            <Truck size={24} className="text-primary" />
          </div>
          <div>
            <h1 className="text-[22px] font-extrabold text-text">Dispatch Management</h1>
            <p className="text-[14px] text-text-muted mt-0.5">
              {filteredDispatches.length} dispatch{filteredDispatches.length !== 1 ? "es" : ""} • {groupedDispatches.length} worker{groupedDispatches.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <button onClick={handleRefresh} disabled={refreshing}
          className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-surface border border-border text-[14px] text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer">
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-danger-muted border border-danger/20">
          <AlertTriangle size={20} className="text-danger shrink-0" />
          <p className="text-[14px] text-danger flex-1 font-medium">{error}</p>
          <button onClick={handleRefresh} className="text-[14px] font-bold text-danger hover:underline cursor-pointer">Retry</button>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-lg">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search username or vehicle..."
            className="w-full pl-12 pr-5 py-3 rounded-xl bg-surface border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
        </div>
        <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1.5">
          {filterOptions.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-[13px] font-bold transition-all cursor-pointer capitalize ${
                filter === f ? "bg-primary text-white" : "text-text-muted hover:text-text hover:bg-surface-hover"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Dispatch List */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {filteredDispatches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Inbox size={44} className="text-text-muted/30 mb-3" />
            <p className="text-[15px] font-medium text-text-muted">
              {search || filter !== "all" ? "No dispatches match your search or filter." : "No dispatches found."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {groupedDispatches.map((group) => {
              if (group.dispatches.length === 1) {
                const d = group.dispatches[0];
                return (
                  <button key={d.id} onClick={() => navigate(`/dispatches/${d.id}`)}
                    className="w-full flex items-center gap-4 px-6 py-5 hover:bg-surface-hover/50 transition-colors text-left cursor-pointer">
                    <div className="w-11 h-11 rounded-xl bg-primary-muted flex items-center justify-center text-primary font-bold text-[14px] shrink-0">
                      {d.worker_username.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-bold text-text truncate">{d.worker_username}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase"
                          style={{ backgroundColor: getStatusColor(d.status) + "20", color: getStatusColor(d.status) }}>
                          {d.status}
                        </span>
                      </div>
                      <p className="text-[13px] text-text-muted mt-1">{d.vehicle_number} • {getMaterialLabel(d.material_type)}</p>
                    </div>
                    <p className="text-[13px] text-text-muted shrink-0 font-medium">{formatDate(d.submitted_at)}</p>
                    <ChevronRight size={16} className="text-text-muted shrink-0" />
                  </button>
                );
              }

              const isExpanded = expandedUsers.has(group.username);
              return (
                <div key={group.username}>
                  <button onClick={() => toggleUser(group.username)}
                    className="w-full flex items-center gap-4 px-6 py-5 hover:bg-surface-hover/50 transition-colors text-left cursor-pointer">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-[14px] shrink-0">
                      {group.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[15px] font-bold text-text">{group.username}</span>
                      <p className="text-[13px] text-text-muted mt-0.5">{group.dispatches.length} dispatches</p>
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border/50">
                      {group.dispatches.map((d) => (
                        <button key={d.id} onClick={() => navigate(`/dispatches/${d.id}`)}
                          className="w-full flex items-center gap-4 pl-16 pr-6 py-4 hover:bg-surface-hover/30 transition-colors text-left cursor-pointer border-b border-border/30 last:border-b-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2.5">
                              <span className="text-[14px] text-text font-medium">{d.vehicle_number}</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase"
                                style={{ backgroundColor: getStatusColor(d.status) + "20", color: getStatusColor(d.status) }}>
                                {d.status}
                              </span>
                            </div>
                            <p className="text-[13px] text-text-muted mt-1">{getMaterialLabel(d.material_type)} • {formatDate(d.submitted_at)}</p>
                          </div>
                          <ChevronRight size={16} className="text-text-muted shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
