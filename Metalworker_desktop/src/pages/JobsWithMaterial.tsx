// src/pages/JobsWithMaterial.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, Search, Loader2, RefreshCw, AlertTriangle, Edit3, Image as ImageIcon, Folder as FolderIcon, ChevronRight, Trash2, Edit2 } from "lucide-react";
import { fetchJobsByType, fetchJobsByFolder, removeJobFromFolder, removeMultipleJobsFromFolder } from "../services/jobs";
import { fetchFolders, updateFolder, deleteFolder } from "../services/folders";
import type { Job } from "../types/job";
import type { AdminFolder } from "../types/folder";
import JobEditModal from "../components/jobs/JobEditModal";
import JobDrawingModal from "../components/jobs/JobDrawingModal";
import AdminModal from "../components/ui/AdminModal";
import { format, parseISO } from "date-fns";

export default function JobsWithMaterialPage() {
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

  // Multi-select
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [removingMultiple, setRemovingMultiple] = useState(false);

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
    setSelectedJobIds(new Set()); // Reset selection when loading jobs
    try {
      let list: Job[] = [];
      if (viewMode === "folders" && selectedFolder) {
        list = await fetchJobsByFolder(selectedFolder.id, "with_material");
      } else if (viewMode === "all") {
        list = await fetchJobsByType("with_material");
      }
      setJobs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [viewMode, selectedFolder]);

  useEffect(() => { 
    if (viewMode === "folders" && !selectedFolder) {
      loadFolders();
    } else {
      loadJobs();
    }
  }, [loadFolders, loadJobs, viewMode, selectedFolder]);

  async function handleRefresh() {
    setRefreshing(true);
    if (viewMode === "folders" && !selectedFolder) {
      await loadFolders();
    } else {
      await loadJobs();
    }
    setRefreshing(false);
  }

  const groupedFolders = useMemo(() => {
    const groups: Record<string, AdminFolder[]> = {};
    for (const f of folders) {
      if (!f.withMaterialCount || f.withMaterialCount === 0) continue;
      const monthYear = format(parseISO(f.created_at), "MMMM yyyy");
      if (!groups[monthYear]) groups[monthYear] = [];
      groups[monthYear].push(f);
    }
    return groups;
  }, [folders]);

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

  async function handleRemoveJob(job: Job) {
    if (!selectedFolder) return;
    const { ok, error: err } = await removeJobFromFolder(selectedFolder.id, job.id);
    if (ok) {
      loadJobs();
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
    } else {
      alert(`Failed to remove jobs: ${err}`);
    }
  }

  const toggleSelectAll = () => {
    if (selectedJobIds.size === filtered.length) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(filtered.map(j => j.id)));
    }
  };

  const toggleSelectJob = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSet = new Set(selectedJobIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedJobIds(newSet);
  };

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

  if (loading) return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="text-primary animate-spin" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-muted flex items-center justify-center">
            <Briefcase size={20} className="text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-text cursor-pointer hover:text-primary transition-colors" onClick={() => { setViewMode("folders"); setSelectedFolder(null); }}>
                With Material (BO)
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
                ? `${folders.length} folder${folders.length !== 1 ? "s" : ""}` 
                : `${filtered.length} record${filtered.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {viewMode === "folders" && selectedFolder && selectedJobIds.size > 0 && (
            <button
              onClick={handleRemoveMultipleJobs}
              disabled={removingMultiple}
              className="px-4 py-2 bg-danger-muted text-danger text-sm font-bold rounded-lg border border-danger/20 hover:bg-danger/10 transition-colors"
            >
              {removingMultiple ? "Removing..." : `Remove ${selectedJobIds.size} from Folder`}
            </button>
          )}

          <div className="flex bg-surface border border-border rounded-xl p-1">
            <button
              onClick={() => { setViewMode("folders"); setSelectedFolder(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${viewMode === "folders" ? "bg-primary text-white shadow-md shadow-primary/20" : "text-text-muted hover:text-text hover:bg-surface-hover"}`}
            >
              Folders
            </button>
            <button
              onClick={() => { setViewMode("all"); setSelectedFolder(null); }}
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

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
        />
      </div>

      {viewMode === "folders" && !selectedFolder ? (
        <div className="space-y-8">
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
                          className="p-1.5 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-surface-hover"
                          title="Rename Folder"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => setDeletingFolder(folder)}
                          className="p-1.5 text-text-muted hover:text-danger transition-colors rounded-lg hover:bg-surface-hover"
                          title="Delete Folder"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <h3 className="font-bold text-text mb-1 truncate" title={folder.name}>{folder.name}</h3>
                    <p className="text-xs font-semibold text-primary mb-1">{folder.withMaterialCount} With Material Jobs</p>
                    <p className="text-[10px] text-text-muted">Imported {format(parseISO(folder.created_at), "MMM d, yyyy")}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {folders.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-3xl bg-surface/30">
              <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center text-text-muted mb-4 shadow-sm">
                <FolderIcon size={24} />
              </div>
              <h3 className="text-lg font-bold text-text mb-1">No folders yet</h3>
              <p className="text-sm text-text-muted">Import Excel files to create folders.</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="bg-surface border border-border rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full whitespace-nowrap">
              <thead>
                <tr className="border-b border-border">
                  {viewMode === "folders" && selectedFolder && (
                    <th className="px-5 py-3 w-10">
                      <input 
                        type="checkbox" 
                        checked={filtered.length > 0 && selectedJobIds.size === filtered.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary accent-primary"
                      />
                    </th>
                  )}
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Job No</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Job Given Date</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">PO Status</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Tool / Part</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Quantity</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Expected Completion</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Current Machining Status</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">DRG Status</th>
                  <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Model Status</th>
                  {viewMode === "folders" && selectedFolder && (
                    <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3 w-20">Actions</th>
                  )}
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
                      {viewMode === "folders" && selectedFolder && (
                        <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                          <input 
                            type="checkbox"
                            checked={selectedJobIds.has(item.id)}
                            onChange={(e) => toggleSelectJob(item.id, e as any)}
                            className="w-4 h-4 rounded border-border text-primary focus:ring-primary accent-primary"
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
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawingModalJob(item);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border text-xs font-semibold text-text hover:border-primary hover:text-primary transition-colors cursor-pointer group/drg"
                        >
                          <ImageIcon size={14} className="text-text-muted group-hover/drg:text-primary transition-colors" />
                          {item.drawing_status || "—"}
                        </button>
                      </td>
                      <td className="px-5 py-4"><p className="text-sm text-text-muted">{item.model_status || "—"}</p></td>
                      {viewMode === "folders" && selectedFolder && (
                        <td className="px-5 py-4 text-center">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Remove this job from the folder?")) {
                                handleRemoveJob(item);
                              }
                            }}
                            className="p-1.5 text-text-muted hover:text-danger bg-surface hover:bg-danger/10 border border-transparent hover:border-danger/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            title="Remove from Folder"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <JobEditModal 
        open={!!editingJob} 
        onClose={() => setEditingJob(null)} 
        job={editingJob} 
        onSaved={() => {
          setEditingJob(null);
          loadJobs();
        }} 
      />

      <JobDrawingModal 
        open={!!drawingModalJob}
        onClose={() => setDrawingModalJob(null)}
        job={drawingModalJob}
      />

      {/* Rename Modal */}
      <AdminModal open={!!renamingFolder} onClose={() => setRenamingFolder(null)}>
        <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col animate-scale-in">
          <h2 className="text-xl font-bold text-text mb-4">Rename Folder</h2>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-bg border border-border rounded-xl px-4 py-2 text-text focus:outline-none focus:border-primary mb-6"
            autoFocus
          />
          <div className="flex gap-3 justify-end">
            <button onClick={() => setRenamingFolder(null)} className="px-4 py-2 rounded-xl text-text font-semibold hover:bg-surface-hover">Cancel</button>
            <button onClick={handleRenameFolder} className="px-4 py-2 rounded-xl bg-primary text-white font-bold hover:bg-primary-hover shadow-lg shadow-primary/20">Save</button>
          </div>
        </div>
      </AdminModal>

      {/* Delete Folder Modal */}
      <AdminModal open={!!deletingFolder} onClose={() => setDeletingFolder(null)}>
        <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col animate-scale-in">
          <div className="w-12 h-12 rounded-full bg-danger/10 text-danger flex items-center justify-center mb-4">
            <Trash2 size={24} />
          </div>
          <h2 className="text-xl font-bold text-text mb-2">Delete "{deletingFolder?.name}"?</h2>
          <p className="text-sm text-text-muted mb-6">
            This will remove the folder and unlink its jobs. 
            <strong className="block mt-2 text-text">The actual jobs will remain safely in the system (available in All Jobs).</strong>
          </p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDeletingFolder(null)} className="px-4 py-2 rounded-xl text-text font-semibold hover:bg-surface-hover">Cancel</button>
            <button onClick={handleDeleteFolder} className="px-4 py-2 rounded-xl bg-danger text-white font-bold hover:bg-danger/90 shadow-lg shadow-danger/20">Delete Folder</button>
          </div>
        </div>
      </AdminModal>
    </div>
  );
}
