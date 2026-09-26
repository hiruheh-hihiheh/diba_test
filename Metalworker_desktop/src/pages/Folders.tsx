import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen, Plus, Search, Edit3, Trash2, Loader2, RefreshCw, X,
  AlertTriangle, ChevronRight, Package, Building2, FileText, PenTool,
  Eye, CornerRightDown
} from "lucide-react";
import {
  fetchFolders, createFolder, updateFolder, deleteFolder,
  fetchAllItems, addFolderItem
} from "../services/folders";
import type { AdminFolder, FolderItemType } from "../types/folder";
import AdminModal from "../components/ui/AdminModal";

function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <AdminModal open={open} onClose={onClose}>
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in max-h-[calc(100vh-104px)] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-lg font-bold text-text">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"><X size={18} /></button>
        </div>
        <div className="p-6 flex-1 min-h-0 overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0 bg-surface rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </AdminModal>
  );
}

function getItemIcon(type: FolderItemType) {
  switch (type) {
    case "owner_stock": return <Package size={16} className="text-purple" />;
    case "company_stock": return <Building2 size={16} className="text-primary" />;
    case "bill_group": return <FileText size={16} className="text-warning" />;
    case "drawing_group": return <PenTool size={16} className="text-success" />;
    case "job": return <Package size={16} className="text-red-500" />;
  }
}

function getItemTypeLabel(type: FolderItemType) {
  switch (type) {
    case "owner_stock": return "Owner Stock";
    case "company_stock": return "Company Stock";
    case "bill_group": return "Bill Group";
    case "drawing_group": return "Drawing Group";
    case "job": return "Job";
  }
}

export default function FoldersPage() {
  const navigate = useNavigate();
  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [availableItems, setAvailableItems] = useState<{ type: FolderItemType; id: string; label: string }[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  
  // Available Items filters
  const [itemsSearch, setItemsSearch] = useState("");
  const [itemsFilter, setItemsFilter] = useState<"all" | FolderItemType>("all");

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingFolder, setEditingFolder] = useState<AdminFolder | null>(null);
  const [formName, setFormName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formMessage, setFormMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Drag and Drop State
  const [draggedItem, setDraggedItem] = useState<{ type: FolderItemType; id: string; label: string } | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [movingItem, setMovingItem] = useState(false);

  // Preview Modal State
  const [previewItem, setPreviewItem] = useState<{ type: FolderItemType; id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    try { 
      const [list, items] = await Promise.all([
        fetchFolders(),
        fetchAllItems()
      ]);
      setFolders(list);
      setAvailableItems(items);
    } catch (e) {
      console.error("Failed to load folders data", e);
    } finally { 
      setLoading(false); 
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  
  async function handleRefresh() { 
    setRefreshing(true); 
    await load(); 
    setRefreshing(false); 
  }

  const filteredFolders = useMemo(() => {
    if (!search.trim()) return folders;
    const q = search.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, search]);

  const filteredItems = useMemo(() => {
    return availableItems.filter((item) => {
      if (itemsFilter !== "all" && item.type !== itemsFilter) return false;
      if (itemsSearch.trim() && !item.label.toLowerCase().includes(itemsSearch.toLowerCase())) return false;
      return true;
    });
  }, [availableItems, itemsSearch, itemsFilter]);

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
      } else {
        const res = await createFolder(formName.trim(), "general");
        if (!res.ok) { setFormMessage({ type: "error", text: res.error || "Failed." }); return; }
      }
      await load();
      setShowFormModal(false);
    } catch (err) { 
      setFormMessage({ type: "error", text: err instanceof Error ? err.message : "Failed." }); 
    } finally { 
      setFormLoading(false); 
    }
  }

  async function handleDelete(folder: AdminFolder) {
    if (!window.confirm(`Delete folder "${folder.name}"? All items inside will be unlinked.`)) return;
    try { 
      const res = await deleteFolder(folder.id); 
      if (res.ok) await load(); 
      else window.alert(res.error || "Failed."); 
    }
    catch (err) { window.alert(err instanceof Error ? err.message : "Failed."); }
  }

  // --- HTML5 Drag and Drop Handlers ---
  function handleDragStart(e: React.DragEvent, item: { type: FolderItemType; id: string; label: string }) {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
  }

  function handleDragOver(e: React.DragEvent, folderId: string) {
    e.preventDefault(); // Necessary to allow dropping
    if (draggedItem) {
      setDragOverFolder(folderId);
    }
  }

  function handleDragLeave(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    if (dragOverFolder === folderId) {
      setDragOverFolder(null);
    }
  }

  async function handleDrop(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    setDragOverFolder(null);
    
    if (!draggedItem) return;

    setMovingItem(true);
    const result = await addFolderItem(folderId, draggedItem.type, draggedItem.id);
    if (result.ok) {
      await load(); // Reload to update folder counts
    } else {
      window.alert(result.error || "Failed to move item.");
    }
    setMovingItem(false);
    setDraggedItem(null);
  }

  if (loading) return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="text-primary animate-spin" /></div>;

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* ── HEADER ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary-muted flex items-center justify-center">
            <FolderOpen size={24} className="text-primary" />
          </div>
          <div>
            <h1 className="text-[22px] font-extrabold text-text">Folders</h1>
            <p className="text-[14px] text-text-muted mt-0.5">
              {filteredFolders.length} folder{filteredFolders.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleRefresh} disabled={refreshing || movingItem} 
            className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-surface border border-border text-[14px] text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
            <RefreshCw size={16} className={(refreshing || movingItem) ? "animate-spin" : ""} />
            {refreshing ? "Refreshing..." : movingItem ? "Moving..." : "Refresh"}
          </button>
          <button onClick={openAdd} 
            className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white text-[14px] font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer">
            <Plus size={18} /> New Folder
          </button>
        </div>
      </div>

      {/* ── FOLDERS GRID ──────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search folders..."
            className="w-full pl-12 pr-5 py-3 rounded-xl bg-surface border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredFolders.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-12 bg-surface/50 rounded-2xl border border-dashed border-border">
              <AlertTriangle size={32} className="text-text-muted/30 mb-3" />
              <p className="text-[15px] font-medium text-text-muted">{search ? "No folders match." : "No folders yet."}</p>
            </div>
          ) : filteredFolders.map((folder) => {
            const isDragTarget = dragOverFolder === folder.id;
            
            return (
              <div 
                key={folder.id} 
                onDragOver={(e) => handleDragOver(e, folder.id)}
                onDragLeave={(e) => handleDragLeave(e, folder.id)}
                onDrop={(e) => handleDrop(e, folder.id)}
                className={`
                  bg-surface border rounded-2xl p-6 transition-all group flex flex-col relative
                  ${isDragTarget ? "border-primary bg-primary-muted/20 scale-[1.02] shadow-xl shadow-primary/10" : "border-border hover:border-border-hover"}
                `}
              >
                {isDragTarget && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/60 backdrop-blur-sm rounded-2xl animate-fade-in pointer-events-none">
                    <div className="bg-primary text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-lg">
                      <CornerRightDown size={18} /> Drop Here
                    </div>
                  </div>
                )}
                
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-primary-muted flex items-center justify-center shrink-0">
                    <FolderOpen size={24} className="text-primary" />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); openEdit(folder); }}
                      className="p-2 rounded-xl text-text-muted hover:text-primary hover:bg-primary-muted transition-colors cursor-pointer"
                      title="Edit Folder"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(folder); }}
                      className="p-2 rounded-xl text-text-muted hover:text-danger hover:bg-danger-muted transition-colors cursor-pointer"
                      title="Delete Folder"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                
                <div className="flex-1">
                  <h3 className="text-[16px] font-bold text-text mb-1.5 truncate" title={folder.name}>{folder.name}</h3>
                  <p className="text-[13px] text-text-muted mb-4 font-medium flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-surface-hover text-text">
                      {folder.itemCount || 0} items
                    </span>
                    • {new Date(folder.created_at).toLocaleDateString()}
                  </p>
                </div>
                
                <button onClick={() => navigate(`/folders/${folder.id}`)}
                  className="w-full py-3 rounded-xl bg-surface-hover/50 hover:bg-primary hover:text-white text-[14px] font-bold text-text transition-colors cursor-pointer flex items-center justify-center gap-2">
                  Open Folder <ChevronRight size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-border/50 my-8" />

      {/* ── ALL ITEMS LIBRARY ─────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <div>
          <h2 className="text-[20px] font-bold text-text">Item Library</h2>
          <p className="text-[14px] text-text-muted mt-1">
            Drag and drop items into folders above to organize them.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
            <input type="text" value={itemsSearch} onChange={(e) => setItemsSearch(e.target.value)} placeholder="Search items..."
              className="w-full pl-12 pr-5 py-3 rounded-xl bg-surface border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
          </div>
          
          <div className="flex items-center gap-1.5 bg-surface border border-border rounded-xl p-1.5 overflow-x-auto">
            {(["all", "owner_stock", "company_stock", "bill_group", "drawing_group"] as const).map(type => (
              <button key={type} onClick={() => setItemsFilter(type)}
                className={`px-4 py-2 rounded-lg text-[13px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                  itemsFilter === type ? "bg-primary text-white" : "text-text-muted hover:text-text hover:bg-surface-hover"
                }`}
              >
                {type === "all" ? "All Items" : getItemTypeLabel(type)}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-border bg-surface-hover/30">
                <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4">Type</th>
                <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4">Identifier / Name</th>
                <th className="text-right text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center">
                    <AlertTriangle size={24} className="text-text-muted/30 mx-auto mb-2" />
                    <p className="text-[14px] text-text-muted">No items found.</p>
                  </td>
                </tr>
              ) : (
                filteredItems.map(item => (
                  <tr 
                    key={`${item.type}-${item.id}`} 
                    className="hover:bg-surface-hover/30 transition-colors group cursor-grab active:cursor-grabbing"
                    draggable
                    onDragStart={(e) => handleDragStart(e, item)}
                    onDragEnd={() => setDraggedItem(null)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-bg border border-border flex items-center justify-center shrink-0">
                          {getItemIcon(item.type)}
                        </div>
                        <span className="text-[13px] font-bold text-text-muted">
                          {getItemTypeLabel(item.type)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[15px] font-bold text-text">{item.label}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => setPreviewItem(item)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-border text-[13px] font-bold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <Eye size={16} /> Preview
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MODALS ───────────────────────────────────────────────────────────── */}
      <Modal 
        open={showFormModal} 
        onClose={() => setShowFormModal(false)} 
        title={editingFolder ? "Rename Folder" : "New Folder"}
        footer={
          <>
            <button onClick={() => setShowFormModal(false)} 
              className="px-5 py-3 rounded-xl text-[14px] font-bold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
              Cancel
            </button>
            <button onClick={handleSave} disabled={formLoading} 
              className="px-6 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white text-[14px] font-bold transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2.5">
              {formLoading ? <Loader2 size={16} className="animate-spin" /> : null}
              {editingFolder ? "Save Changes" : "Create Folder"}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <label className="block text-[12px] font-bold text-text-muted tracking-[0.1em] uppercase mb-2">Folder Name</label>
            <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Enter folder name" 
              className="w-full px-5 py-3.5 rounded-xl bg-bg border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" 
              autoFocus
            />
          </div>
          {formMessage && (
            <div className={`px-5 py-4 rounded-xl text-[14px] font-medium animate-scale-in flex items-center gap-3 ${
              formMessage.type === "error" ? "bg-danger-muted border border-danger/20 text-danger" : "bg-success-muted border border-success/20 text-success"
            }`}>
              {formMessage.type === "error" ? <AlertTriangle size={18} /> : null}
              {formMessage.text}
            </div>
          )}
          </div>
      </Modal>

      <Modal open={!!previewItem} onClose={() => setPreviewItem(null)} title="Item Preview">
        {previewItem && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 bg-bg border border-border p-5 rounded-2xl">
              <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center shrink-0">
                {getItemIcon(previewItem.type)}
              </div>
              <div>
                <p className="text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] mb-1">
                  {getItemTypeLabel(previewItem.type)}
                </p>
                <p className="text-[16px] font-bold text-text">{previewItem.label}</p>
              </div>
            </div>
            
            <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col items-center justify-center py-12">
              <Eye size={48} className="text-text-muted/30 mb-4" />
              <p className="text-[15px] font-medium text-text-muted text-center max-w-xs">
                To view full details for this item, open it directly from the respective management page.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
