// src/pages/Folders.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen, Plus, Search, Edit3, Trash2, Loader2, RefreshCw, X,
  AlertTriangle, ChevronRight,
} from "lucide-react";
import { fetchFolders, createFolder, updateFolder, deleteFolder } from "../services/folders";
import type { AdminFolder } from "../types/folder";

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold text-text">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

export default function FoldersPage() {
  const navigate = useNavigate();
  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingFolder, setEditingFolder] = useState<AdminFolder | null>(null);
  const [formName, setFormName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formMessage, setFormMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try { const list = await fetchFolders(); setFolders(list); } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  async function handleRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  const filtered = useMemo(() => {
    if (!search.trim()) return folders;
    const q = search.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, search]);

  function openAdd() { setEditingFolder(null); setFormName(""); setFormMessage(null); setShowFormModal(true); }
  function openEdit(folder: AdminFolder) { setEditingFolder(folder); setFormName(folder.name); setFormMessage(null); setShowFormModal(true); }

  async function handleSave() {
    setFormMessage(null);
    if (!formName.trim()) { setFormMessage({ type: "error", text: "Name is required." }); return; }
    setFormLoading(true);
    try {
      if (editingFolder) {
        const res = await updateFolder(editingFolder.id, formName.trim());
        if (!res.ok) { setFormMessage({ type: "error", text: res.error || "Failed." }); return; }
        setFormMessage({ type: "success", text: "Updated." });
      } else {
        const res = await createFolder(formName.trim());
        if (!res.ok) { setFormMessage({ type: "error", text: res.error || "Failed." }); return; }
        setFormMessage({ type: "success", text: "Created." });
      }
      await load();
      setTimeout(() => setShowFormModal(false), 800);
    } catch (err) { setFormMessage({ type: "error", text: err instanceof Error ? err.message : "Failed." }); }
    finally { setFormLoading(false); }
  }

  async function handleDelete(folder: AdminFolder) {
    if (!window.confirm(`Delete folder "${folder.name}"? All items inside will be unlinked.`)) return;
    try { const res = await deleteFolder(folder.id); if (res.ok) await load(); else window.alert(res.error || "Failed."); }
    catch (err) { window.alert(err instanceof Error ? err.message : "Failed."); }
  }

  if (loading) return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="text-primary animate-spin" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-muted flex items-center justify-center"><FolderOpen size={20} className="text-primary" /></div>
          <div><h1 className="text-xl font-bold text-text">Folders</h1><p className="text-sm text-text-muted">{filtered.length} folder{filtered.length !== 1 ? "s" : ""}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /></button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all shadow-lg shadow-primary/20 cursor-pointer"><Plus size={16} />New Folder</button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search folders..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-16">
            <AlertTriangle size={32} className="text-text-muted/30 mb-2" />
            <p className="text-sm text-text-muted">{search ? "No folders match." : "No folders yet."}</p>
          </div>
        ) : filtered.map((folder) => (
          <div key={folder.id} className="bg-surface border border-border rounded-xl p-5 hover:border-border-hover transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-primary-muted flex items-center justify-center">
                <FolderOpen size={20} className="text-primary" />
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); openEdit(folder); }}
                  className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary-muted transition-all cursor-pointer"><Edit3 size={14} /></button>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(folder); }}
                  className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger-muted transition-all cursor-pointer"><Trash2 size={14} /></button>
              </div>
            </div>
            <h3 className="text-sm font-bold text-text mb-1 truncate">{folder.name}</h3>
            <p className="text-xs text-text-muted mb-3">Created {new Date(folder.created_at).toLocaleDateString()}</p>
            <button onClick={() => navigate(`/folders/${folder.id}`)}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover transition-colors cursor-pointer">
              Open Folder <ChevronRight size={12} />
            </button>
          </div>
        ))}
      </div>

      <Modal open={showFormModal} onClose={() => setShowFormModal(false)} title={editingFolder ? "Rename Folder" : "New Folder"}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Folder Name</label>
            <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Enter folder name" className={inputCls} /></div>
          {formMessage && <div className={`px-4 py-3 rounded-xl text-sm animate-scale-in ${formMessage.type === "error" ? "bg-danger-muted border border-danger/20 text-danger" : "bg-success-muted border border-success/20 text-success"}`}>{formMessage.text}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowFormModal(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer">Cancel</button>
            <button onClick={handleSave} disabled={formLoading} className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2">
              {formLoading && <Loader2 size={14} className="animate-spin" />}{editingFolder ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
