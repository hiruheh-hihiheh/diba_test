// src/pages/UsersPage.tsx
//
// One implementation shared by Labour Users (/labour) and Processor Users
// (/processor). The two pages were separate 400-line copies of each other.
//
// Behaviour preserved exactly:
//  * Labour usernames must NOT end with `_processor`.
//  * Processor usernames MUST end with `_processor`.
//  * `admin` is reserved in both.
//  * Auth emails are `username@metalworker.local` (handled by the service).
//
// UX changes:
//  * `window.confirm` / `window.alert` replaced by the in-app confirm dialog and
//    toasts, so feedback matches the rest of the app and is themed.
//  * A successful create now closes the dialog and confirms with a toast, so it
//    is unambiguous that the user was created; previously the dialog stayed open
//    with a bare "created successfully" line and no way to tell the difference
//    from a still-pending form.
//  * Empty states explain what to do next instead of a grey warning triangle.
//  * Search, filters, refresh and row actions use the shared components, so the
//    refresh icon has a tooltip and the buttons are labelled for screen readers.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
  UserCheck,
  UserX,
  Pencil,
  UserRoundPlus,
  UserRoundX,
  SearchX,
} from "lucide-react";
import {
  createWorkerUser,
  deleteWorker,
  fetchWorkers,
  updateWorkerProfile,
  updateWorkerUsername,
} from "../services/admin";
import type { Profile } from "../types/profile";
import Modal from "../components/ui/Modal";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import IconButton from "../components/ui/IconButton";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { usePageMeta } from "../contexts/PageMetaContext";
import { ErrorState, InlineRefreshBar } from "../components/ui/LoadingState";
import { readableError } from "../utils/readableError";
import { useSearchParams } from "react-router-dom";

type Role = "worker" | "processor";

interface UsersPageProps {
  role: Role;
  /** Plural noun for counts and headings, e.g. "labour user". */
  noun: string;
  /** Verb for the add button, e.g. "Add Labour". */
  addLabel: string;
  accent: "purple" | "primary";
  icon: ReactNode;
}

const accentCls = {
  purple: {
    chip: "bg-purple-muted text-purple",
    dot: "text-purple",
  },
  primary: {
    chip: "bg-primary-muted text-primary",
    dot: "text-primary",
  },
} as const;

const inputCls =
  "w-full px-4 py-3 rounded-xl bg-bg border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatLastLogin(dateStr?: string | null): string {
  if (!dateStr) return "Never signed in";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Never signed in";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return "Today, " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function UsersPage({ role, noun, addLabel, accent, icon }: UsersPageProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const [workers, setWorkers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /* The dashboard's "Inactive Users" card links here with ?filter=inactive. */
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState<"all" | "active" | "inactive">(() => {
    const f = searchParams.get("filter");
    return f === "active" || f === "inactive" ? f : "all";
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Profile | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const isProcessor = role === "processor";
  const usernameRule = isProcessor
    ? "Usernames must end with _processor"
    : "Usernames must not end with _processor";

  /* ── Data ─────────────────────────────────────────── */

  const loadWorkers = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setWorkers(await fetchWorkers());
        setError(null);
      } catch (e) {
        setError(
          readableError(e, {
            subject: `${noun} accounts`,
            fallback: `The list of ${noun} accounts could not be loaded. Check your connection and try again.`,
            byKind: {
              connection: `Could not reach the server, so the ${noun} list could not be loaded. Check your connection and try again.`,
              forbidden: `Your account does not have permission to view ${noun} accounts.`,
            },
          }).message
        );
      } finally {
        setLoading(false);
      }
    },
    [noun]
  );

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadWorkers(true);
    setRefreshing(false);
  }

  const roleUsers = useMemo(() => workers.filter((w) => w.role === role), [workers, role]);

  const visible = useMemo(() => {
    let result = roleUsers;
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
  }, [roleUsers, filter, search]);

  const counts = useMemo(
    () => ({
      all: roleUsers.length,
      active: roleUsers.filter((w) => w.is_active).length,
      inactive: roleUsers.filter((w) => !w.is_active).length,
    }),
    [roleUsers]
  );

  usePageMeta(
    {
      title: isProcessor ? "Processor Users" : "Labour Users",
      crumbs: [
        { label: "People" },
        { label: isProcessor ? "Processor Users" : "Labour Users" },
      ],
      subtitle: `${counts.all} ${noun}${counts.all === 1 ? "" : "s"} · ${counts.active} active · ${counts.inactive} inactive`,
      /* The body header and the filter chips both report the same split. */
      selfTitles: true,
    },
    [counts.all, counts.active, counts.inactive, noun, isProcessor]
  );

  /* ── Validation ───────────────────────────────────── */

  /** Returns an error message, or null when the username is acceptable. */
  function validateUsername(raw: string): string | null {
    const clean = raw.trim().toLowerCase();
    if (!clean) return "Enter a username.";
    if (!/^[a-z0-9._-]{3,30}$/.test(clean)) {
      return "Usernames must be 3–30 characters, using letters, numbers, dots, underscores or hyphens.";
    }
    if (clean === "admin") return "The username “admin” is reserved.";
    if (isProcessor && !clean.endsWith("_processor")) {
      return "Processor usernames must end with _processor.";
    }
    if (!isProcessor && clean.endsWith("_processor")) {
      return "Labour usernames cannot end with _processor.";
    }
    return null;
  }

  /* ── Create ───────────────────────────────────────── */

  async function handleCreate() {
    const cleanUsername = addUsername.trim().toLowerCase();

    const usernameError = validateUsername(addUsername);
    if (usernameError) {
      setAddError(usernameError);
      return;
    }
    if (!addPassword) {
      setAddError("Enter a password.");
      return;
    }
    if (addPassword.length < 6) {
      setAddError("Passwords must be at least 6 characters.");
      return;
    }

    setAddError(null);
    setAddLoading(true);
    try {
      const res = await createWorkerUser(cleanUsername, addPassword, role);
      if (!res.ok) {
        setAddError(res.error ?? "The account was not created. Please try again.");
        return;
      }
      setShowAddModal(false);
      setAddUsername("");
      setAddPassword("");
      await loadWorkers(true);
      toast.success({
        title: `${capitalise(noun)} created`,
        description: `“${cleanUsername}” can now sign in with that password.`,
      });
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : "The account was not created. Please try again."
      );
    } finally {
      setAddLoading(false);
    }
  }

  /* ── Edit ─────────────────────────────────────────── */

  function openEdit(worker: Profile) {
    setEditingWorker(worker);
    setEditFullName(worker.full_name ?? "");
    setEditUsername(worker.username);
    setEditIsActive(worker.is_active);
    setEditError(null);
    setShowEditModal(true);
  }

  async function handleEditSave() {
    if (!editingWorker || editLoading) return;
    setEditError(null);

    const cleanUsername = editUsername.trim().toLowerCase();
    if (cleanUsername !== editingWorker.username.toLowerCase()) {
      const usernameError = validateUsername(editUsername);
      if (usernameError) {
        setEditError(usernameError);
        return;
      }
    }
    if (!editFullName.trim() && !cleanUsername) {
      setEditError("A username is required.");
      return;
    }

    setEditLoading(true);
    try {
      const profileRes = await updateWorkerProfile(editingWorker.id, {
        full_name: editFullName.trim(),
        is_active: editIsActive,
      });
      if (!profileRes.ok) {
        setEditError(profileRes.error || "The account was not updated. Please try again.");
        return;
      }

      if (cleanUsername !== editingWorker.username.toLowerCase()) {
        const usernameRes = await updateWorkerUsername(editingWorker.id, cleanUsername);
        if (!usernameRes.ok) {
          setEditError(usernameRes.error || "The username was not updated. Please try again.");
          return;
        }
      }

      setShowEditModal(false);
      await loadWorkers(true);
      toast.success({
        title: "Account updated",
        description: `“${cleanUsername}”${
          editIsActive === editingWorker.is_active
            ? ""
            : editIsActive
              ? " can sign in again."
              : " can no longer sign in."
        }`,
      });
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "The account was not updated. Please try again."
      );
    } finally {
      setEditLoading(false);
    }
  }

  /* ── Delete ───────────────────────────────────────── */

  async function handleDelete(worker: Profile) {
    const ok = await confirm({
      title: `Delete “${worker.username}”?`,
      message: (
        <>
          The account and its sign-in credentials are permanently removed.{" "}
          <strong className="block mt-2 text-text">This cannot be undone.</strong>
          <span className="block mt-2">
            Prefer to keep the history? Close this and set the account to{" "}
            <strong className="text-text">Inactive</strong> instead — it then cannot sign in but the
            record stays.
          </span>
        </>
      ),
      confirmLabel: "Delete account",
    });
    if (!ok) return;

    setDeletingId(worker.id);
    try {
      const res = await deleteWorker(worker.id);
      if (res.ok) {
        // Remove locally so the table does not flash a spinner and the user
        // keeps their scroll position.
        setWorkers((prev) => prev.filter((w) => w.id !== worker.id));
        toast.success({
          title: "Account deleted",
          description: `“${worker.username}” was permanently removed.`,
        });
      } else {
        toast.error({
          title: "Could not delete account",
          description: res.error || "The account was not deleted. Please try again.",
        });
      }
    } catch (err) {
      toast.error({
        title: "Could not delete account",
        description:
          err instanceof Error ? err.message : "The account was not deleted. Please try again.",
      });
    } finally {
      setDeletingId(null);
    }
  }

  /* ── Render ───────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="text-primary animate-spin" />
        <span className="sr-only">Loading {noun} accounts</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header
          No <h1> and no subtitle: the TopBar already carries "Labour Users" and
          the active/inactive split, and printing the same split again here made
          the screen read as double-titled with two copies of the same numbers. */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              accentCls[accent].chip
            }`}
          >
            {icon}
          </div>
          <p className="text-sm text-text-muted min-w-0">
            Accounts that can sign in and submit work.{" "}
            <span className="text-text font-semibold">{counts.all}</span> total,{" "}
            <span className="text-text font-semibold">{counts.active}</span> active.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            label={refreshing ? "Refreshing…" : "Refresh accounts"}
            icon={<RefreshCw size={17} className={refreshing ? "animate-spin" : ""} />}
            onClick={handleRefresh}
            busy={refreshing}
            variant="surface"
            size="md"
          />
          <button
            type="button"
            onClick={() => {
              setAddError(null);
              setAddUsername("");
              setAddPassword("");
              setShowAddModal(true);
            }}
            className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer"
          >
            <Plus size={18} />
            {addLabel}
          </button>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => loadWorkers()} title="Could not load accounts" />
      ) : (
        <>
          {/* Search & filters */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              scope={noun + "s"}
              resultCount={visible.length}
              totalCount={counts.all}
              placeholder={isProcessor ? "Search processors…" : "Search users…"}
              className="lg:max-w-md"
            />
            <div
              className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1.5 self-start"
              role="group"
              aria-label="Filter by status"
            >
              {(["all", "active", "inactive"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={`px-4 py-2 rounded-lg text-[13px] font-bold transition-all cursor-pointer ${
                    filter === f
                      ? "bg-primary text-white"
                      : "text-text-muted hover:text-text hover:bg-surface-hover"
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}{" "}
                  <span className={filter === f ? "opacity-80" : "opacity-60"}>
                    ({counts[f]})
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <InlineRefreshBar show={refreshing} />

            {visible.length === 0 ? (
              <EmptyState
                icon={search.trim() || filter !== "all" ? <SearchX size={24} /> : icon}
                title={
                  search.trim() || filter !== "all"
                    ? `No ${noun}s match`
                    : `No ${noun} accounts yet`
                }
                description={
                  search.trim() || filter !== "all"
                    ? `Nothing here matches${
                        search.trim() ? ` “${search.trim()}”` : ""
                      }${filter !== "all" ? ` and is ${filter}` : ""}. There ${counts.all === 1 ? "is" : "are"} ${counts.all} ${noun}${counts.all === 1 ? "" : "s"} in total.`
                    : `Create a ${noun} account so they can sign in and submit work. ${
                        usernameRule
                      }.`
                }
                action={
                  search.trim() || filter !== "all" ? (
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
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowAddModal(true)}
                      className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                    >
                      {addLabel}
                    </button>
                  )
                }
              />
            ) : (
              <div className="overflow-x-auto scrollbar-thin table-scroll">
                <table className="w-full min-w-[42rem]">
                  <thead className="sticky-head">
                    <tr className="border-b border-border">
                      <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4">
                        User
                      </th>
                      <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4">
                        Status
                      </th>
                      <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4 hidden lg:table-cell">
                        Created
                      </th>
                      <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4 hidden lg:table-cell">
                        Last Login
                      </th>
                      <th className="sticky-actions sticky-head-cell text-right text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4 w-32">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visible.map((worker) => (
                      <tr
                        key={worker.id}
                        aria-busy={deletingId === worker.id}
                        className={`transition-colors hover:bg-surface-hover/50 ${
                          deletingId === worker.id ? "opacity-60" : ""
                        }`}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-4 min-w-0">
                            <div
                              className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${accentCls[accent].chip}`}
                            >
                              {worker.username.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-text truncate">{worker.username}</p>
                              <p className="text-[13px] text-text-muted mt-0.5 truncate">
                                {worker.full_name || "No name set"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 text-[13px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap ${
                              worker.is_active
                                ? "bg-success-muted text-success"
                                : "bg-danger-muted text-danger"
                            }`}
                          >
                            {worker.is_active ? <UserCheck size={14} /> : <UserX size={14} />}
                            {worker.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-6 py-4 hidden lg:table-cell whitespace-nowrap text-sm text-text-muted">
                          {formatDate(worker.created_at)}
                        </td>
                        <td className="px-6 py-4 hidden lg:table-cell whitespace-nowrap text-sm text-text-muted">
                          {formatLastLogin(worker.last_login_at)}
                        </td>
                        <td className="sticky-actions px-6 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              label={`Edit ${worker.username}`}
                              size="sm"
                              tooltipPlacement="top-end"
                              icon={<Pencil size={15} />}
                              onClick={() => openEdit(worker)}
                              disabled={deletingId === worker.id}
                            />
                            <IconButton
                              label={`Deactivate ${worker.username}`}
                              size="sm"
                              tooltipPlacement="top-end"
                              icon={<UserRoundX size={15} />}
                              onClick={() => {
                                openEdit(worker);
                                setEditIsActive(false);
                              }}
                              disabled={deletingId === worker.id}
                            />
                            <IconButton
                              label={`Permanently delete ${worker.username}`}
                              size="sm"
                              tooltipPlacement="top-end"
                              variant="danger"
                              icon={<Trash2 size={15} />}
                              onClick={() => handleDelete(worker)}
                              busy={deletingId === worker.id}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Add dialog ── */}
      <Modal
        open={showAddModal}
        onClose={() => !addLoading && setShowAddModal(false)}
        size="md"
        title={`Add ${capitalise(noun)}`}
        subtitle="The account can sign in immediately with this password."
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              disabled={addLoading}
              className="px-5 py-3 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={addLoading}
              className="px-6 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2.5"
            >
              {addLoading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <UserRoundPlus size={16} />
              )}
              {addLoading ? "Creating…" : "Create account"}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate();
          }}
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="add-username"
              className="block text-xs font-bold text-text-muted uppercase tracking-[0.1em] mb-2"
            >
              Username <span className="text-danger">*</span>
            </label>
            <input
              id="add-username"
              type="text"
              value={addUsername}
              onChange={(e) => {
                setAddUsername(e.target.value);
                setAddError(null);
              }}
              placeholder={isProcessor ? "e.g. john_processor" : "e.g. john_doe"}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={addError ? true : undefined}
              aria-describedby={addError ? "add-error" : "add-username-hint"}
              className={inputCls}
            />
            <p id="add-username-hint" className="text-xs text-text-muted mt-1.5">
              Lowercase letters, numbers, dots, underscores and hyphens.{" "}
              {isProcessor ? (
                <>
                  Must end with <code className="text-primary font-semibold">_processor</code>.
                </>
              ) : (
                <>
                  Must <strong className="text-warning">not</strong> end with{" "}
                  <code className="text-warning">_processor</code>.
                </>
              )}
            </p>
          </div>

          <div>
            <label
              htmlFor="add-password"
              className="block text-xs font-bold text-text-muted uppercase tracking-[0.1em] mb-2"
            >
              Password <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <input
                id="add-password"
                type={showAddPassword ? "text" : "password"}
                value={addPassword}
                onChange={(e) => {
                  setAddPassword(e.target.value);
                  setAddError(null);
                }}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                className={`${inputCls} pr-14`}
              />
              <button
                type="button"
                onClick={() => setShowAddPassword((s) => !s)}
                aria-label={showAddPassword ? "Hide password" : "Show password"}
                title={showAddPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors cursor-pointer p-1.5 rounded-md hover:bg-surface-hover"
              >
                {showAddPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {addError && (
            <p
              id="add-error"
              role="alert"
              className="px-4 py-3 rounded-xl text-sm bg-danger-muted border border-danger/20 text-danger"
            >
              {addError}
            </p>
          )}
        </form>
      </Modal>

      {/* ── Edit dialog ── */}
      <Modal
        open={showEditModal}
        onClose={() => !editLoading && setShowEditModal(false)}
        size="md"
        title={`Edit ${editingWorker?.username ?? capitalise(noun)}`}
        subtitle="Changing the username means the old sign-in name stops working."
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowEditModal(false)}
              disabled={editLoading}
              className="px-5 py-3 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleEditSave}
              disabled={editLoading}
              className="px-6 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2.5"
            >
              {editLoading && <Loader2 size={15} className="animate-spin" />}
              {editLoading ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleEditSave();
          }}
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="edit-fullname"
              className="block text-xs font-bold text-text-muted uppercase tracking-[0.1em] mb-2"
            >
              Full name
            </label>
            <input
              id="edit-fullname"
              type="text"
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              placeholder="e.g. John Doe"
              className={inputCls}
            />
          </div>

          <div>
            <label
              htmlFor="edit-username"
              className="block text-xs font-bold text-text-muted uppercase tracking-[0.1em] mb-2"
            >
              Username <span className="text-danger">*</span>
            </label>
            <input
              id="edit-username"
              type="text"
              value={editUsername}
              onChange={(e) => {
                setEditUsername(e.target.value);
                setEditError(null);
              }}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={editError ? true : undefined}
              aria-describedby={editError ? "edit-error" : "edit-username-hint"}
              className={inputCls}
            />
            <p id="edit-username-hint" className="text-xs text-text-muted mt-1.5">
              {usernameRule}.
            </p>
          </div>

          <fieldset>
            <legend className="block text-xs font-bold text-text-muted uppercase tracking-[0.1em] mb-2">
              Sign-in access
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEditIsActive(true)}
                aria-pressed={editIsActive}
                className={`py-3 rounded-xl text-sm font-bold transition-all cursor-pointer border flex items-center justify-center gap-2 ${
                  editIsActive
                    ? "bg-success-muted border-success/30 text-success"
                    : "bg-surface border-border text-text-muted hover:text-text hover:bg-surface-hover"
                }`}
              >
                <UserCheck size={15} /> Active
              </button>
              <button
                type="button"
                onClick={() => setEditIsActive(false)}
                aria-pressed={!editIsActive}
                className={`py-3 rounded-xl text-sm font-bold transition-all cursor-pointer border flex items-center justify-center gap-2 ${
                  !editIsActive
                    ? "bg-danger-muted border-danger/30 text-danger"
                    : "bg-surface border-border text-text-muted hover:text-text hover:bg-surface-hover"
                }`}
              >
                <UserX size={15} /> Inactive
              </button>
            </div>
            <p className="text-xs text-text-muted mt-2">
              {editIsActive
                ? "This account can sign in and submit work."
                : "This account cannot sign in, but its history is kept."}
            </p>
          </fieldset>

          {editError && (
            <p
              id="edit-error"
              role="alert"
              className="px-4 py-3 rounded-xl text-sm bg-danger-muted border border-danger/20 text-danger"
            >
              {editError}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
