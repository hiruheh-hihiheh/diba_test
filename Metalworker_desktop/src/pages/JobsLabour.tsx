// src/pages/JobsLabour.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Briefcase, Search, Loader2, RefreshCw, AlertTriangle, Edit3,
  Image as ImageIcon, Folder as FolderIcon, ChevronRight, Trash2,
  Edit2, Plus, FolderPlus, X
} from "lucide-react";
import {
  fetchJobsByType, fetchJobsByFolder, removeJobFromFolder,
  removeMultipleJobsFromFolder, deleteJob, fetchAvailableJobsForFolder,
  addJobToFolder, addMultipleJobsToFolder
} from "../services/jobs";
import { fetchFolders, createFolder, updateFolder, deleteFolder } from "../services/folders";
import type { Job } from "../types/job";
import type { AdminFolder } from "../types/folder";
import JobEditModal from "../components/jobs/JobEditModal";
import JobDrawingModal from "../components/jobs/JobDrawingModal";
import AdminModal from "../components/ui/AdminModal";
import { format, parseISO } from "date-fns";

const JOB_TYPE = "labour" as const;
const TYPE_LABEL = "Labour";

export default function JobsLabourPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<AdminFolder | null>(null);
  const [viewMode, setViewMode] = useState<"folders" | "all">("folders");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [drawingModalJob, setDrawingModalJob] = useState<Job | null>(null);

  // Folder Actions
  const [renamingFolder, setRenamingFolder] = useState<AdminFolder | null>(null);
  const [newName, setNewName] = useState("");
  const [deletingFolder, setDeletingFolder] = useState<AdminFolder | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Multi-select
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [removingMultiple, setRemovingMultiple] = useState(false);

  // Delete Job
  const [deletingJob, setDeletingJob] = useState<Job | null>(null);

  // Add Jobs panel
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [availableJobs, setAvailableJobs] = useState<Job[]>([]);
  const [availableSearch, setAvailableSearch] = useState("");
  const [selectedAvailableIds, setSelectedAvailableIds] = useState<Set<string>>(new Set());
  const [addingJobs, setAddingJobs] = useState(false);
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  // ─── Data Loading ───────────────────────────────────────

  const loadFolders = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchFolders();
      setFolders(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setError(null);
    setLoading(true);
    setSelectedJobIds(new Set());
    try {
      let list: Job[] = [];
      if (viewMode === "folders" && selectedFolder) {
        list = await fetchJobsByFolder(selectedFolder.id, JOB_TYPE);
      } else if (viewMode === "all") {
        list = await fetchJobsByType(JOB_TYPE);
      }
      setJobs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [viewMode, selectedFolder]);

  const loadAvailableJobs = useCallback(async () => {
    if (!selectedFolder) return;
    setLoadingAvailable(true);
    try {
      const list = await fetchAvailableJobsForFolder(selectedFolder.id, JOB_TYPE);
      setAvailableJobs(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAvailable(false);
    }
  }, [selectedFolder]);

  useEffect(() => {
    if (viewMode === "folders" && !selectedFolder) {
      loadFolders();
    } else {
      loadJobs();
    }
  }, [loadFolders, loadJobs, viewMode, selectedFolder]);

  useEffect(() => {
    if (showAddPanel && selectedFolder) {
      loadAvailableJobs();
    }
  }, [showAddPanel, selectedFolder, loadAvailableJobs]);

  async function handleRefresh() {
    setRefreshing(true);
    if (viewMode === "folders" && !selectedFolder) {
      await loadFolders();
    } else {
      await loadJobs();
      if (showAddPanel) await loadAvailableJobs();
    }
    setRefreshing(false);
  }

  // ─── Derived Data ───────────────────────────────────────

  const filteredFolders = useMemo(() => {
    const relevant = folders.filter(f => 
      f.folder_type === JOB_TYPE || 
      ((f.folder_type === "general" || f.folder_type == null) && (f.labourCount ?? 0) > 0)
    );
    if (!search.trim()) return relevant;
    const q = search.toLowerCase();
    return relevant.filter(f => f.name.toLowerCase().includes(q));
  }, [folders, search]);

  const groupedFolders = useMemo(() => {
    const groups: Record<string, AdminFolder[]> = {};
    for (const f of filteredFolders) {
      const monthYear = format(parseISO(f.created_at), "MMMM yyyy");
      if (!groups[monthYear]) groups[monthYear] = [];
      groups[monthYear].push(f);
    }
    return groups;
  }, [filteredFolders]);

  const filtered = useMemo(() => {
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter((j) =>
      (j.job_no ?? "").toLowerCase().includes(q) ||
      (j.po_status ?? "").toLowerCase().includes(q) ||
      (j.tool_description ?? "").toLowerCase().includes(q) ||
      (j.tool_part ?? "").toLowerCase().includes(q) ||
      (j.quantity?.toString() ?? "").toLowerCase().includes(q) ||
      (j.current_machining_status ?? "").toLowerCase().includes(q) ||
      (j.status ?? "").toLowerCase().includes(q) ||
      (j.drawing_status ?? "").toLowerCase().includes(q) ||
      (j.model_status ?? "").toLowerCase().includes(q) ||
      (j.expected_completion_note ?? "").toLowerCase().includes(q)
    );
  }, [jobs, search]);

  const filteredAvailable = useMemo(() => {
    if (!availableSearch.trim()) return availableJobs;
    const q = availableSearch.toLowerCase();
    return availableJobs.filter(j =>
      (j.job_no ?? "").toLowerCase().includes(q) ||
      (j.tool_description ?? "").toLowerCase().includes(q)
    );
  }, [availableJobs, availableSearch]);

  // ─── Folder Actions ─────────────────────────────────────

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    const { ok, data, error: err } = await createFolder(newFolderName.trim(), JOB_TYPE);
    if (ok && data) {
      setCreatingFolder(false);
      setNewFolderName("");
      await loadFolders();
      setSelectedFolder(data);
    } else {
      alert(`Failed to create folder: ${err}`);
    }
  }

  async function handleRenameFolder() {
    if (!renamingFolder || !newName.trim()) return;
    const { ok, error: err } = await updateFolder(renamingFolder.id, newName.trim());
    if (ok) {
      if (selectedFolder?.id === renamingFolder.id) {
        setSelectedFolder({ ...selectedFolder, name: newName.trim() });
      }
      setRenamingFolder(null);
      loadFolders();
    } else {
      alert(`Failed to rename: ${err}`);
    }
  }

  async function handleDeleteFolder() {
    if (!deletingFolder) return;
    const { ok, error: err } = await deleteFolder(deletingFolder.id);
    if (ok) {
      if (selectedFolder?.id === deletingFolder.id) {
        setSelectedFolder(null);
        setViewMode("folders");
      }
      setDeletingFolder(null);
      loadFolders();
    } else {
      alert(`Failed to delete: ${err}`);
    }
  }

  // ─── Job-Folder Actions ─────────────────────────────────

  async function handleRemoveJob(job: Job) {
    if (!selectedFolder) return;
    const { ok, error: err } = await removeJobFromFolder(selectedFolder.id, job.id);
    if (ok) {
      loadJobs();
      if (showAddPanel) loadAvailableJobs();
    } else {
      alert(`Failed to remove job: ${err}`);
    }
  }

  async function handleRemoveMultipleJobs() {
    if (!selectedFolder || selectedJobIds.size === 0) return;
    setRemovingMultiple(true);
    const { ok, error: err } = await removeMultipleJobsFromFolder(selectedFolder.id, Array.from(selectedJobIds));
    setRemovingMultiple(false);
    if (ok) {
      loadJobs();
      if (showAddPanel) loadAvailableJobs();
    } else {
      alert(`Failed to remove jobs: ${err}`);
    }
  }

  async function handleDeleteJob() {
    if (!deletingJob) return;
    const { ok, error: err } = await deleteJob(deletingJob.id);
    if (ok) {
      setDeletingJob(null);
      loadJobs();
      if (showAddPanel) loadAvailableJobs();
    } else {
      alert(`Failed to delete job: ${err}`);
    }
  }

  async function handleAddJob(jobId: string) {
    if (!selectedFolder) return;
    const { ok, error: err } = await addJobToFolder(selectedFolder.id, jobId);
    if (ok) {
      loadJobs();
      loadAvailableJobs();
    } else {
      alert(`Failed to add job: ${err}`);
    }
  }

  async function handleAddMultipleJobs() {
    if (!selectedFolder || selectedAvailableIds.size === 0) return;
    setAddingJobs(true);
    const { ok, error: err } = await addMultipleJobsToFolder(selectedFolder.id, Array.from(selectedAvailableIds));
    setAddingJobs(false);
    if (ok) {
      setSelectedAvailableIds(new Set());
      loadJobs();
      loadAvailableJobs();
    } else {
      alert(`Failed to add jobs: ${err}`);
    }
  }

  // ─── Selection Helpers ──────────────────────────────────

  const toggleSelectAll = () => {
    if (selectedJobIds.size === filtered.length) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(filtered.map(j => j.id)));
    }
  };

  const toggleSelectJob = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const s = new Set(selectedJobIds);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelectedJobIds(s);
  };

  const toggleAvailableJob = (id: string) => {
    const s = new Set(selectedAvailableIds);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelectedAvailableIds(s);
  };

  // ─── Render ─────────────────────────────────────────────

  if (loading && !refreshing) return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="text-primary animate-spin" /></div>;

  const inFolderView = viewMode === "folders" && !!selectedFolder;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-muted flex items-center justify-center">
            <Briefcase size={20} className="text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-text cursor-pointer hover:text-primary transition-colors" onClick={() => { setViewMode("folders"); setSelectedFolder(null); setShowAddPanel(false); }}>
                {TYPE_LABEL}
              </h1>
              {selectedFolder && (
                <>
                  <ChevronRight size={16} className="text-text-muted" />
                  <span className="text-lg font-semibold text-text">{selectedFolder.name}</span>
                </>
              )}
            </div>
            <p className="text-sm text-text-muted">
              {viewMode === "folders" && !selectedFolder
                ? `${filteredFolders.length} folder${filteredFolders.length !== 1 ? "s" : ""}`
                : `${filtered.length} ${TYPE_LABEL} job${filtered.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {inFolderView && selectedJobIds.size > 0 && (
            <button
              onClick={handleRemoveMultipleJobs}
              disabled={removingMultiple}
              className="px-4 py-2 bg-danger-muted text-danger text-sm font-bold rounded-lg border border-danger/20 hover:bg-danger/10 transition-colors cursor-pointer"
            >
              {removingMultiple ? "Removing..." : `Remove ${selectedJobIds.size} from Folder`}
            </button>
          )}

          {inFolderView && (
            <button
              onClick={() => { setShowAddPanel(!showAddPanel); setSelectedAvailableIds(new Set()); setAvailableSearch(""); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer ${showAddPanel ? "bg-primary text-white shadow-md shadow-primary/20" : "bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-hover"}`}
            >
              <Plus size={14} />
              Add Jobs
            </button>
          )}

          <div className="flex bg-surface border border-border rounded-xl p-1">
            <button
              onClick={() => { setViewMode("folders"); setSelectedFolder(null); setShowAddPanel(false); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${viewMode === "folders" && !selectedFolder ? "bg-primary text-white shadow-md shadow-primary/20" : "text-text-muted hover:text-text hover:bg-surface-hover"}`}
            >
              Folders
            </button>
            <button
              onClick={() => { setViewMode("all"); setSelectedFolder(null); setShowAddPanel(false); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${viewMode === "all" ? "bg-primary text-white shadow-md shadow-primary/20" : "text-text-muted hover:text-text hover:bg-surface-hover"}`}
            >
              All Jobs
            </button>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-danger-muted border border-danger/20 text-danger text-sm">
          {error}
        </div>
      )}

      {/* ─── Search ─── */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={viewMode === "folders" && !selectedFolder ? "Search folders..." : `Search ${TYPE_LABEL.toLowerCase()} jobs...`}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
        />
      </div>

      {/* ─── Folder Grid ─── */}
      {viewMode === "folders" && !selectedFolder ? (
        <div className="space-y-8">
          {/* New Folder button */}
          <button
            onClick={() => { setCreatingFolder(true); setNewFolderName(""); }}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-surface border-2 border-dashed border-border text-sm font-bold text-text-muted hover:border-primary hover:text-primary transition-all cursor-pointer"
          >
            <FolderPlus size={18} />
            New Folder
          </button>

          {Object.entries(groupedFolders).map(([month, monthFolders]) => (
            <div key={month} className="space-y-4">
              <h2 className="text-sm font-bold text-text-muted uppercase tracking-wider pl-2 border-l-2 border-primary">{month}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {monthFolders.map(folder => (
                  <div
                    key={folder.id}
                    onClick={() => setSelectedFolder(folder)}
                    className="bg-surface border border-border rounded-2xl p-5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all cursor-pointer group"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                        <FolderIcon size={20} className="fill-primary/20" />
                      </div>
                      <div className="flex opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => { setRenamingFolder(folder); setNewName(folder.name); }}
                          className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-surface-hover cursor-pointer"
                          title="Rename Folder"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setDeletingFolder(folder)}
                          className="p-1.5 text-text-muted hover:text-danger transition-colors rounded-lg hover:bg-surface-hover cursor-pointer"
                          title="Delete Folder"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <h3 className="font-bold text-text mb-1 truncate" title={folder.name}>{folder.name}</h3>
                    <p className="text-xs font-semibold text-primary mb-1">{folder.labourCount} {TYPE_LABEL} Jobs</p>
                    <p className="text-[10px] text-text-muted">Created {format(parseISO(folder.created_at), "MMM d, yyyy")}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {filteredFolders.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-3xl bg-surface/30">
              <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center text-text-muted mb-4 shadow-sm">
                <FolderIcon size={24} />
              </div>
              <h3 className="text-lg font-bold text-text mb-1">No folders yet</h3>
              <p className="text-sm text-text-muted">Create a folder or import Excel files to get started.</p>
            </div>
          )}
        </div>
      ) : (
        /* ─── Job Table + Optional Add Panel ─── */
        <div className={`flex gap-6 ${showAddPanel ? "" : ""}`}>
          {/* Jobs Table */}
          <div className={`${showAddPanel ? "flex-1 min-w-0" : "w-full"}`}>
            <div className="bg-surface border border-border rounded-xl overflow-hidden overflow-x-auto">
              <table className="w-full whitespace-nowrap">
                <thead>
                  <tr className="border-b border-border">
                    {inFolderView && (
                      <th className="px-5 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={filtered.length > 0 && selectedJobIds.size === filtered.length}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary accent-primary cursor-pointer"
                        />
                      </th>
                    )}
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Job No</th>
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Job Given Date</th>
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">PO Status</th>
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Tool / Part</th>
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Quantity</th>
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Expected Completion</th>
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Machining Status</th>
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Status</th>
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">DRG</th>
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Model</th>
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-5 py-12 text-center">
                        <AlertTriangle size={32} className="mx-auto text-text-muted/30 mb-2" />
                        <p className="text-sm text-text-muted">{search ? "No jobs match your search." : "No jobs found in this view."}</p>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((item) => (
                      <tr
                        key={item.id}
                        className={`hover:bg-surface-hover/50 transition-colors cursor-pointer group ${selectedJobIds.has(item.id) ? "bg-primary/5" : ""}`}
                        onClick={() => setEditingJob(item)}
                      >
                        {inFolderView && (
                          <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedJobIds.has(item.id)}
                              onChange={(e) => toggleSelectJob(item.id, e as unknown as React.MouseEvent)}
                              className="w-4 h-4 rounded border-border text-primary focus:ring-primary accent-primary cursor-pointer"
                            />
                          </td>
                        )}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-text group-hover:text-primary transition-colors">{item.job_no || "—"}</p>
                            <Edit3 size={14} className="text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </td>
                        <td className="px-5 py-4"><p className="text-sm text-text-muted">{item.job_given_date || "—"}</p></td>
                        <td className="px-5 py-4"><p className="text-sm text-text-muted">{item.po_status || "—"}</p></td>
                        <td className="px-5 py-4"><p className="text-sm text-text-muted">{item.tool_description || "—"}{item.tool_part ? ` / ${item.tool_part}` : ""}</p></td>
                        <td className="px-5 py-4"><p className="text-sm text-text-muted">{item.quantity != null ? item.quantity : "—"}</p></td>
                        <td className="px-5 py-4"><p className="text-sm text-text-muted">{item.expected_completion_date || item.expected_completion_note || "—"}</p></td>
                        <td className="px-5 py-4"><p className="text-sm text-text-muted">{item.current_machining_status || "—"}</p></td>
                        <td className="px-5 py-4">
                          <span className="px-2 py-1 bg-surface-hover rounded text-xs text-text">{item.status || "—"}</span>
                        </td>
                        <td className="px-5 py-4">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDrawingModalJob(item); }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border text-xs font-semibold text-text hover:border-primary hover:text-primary transition-colors cursor-pointer group/drg"
                          >
                            <ImageIcon size={14} className="text-text-muted group-hover/drg:text-primary transition-colors" />
                            {item.drawing_status || "—"}
                          </button>
                        </td>
                        <td className="px-5 py-4"><p className="text-sm text-text-muted">{item.model_status || "—"}</p></td>
                        <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {inFolderView && (
                              <button
                                onClick={() => handleRemoveJob(item)}
                                className="p-1.5 text-text-muted hover:text-warning bg-surface hover:bg-warning/10 border border-transparent hover:border-warning/20 rounded-lg transition-all cursor-pointer"
                                title="Remove from Folder"
                              >
                                <X size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => setDeletingJob(item)}
                              className="p-1.5 text-text-muted hover:text-danger bg-surface hover:bg-danger/10 border border-transparent hover:border-danger/20 rounded-lg transition-all cursor-pointer"
                              title="Delete Job"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Add Jobs Panel ─── */}
          {showAddPanel && selectedFolder && (
            <div className="w-80 flex-shrink-0 bg-surface border border-border rounded-xl p-4 space-y-4 self-start sticky top-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-text">Available {TYPE_LABEL} Jobs</h3>
                <button onClick={() => setShowAddPanel(false)} className="p-1 text-text-muted hover:text-text rounded cursor-pointer">
                  <X size={16} />
                </button>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={availableSearch}
                  onChange={(e) => setAvailableSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-bg border border-border text-xs text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary"
                />
              </div>
              {selectedAvailableIds.size > 0 && (
                <button
                  onClick={handleAddMultipleJobs}
                  disabled={addingJobs}
                  className="w-full px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                >
                  {addingJobs ? "Adding..." : `Add ${selectedAvailableIds.size} to Folder`}
                </button>
              )}
              <div className="max-h-96 overflow-y-auto space-y-1">
                {loadingAvailable ? (
                  <div className="flex justify-center py-8"><Loader2 size={20} className="text-primary animate-spin" /></div>
                ) : filteredAvailable.length === 0 ? (
                  <p className="text-xs text-text-muted text-center py-6">No available jobs</p>
                ) : (
                  filteredAvailable.map(j => (
                    <div key={j.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors group/avail">
                      <input
                        type="checkbox"
                        checked={selectedAvailableIds.has(j.id)}
                        onChange={() => toggleAvailableJob(j.id)}
                        className="w-3.5 h-3.5 rounded border-border text-primary accent-primary cursor-pointer flex-shrink-0"
                      />
                      <span className="text-xs text-text truncate flex-1" title={j.job_no ?? ""}>{j.job_no || "—"}</span>
                      <button
                        onClick={() => handleAddJob(j.id)}
                        className="px-2 py-0.5 text-[10px] font-bold rounded bg-primary/10 text-primary hover:bg-primary hover:text-white transition-colors opacity-0 group-hover/avail:opacity-100 cursor-pointer flex-shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Modals ─── */}

      <JobEditModal
        open={!!editingJob}
        onClose={() => setEditingJob(null)}
        job={editingJob}
        onSaved={() => { setEditingJob(null); loadJobs(); }}
      />

      <JobDrawingModal
        open={!!drawingModalJob}
        onClose={() => setDrawingModalJob(null)}
        job={drawingModalJob}
      />

      {/* Create Folder Modal */}
      <AdminModal open={creatingFolder} onClose={() => setCreatingFolder(false)}>
        <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col animate-scale-in relative z-10">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
            <FolderPlus size={24} />
          </div>
          <h2 className="text-xl font-bold text-text mb-4">New Folder</h2>
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name..."
            className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-text focus:outline-none focus:border-primary mb-6"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); }}
          />
          <div className="flex gap-3 justify-end">
            <button onClick={() => setCreatingFolder(false)} className="px-4 py-2 rounded-xl text-text font-semibold hover:bg-surface-hover cursor-pointer">Cancel</button>
            <button onClick={handleCreateFolder} className="px-4 py-2 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover shadow-lg shadow-primary/20 cursor-pointer">Create</button>
          </div>
        </div>
      </AdminModal>

      {/* Rename Folder Modal */}
      <AdminModal open={!!renamingFolder} onClose={() => setRenamingFolder(null)}>
        <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col animate-scale-in relative z-10">
          <h2 className="text-xl font-bold text-text mb-4">Rename Folder</h2>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-bg border border-border rounded-xl px-4 py-2 text-text focus:outline-none focus:border-primary mb-6"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleRenameFolder(); }}
          />
          <div className="flex gap-3 justify-end">
            <button onClick={() => setRenamingFolder(null)} className="px-4 py-2 rounded-xl text-text font-semibold hover:bg-surface-hover cursor-pointer">Cancel</button>
            <button onClick={handleRenameFolder} className="px-4 py-2 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover shadow-lg shadow-primary/20 cursor-pointer">Save</button>
          </div>
        </div>
      </AdminModal>

      {/* Delete Folder Modal */}
      <AdminModal open={!!deletingFolder} onClose={() => setDeletingFolder(null)}>
        <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col animate-scale-in relative z-10">
          <div className="w-12 h-12 rounded-full bg-danger/10 text-danger flex items-center justify-center mb-4">
            <Trash2 size={24} />
          </div>
          <h2 className="text-xl font-bold text-text mb-2">Delete &ldquo;{deletingFolder?.name}&rdquo;?</h2>
          <p className="text-sm text-text-muted mb-6">
            This will remove the folder and unlink its jobs.
            <strong className="block mt-2 text-text">The actual jobs will remain safely in the system (available in All Jobs).</strong>
          </p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDeletingFolder(null)} className="px-4 py-2 rounded-xl text-text font-semibold hover:bg-surface-hover cursor-pointer">Cancel</button>
            <button onClick={handleDeleteFolder} className="px-4 py-2 rounded-xl bg-danger text-white font-bold hover:bg-danger/90 shadow-lg shadow-danger/20 cursor-pointer">Delete Folder</button>
          </div>
        </div>
      </AdminModal>

      {/* Delete Job Modal */}
      <AdminModal open={!!deletingJob} onClose={() => setDeletingJob(null)}>
        <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col animate-scale-in relative z-10">
          <div className="w-12 h-12 rounded-full bg-danger/10 text-danger flex items-center justify-center mb-4">
            <AlertTriangle size={24} />
          </div>
          <h2 className="text-xl font-bold text-text mb-2">Delete Job {deletingJob?.job_no}?</h2>
          <p className="text-sm text-text-muted mb-6">
            This will <strong className="text-danger">permanently delete</strong> this job and remove it from any folders it belongs to.
            <strong className="block mt-2 text-text">This action cannot be undone.</strong>
          </p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDeletingJob(null)} className="px-4 py-2 rounded-xl text-text font-semibold hover:bg-surface-hover cursor-pointer">Cancel</button>
            <button onClick={handleDeleteJob} className="px-4 py-2 rounded-xl bg-danger text-white font-bold hover:bg-danger/90 shadow-lg shadow-danger/20 cursor-pointer">Delete Job</button>
          </div>
        </div>
      </AdminModal>
    </div>
  );
}
