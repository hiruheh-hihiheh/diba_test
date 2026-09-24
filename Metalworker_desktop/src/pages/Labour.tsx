// src/pages/Labour.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  Plus,
  Search,
  Edit3,
  Trash2,
  Loader2,
  AlertTriangle,
  RefreshCw,
  X,
  Eye,
  EyeOff,
  UserCheck,
  UserX,
} from "lucide-react";
import {
  createWorkerUser,
  deleteWorker,
  fetchWorkers,
  updateWorkerProfile,
  updateWorkerUsername,
} from "../services/admin";
import type { Profile } from "../types/profile";

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatLastLogin(dateStr?: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Never";

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday)
    return (
      "Today at " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ═══════════════════════════════════════════
   MODAL COMPONENT
   ═══════════════════════════════════════════ */

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-xl animate-scale-in">
        <div className="flex items-center justify-between px-7 py-5 border-b border-border">
          <h3 className="text-[18px] font-bold text-text">{title}</h3>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-7">{children}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */

export default function LabourPage() {
  const [workers, setWorkers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  // Add modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addMessage, setAddMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Profile | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editLoading, setEditLoading] = useState(false);
  const [editMessage, setEditMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  /* ── DATA LOADING ──────────────────────── */

  const loadWorkers = useCallback(async () => {
    try {
      const list = await fetchWorkers();
      setWorkers(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadWorkers();
    setRefreshing(false);
  }

  /* ── COMPUTED ───────────────────────────── */

  const labourUsers = useMemo(() => {
    let result = workers.filter((w) => w.role === "worker");
    if (filter === "active") result = result.filter((w) => w.is_active);
    if (filter === "inactive") result = result.filter((w) => !w.is_active);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (w) =>
          w.username.toLowerCase().includes(q) ||
          (w.full_name ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [workers, filter, search]);

  /* ── ADD WORKER ────────────────────────── */

  async function handleCreate() {
    setAddMessage(null);
    const cleanUsername = addUsername.trim().toLowerCase();

    if (!cleanUsername || !addPassword) {
      setAddMessage({ type: "error", text: "Please enter username and password." });
      return;
    }
    if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
      setAddMessage({
        type: "error",
        text: "Username must be 3-30 characters (letters, numbers, dots, underscores, hyphens).",
      });
      return;
    }
    if (cleanUsername === "admin") {
      setAddMessage({ type: "error", text: "The username 'admin' is reserved." });
      return;
    }
    if (addPassword.length < 6) {
      setAddMessage({ type: "error", text: "Password must contain at least 6 characters." });
      return;
    }
    if (cleanUsername.endsWith("_processor")) {
      setAddMessage({ type: "error", text: "Labour usernames cannot end with _processor." });
      return;
    }

    try {
      setAddLoading(true);
      const result = await createWorkerUser(cleanUsername, addPassword, "worker");
      if (!result.ok) {
        setAddMessage({ type: "error", text: result.error ?? "Failed to create user." });
        return;
      }
      setAddMessage({ type: "success", text: `User "${cleanUsername}" created successfully.` });
      setAddUsername("");
      setAddPassword("");
      await loadWorkers();
    } catch (err) {
      setAddMessage({ type: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setAddLoading(false);
    }
  }

  /* ── EDIT WORKER ───────────────────────── */

  function openEdit(worker: Profile) {
    setEditingWorker(worker);
    setEditFullName(worker.full_name ?? "");
    setEditUsername(worker.username);
    setEditIsActive(worker.is_active);
    setEditMessage(null);
    setShowEditModal(true);
  }

  async function handleEditSave() {
    if (!editingWorker) return;
    setEditMessage(null);
    setEditLoading(true);

    try {
      const profileRes = await updateWorkerProfile(editingWorker.id, {
        full_name: editFullName.trim(),
        is_active: editIsActive,
      });

      if (!profileRes.ok) {
        setEditMessage({ type: "error", text: profileRes.error || "Failed to update profile." });
        setEditLoading(false);
        return;
      }

      const cleanUsername = editUsername.trim().toLowerCase();
      if (cleanUsername !== editingWorker.username.toLowerCase()) {
        if (cleanUsername.endsWith("_processor")) {
          setEditMessage({ type: "error", text: "Labour usernames cannot end with _processor." });
          setEditLoading(false);
          return;
        }
        const usernameRes = await updateWorkerUsername(editingWorker.id, cleanUsername);
        if (!usernameRes.ok) {
          setEditMessage({ type: "error", text: usernameRes.error || "Failed to update username." });
          setEditLoading(false);
          return;
        }
      }

      setEditMessage({ type: "success", text: "User updated successfully." });
      await loadWorkers();
      setTimeout(() => {
        setShowEditModal(false);
        setEditMessage(null);
      }, 1000);
    } catch (err) {
      setEditMessage({ type: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setEditLoading(false);
    }
  }

  /* ── DELETE WORKER ─────────────────────── */

  async function handleDelete(worker: Profile) {
    const confirmed = window.confirm(
      `Delete "${worker.username}"?\n\nThis will permanently remove the user's account and authentication credentials.`
    );
    if (!confirmed) return;

    try {
      const res = await deleteWorker(worker.id);
      if (res.ok) {
        await loadWorkers();
      } else {
        window.alert(res.error || "Failed to delete user.");
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to delete user.");
    }
  }

  /* ── RENDER ────────────────────────────── */

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
          <div className="w-12 h-12 rounded-xl bg-purple-muted flex items-center justify-center">
            <Users size={24} className="text-purple" />
          </div>
          <div>
            <h1 className="text-[22px] font-extrabold text-text">Labour Management</h1>
            <p className="text-[14px] text-text-muted mt-0.5">
              {labourUsers.length} labour user{labourUsers.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface border border-border text-[14px] text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer"
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => {
              setAddMessage(null);
              setAddUsername("");
              setAddPassword("");
              setShowAddModal(true);
            }}
            className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-[14px] font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer"
          >
            <Plus size={18} />
            Add Labour
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-lg">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
            className="w-full pl-12 pr-5 py-3 rounded-xl bg-surface border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
          />
        </div>
        <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1.5">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-[13px] font-bold transition-all cursor-pointer ${
                filter === f
                  ? "bg-primary text-white"
                  : "text-text-muted hover:text-text hover:bg-surface-hover"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* User Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4">User</th>
              <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4">Status</th>
              <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4 hidden lg:table-cell">Created</th>
              <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4 hidden lg:table-cell">Last Login</th>
              <th className="text-right text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {labourUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-16 text-center">
                  <AlertTriangle size={36} className="mx-auto text-text-muted/30 mb-3" />
                  <p className="text-[15px] text-text-muted">
                    {search || filter !== "all"
                      ? "No users match your search or filter."
                      : "No labour users yet."}
                  </p>
                </td>
              </tr>
            ) : (
              labourUsers.map((worker) => (
                <tr key={worker.id} className="hover:bg-surface-hover/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-xl bg-purple-muted flex items-center justify-center text-purple font-bold text-[14px] shrink-0">
                        {worker.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-[15px] font-bold text-text">{worker.username}</p>
                        {worker.full_name && (
                          <p className="text-[13px] text-text-muted mt-0.5">{worker.full_name}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-2 text-[13px] font-bold px-3 py-1.5 rounded-full ${
                        worker.is_active
                          ? "bg-success-muted text-success"
                          : "bg-danger-muted text-danger"
                      }`}
                    >
                      {worker.is_active ? <UserCheck size={14} /> : <UserX size={14} />}
                      {worker.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    <p className="text-[14px] text-text-muted">{formatDate(worker.created_at)}</p>
                  </td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    <p className="text-[14px] text-text-muted">{formatLastLogin(worker.last_login_at)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(worker)}
                        className="p-2.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary-muted transition-all cursor-pointer"
                        title="Edit"
                      >
                        <Edit3 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(worker)}
                        className="p-2.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger-muted transition-all cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── ADD MODAL ────────────────────── */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Labour User"
      >
        <div className="space-y-5">
          <div>
            <label className="block text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] mb-2.5">
              Username
            </label>
            <input
              type="text"
              value={addUsername}
              onChange={(e) => {
                setAddUsername(e.target.value);
                setAddMessage(null);
              }}
              placeholder="e.g. john_doe"
              autoCapitalize="none"
              className="w-full px-5 py-3.5 rounded-xl bg-bg border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
            />
            <p className="text-xs text-text-muted mt-1.5">
              Must NOT end with <code className="text-warning">_processor</code>
            </p>
          </div>

          <div>
            <label className="block text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] mb-2.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showAddPassword ? "text" : "password"}
                value={addPassword}
                onChange={(e) => {
                  setAddPassword(e.target.value);
                  setAddMessage(null);
                }}
                placeholder="Min 6 characters"
                className="w-full px-5 py-3.5 pr-14 rounded-xl bg-bg border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
              />
              <button
                type="button"
                onClick={() => setShowAddPassword(!showAddPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors cursor-pointer p-1"
              >
                {showAddPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {addMessage && (
            <div
              className={`px-5 py-4 rounded-xl text-[14px] animate-scale-in ${
                addMessage.type === "error"
                  ? "bg-danger-muted border border-danger/20 text-danger"
                  : "bg-success-muted border border-success/20 text-success"
              }`}
            >
              {addMessage.text}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowAddModal(false)}
              className="px-5 py-3 rounded-xl text-[14px] font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={addLoading}
              className="px-7 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white text-[14px] font-bold transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2.5"
            >
              {addLoading && <Loader2 size={14} className="animate-spin" />}
              Create User
            </button>
          </div>
        </div>
      </Modal>

      {/* ── EDIT MODAL ───────────────────── */}
      <Modal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Labour User"
      >
        <div className="space-y-5">
          <div>
            <label className="block text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] mb-2.5">
              Full Name
            </label>
            <input
              type="text"
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              placeholder="Enter full name"
              className="w-full px-5 py-3.5 rounded-xl bg-bg border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
            />
          </div>

          <div>
            <label className="block text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] mb-2.5">
              Username
            </label>
            <input
              type="text"
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
              autoCapitalize="none"
              className="w-full px-5 py-3.5 rounded-xl bg-bg border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
            />
          </div>

          <div>
            <label className="block text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] mb-2.5">
              Status
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditIsActive(true)}
                className={`flex-1 py-3 rounded-xl text-[14px] font-bold transition-all cursor-pointer border ${
                  editIsActive
                    ? "bg-success-muted border-success/30 text-success"
                    : "bg-surface border-border text-text-muted hover:bg-surface-hover"
                }`}
              >
                Active
              </button>
              <button
                onClick={() => setEditIsActive(false)}
                className={`flex-1 py-3 rounded-xl text-[14px] font-bold transition-all cursor-pointer border ${
                  !editIsActive
                    ? "bg-danger-muted border-danger/30 text-danger"
                    : "bg-surface border-border text-text-muted hover:bg-surface-hover"
                }`}
              >
                Inactive
              </button>
            </div>
          </div>

          {editMessage && (
            <div
              className={`px-5 py-4 rounded-xl text-[14px] animate-scale-in ${
                editMessage.type === "error"
                  ? "bg-danger-muted border border-danger/20 text-danger"
                  : "bg-success-muted border border-success/20 text-success"
              }`}
            >
              {editMessage.text}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowEditModal(false)}
              className="px-5 py-3 rounded-xl text-[14px] font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleEditSave}
              disabled={editLoading}
              className="px-7 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white text-[14px] font-bold transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2.5"
            >
              {editLoading && <Loader2 size={14} className="animate-spin" />}
              Save Changes
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
