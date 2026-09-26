import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, FolderOpen, Loader2, RefreshCw, Eye, Search,
  AlertTriangle, Trash2, Plus, GripVertical, CheckSquare, Square,
  Package, Building2, FileText, PenTool
} from "lucide-react";
import {
  fetchFolder, fetchFolderItems, resolveFolderItemLabels,
  fetchAvailableItems, addFolderItem, removeFolderItem,
  addMultipleItemsToFolder, removeMultipleItemsFromFolder,
  reorderFolderItems
} from "../services/folders";
import type { AdminFolder, FolderItemDisplay, FolderItemType } from "../types/folder";
import AdminModal from "../components/ui/AdminModal";

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

function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <AdminModal open={open} onClose={onClose}>
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in flex flex-col max-h-[calc(100vh-104px)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-[16px] font-bold text-text">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"><X size={18} /></button>
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

// Icon component since X was missing from import but used in Modal
import { X } from "lucide-react";

export default function FolderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [folder, setFolder] = useState<AdminFolder | null>(null);
  const [folderItems, setFolderItems] = useState<FolderItemDisplay[]>([]);
  const [availableItems, setAvailableItems] = useState<{ type: FolderItemType; id: string; label: string }[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Available Items filtering
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | FolderItemType>("all");

  // Selection Mode state
  const [selectionMode, setSelectionMode] = useState<boolean>(false);
  const [selectedFolderItems, setSelectedFolderItems] = useState<Set<string>>(new Set());
  const [selectedAvailableItems, setSelectedAvailableItems] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Drag and Drop (Reorder)
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);

  // Preview Modal
  const [previewItem, setPreviewItem] = useState<{ type: FolderItemType; id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [fData, fItemsData, aItemsData] = await Promise.all([
        fetchFolder(id),
        fetchFolderItems(id),
        fetchAvailableItems(id)
      ]);
      setFolder(fData);
      
      const resolvedItems = await resolveFolderItemLabels(fItemsData);
      setFolderItems(resolvedItems);
      setAvailableItems(aItemsData);
    } catch (e) {
      console.error(e);
      alert("Failed to load folder details.");
      navigate("/folders");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const filteredAvailable = useMemo(() => {
    return availableItems.filter((item) => {
      if (filter !== "all" && item.type !== filter) return false;
      if (search.trim() && !item.label.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [availableItems, search, filter]);

  // --- HTML5 Drag and Drop for Reordering ---
  function handleDragStart(e: React.DragEvent, index: number) {
    if (selectionMode) {
      e.preventDefault();
      return;
    }
    setDraggedItemIndex(index);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedItemIndex === null || draggedItemIndex === index || selectionMode) return;
    
    // Optimistic UI reorder
    const newItems = [...folderItems];
    const draggedItem = newItems[draggedItemIndex];
    newItems.splice(draggedItemIndex, 1);
    newItems.splice(index, 0, draggedItem);
    
    setDraggedItemIndex(index);
    setFolderItems(newItems);
  }

  async function handleDragEnd(e: React.DragEvent) {
    e.preventDefault();
    if (draggedItemIndex === null || selectionMode) return;
    setDraggedItemIndex(null);

    // Save new positions
    const updates = folderItems.map((item, index) => ({
      id: item.id,
      position: index
    }));
    
    const res = await reorderFolderItems(updates);
    if (!res.ok) {
      alert("Failed to save new order.");
      await load();
    }
  }

  // --- Single Item Actions ---
  async function handleAddSingle(item: { type: FolderItemType; id: string; label: string }) {
    if (!id) return;
    const res = await addFolderItem(id, item.type, item.id);
    if (res.ok) await load();
    else alert(res.error || "Failed to add item.");
  }

  async function handleRemoveSingle(folderItemId: string) {
    const res = await removeFolderItem(folderItemId);
    if (res.ok) await load();
    else alert(res.error || "Failed to remove item.");
  }

  // --- Bulk Selection Handlers ---
  function toggleSelectionMode() {
    setSelectionMode(!selectionMode);
    setSelectedFolderItems(new Set());
    setSelectedAvailableItems(new Set());
  }

  function handleToggleFolderItem(folderItemId: string) {
    const newSet = new Set(selectedFolderItems);
    if (newSet.has(folderItemId)) newSet.delete(folderItemId);
    else newSet.add(folderItemId);
    setSelectedFolderItems(newSet);
    setSelectedAvailableItems(new Set()); // Exclusive selection
  }

  function handleToggleAvailableItem(itemId: string) {
    const newSet = new Set(selectedAvailableItems);
    if (newSet.has(itemId)) newSet.delete(itemId);
    else newSet.add(itemId);
    setSelectedAvailableItems(newSet);
    setSelectedFolderItems(new Set()); // Exclusive selection
  }

  async function handleBulkRemove() {
    if (selectedFolderItems.size === 0) return;
    setBulkActionLoading(true);
    const res = await removeMultipleItemsFromFolder(Array.from(selectedFolderItems));
    if (res.ok) {
      setSelectedFolderItems(new Set());
      await load();
    } else {
      alert(res.error || "Failed to remove items.");
    }
    setBulkActionLoading(false);
  }

  async function handleBulkAdd() {
    if (selectedAvailableItems.size === 0 || !id) return;
    setBulkActionLoading(true);
    
    const itemsToAdd = availableItems
      .filter(i => selectedAvailableItems.has(i.id))
      .map(i => ({ type: i.type, id: i.id }));
      
    const res = await addMultipleItemsToFolder(id, itemsToAdd);
    if (res.ok) {
      setSelectedAvailableItems(new Set());
      await load();
    } else {
      alert(res.error || "Failed to add items.");
    }
    setBulkActionLoading(false);
  }

  if (loading || !folder) return <div className="flex justify-center py-32"><Loader2 size={32} className="animate-spin text-primary" /></div>;

  const hasFolderSelection = selectedFolderItems.size > 0;
  const hasAvailableSelection = selectedAvailableItems.size > 0;

  return (
    <div className="space-y-8 animate-fade-in pb-24">
      {/* ── HEADER ───────────────────────────────────────── */}
      <div>
        <button onClick={() => navigate("/folders")} className="flex items-center gap-2.5 text-[14px] font-bold text-text-muted hover:text-text transition-colors mb-6 cursor-pointer">
          <ArrowLeft size={18} /> Back to Folders
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary-muted flex items-center justify-center shrink-0">
              <FolderOpen size={24} className="text-primary" />
            </div>
            <div>
              <h1 className="text-[22px] font-extrabold text-text truncate">{folder.name}</h1>
              <p className="text-[14px] text-text-muted mt-0.5">{folderItems.length} items inside</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-surface border border-border text-[14px] font-bold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={toggleSelectionMode} className={`flex items-center gap-2.5 px-5 py-3 rounded-xl border text-[14px] font-bold transition-all cursor-pointer ${
              selectionMode ? "bg-primary text-white border-primary" : "bg-surface border-border text-text hover:bg-surface-hover"
            }`}>
              {selectionMode ? <CheckSquare size={18} /> : <Square size={18} />}
              {selectionMode ? "Done" : "Select Multiple"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── LEFT COLUMN: ITEMS IN FOLDER ───────────────── */}
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-bold text-text">Items inside Folder</h2>
            {selectionMode && (
              <button 
                onClick={() => setSelectedFolderItems(selectedFolderItems.size === folderItems.length ? new Set() : new Set(folderItems.map(i => i.id)))}
                className="text-[13px] font-bold text-primary hover:underline cursor-pointer"
              >
                {selectedFolderItems.size === folderItems.length ? "Deselect All" : "Select All"}
              </button>
            )}
          </div>

          <div className="bg-surface border border-border rounded-2xl overflow-hidden min-h-[300px]">
            {folderItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <FolderOpen size={40} className="text-text-muted/30 mb-3" />
                <p className="text-[14px] text-text-muted font-medium">This folder is empty.</p>
                <p className="text-[13px] text-text-muted mt-1">Add items from the right panel.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {folderItems.map((item, index) => {
                  const isSelected = selectedFolderItems.has(item.id);
                  return (
                    <div 
                      key={item.id}
                      draggable={!selectionMode}
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnd={handleDragEnd}
                      onClick={() => selectionMode && handleToggleFolderItem(item.id)}
                      className={`
                        flex items-center gap-4 p-4 transition-colors
                        ${selectionMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}
                        ${isSelected ? "bg-primary-muted/10" : "hover:bg-surface-hover/30"}
                      `}
                    >
                      {selectionMode && (
                        <div className="shrink-0 text-text-muted">
                          {isSelected ? <CheckSquare size={20} className="text-primary" /> : <Square size={20} />}
                        </div>
                      )}
                      {!selectionMode && (
                        <div className="shrink-0 text-border cursor-grab active:cursor-grabbing">
                          <GripVertical size={18} />
                        </div>
                      )}
                      
                      <div className="w-10 h-10 rounded-xl bg-bg border border-border flex items-center justify-center shrink-0">
                        {getItemIcon(item.item_type)}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold text-text truncate">{item.label}</p>
                        <p className="text-[12px] text-text-muted font-medium mt-0.5">{getItemTypeLabel(item.item_type)}</p>
                      </div>

                      {!selectionMode && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => setPreviewItem({ type: item.item_type, id: item.item_id, label: item.label })}
                            className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-bg transition-colors cursor-pointer" title="Preview">
                            <Eye size={16} />
                          </button>
                          <button onClick={() => handleRemoveSingle(item.id)}
                            className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger-muted transition-colors cursor-pointer" title="Remove">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN: AVAILABLE ITEMS ──────────────── */}
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-bold text-text">Available Items</h2>
            {selectionMode && (
              <button 
                onClick={() => setSelectedAvailableItems(selectedAvailableItems.size === filteredAvailable.length ? new Set() : new Set(filteredAvailable.map(i => i.id)))}
                className="text-[13px] font-bold text-primary hover:underline cursor-pointer"
              >
                {selectedAvailableItems.size === filteredAvailable.length ? "Deselect All" : "Select All"}
              </button>
            )}
          </div>

          <div className="bg-surface border border-border rounded-2xl flex flex-col h-[600px] overflow-hidden">
            <div className="p-4 border-b border-border space-y-3 shrink-0 bg-surface">
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search available items..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-bg border border-border text-[14px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {(["all", "owner_stock", "company_stock", "bill_group", "drawing_group"] as const).map(t => (
                  <button key={t} onClick={() => setFilter(t)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                      filter === t ? "bg-primary text-white" : "bg-bg text-text-muted hover:text-text hover:bg-surface-hover border border-border"
                    }`}>
                    {t === "all" ? "All" : getItemTypeLabel(t)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {filteredAvailable.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <AlertTriangle size={32} className="text-text-muted/30 mb-2" />
                  <p className="text-[14px] text-text-muted">No items found.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredAvailable.map(item => {
                    const isSelected = selectedAvailableItems.has(item.id);
                    return (
                      <div 
                        key={item.id}
                        onClick={() => selectionMode && handleToggleAvailableItem(item.id)}
                        className={`
                          flex items-center gap-3 p-3 rounded-xl transition-colors group
                          ${selectionMode ? "cursor-pointer" : ""}
                          ${isSelected ? "bg-primary-muted/20 border border-primary/30" : "hover:bg-surface-hover/50 border border-transparent"}
                        `}
                      >
                        {selectionMode && (
                          <div className="shrink-0 text-text-muted">
                            {isSelected ? <CheckSquare size={18} className="text-primary" /> : <Square size={18} />}
                          </div>
                        )}
                        <div className="w-9 h-9 rounded-lg bg-bg border border-border flex items-center justify-center shrink-0">
                          {getItemIcon(item.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-text truncate">{item.label}</p>
                          <p className="text-[11px] text-text-muted font-medium mt-0.5">{getItemTypeLabel(item.type)}</p>
                        </div>
                        {!selectionMode && (
                          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setPreviewItem(item)}
                              className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-bg transition-colors cursor-pointer" title="Preview">
                              <Eye size={14} />
                            </button>
                            <button onClick={() => handleAddSingle(item)}
                              className="p-1.5 rounded-lg text-primary hover:bg-primary-muted transition-colors cursor-pointer" title="Add to Folder">
                              <Plus size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── BULK ACTION BAR ──────────────────────────────── */}
      {(hasFolderSelection || hasAvailableSelection) && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-surface border border-border shadow-2xl rounded-2xl p-4 flex items-center gap-6 animate-slide-in-left z-40 max-w-[90vw]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-bold">
              {hasFolderSelection ? selectedFolderItems.size : selectedAvailableItems.size}
            </div>
            <span className="text-[15px] font-bold text-text">Items Selected</span>
          </div>
          
          <div className="h-8 w-px bg-border" />
          
          <div className="flex items-center gap-3">
            <button onClick={() => { setSelectedFolderItems(new Set()); setSelectedAvailableItems(new Set()); }}
              className="px-4 py-2 rounded-xl text-[14px] font-bold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
              Cancel
            </button>
            
            {hasFolderSelection && (
              <button onClick={handleBulkRemove} disabled={bulkActionLoading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-danger-muted hover:bg-danger text-danger hover:text-white text-[14px] font-bold transition-colors cursor-pointer disabled:opacity-50">
                {bulkActionLoading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Remove from Folder
              </button>
            )}
            
            {hasAvailableSelection && (
              <button onClick={handleBulkAdd} disabled={bulkActionLoading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-[14px] font-bold transition-colors cursor-pointer disabled:opacity-50">
                {bulkActionLoading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Add to Folder
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── PREVIEW MODAL ────────────────────────────────── */}
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
