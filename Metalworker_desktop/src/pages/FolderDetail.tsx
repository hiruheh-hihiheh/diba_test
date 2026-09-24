// src/pages/FolderDetail.tsx

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, FolderOpen, Plus, Trash2, Loader2, AlertTriangle,
  RefreshCw, Package, Building2, FileText, PenTool,
} from "lucide-react";
import {
  fetchFolder, fetchFolderItems, resolveFolderItemLabels, removeFolderItem,
} from "../services/folders";
import type { AdminFolder, FolderItemDisplay, FolderItemType } from "../types/folder";

const TYPE_ICONS: Record<FolderItemType, React.ReactNode> = {
  owner_stock: <Package size={16} className="text-primary" />,
  company_stock: <Building2 size={16} className="text-purple" />,
  bill_group: <FileText size={16} className="text-warning" />,
  drawing_group: <PenTool size={16} className="text-success" />,
};

const TYPE_LABELS: Record<FolderItemType, string> = {
  owner_stock: "Owner Stock",
  company_stock: "Company Stock",
  bill_group: "Bill Group",
  drawing_group: "Drawing Group",
};

const TYPE_COLORS: Record<FolderItemType, string> = {
  owner_stock: "bg-primary-muted",
  company_stock: "bg-purple-muted",
  bill_group: "bg-warning-muted",
  drawing_group: "bg-success-muted",
};

export default function FolderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [folder, setFolder] = useState<AdminFolder | null>(null);
  const [items, setItems] = useState<FolderItemDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const [folderData, rawItems] = await Promise.all([
        fetchFolder(id),
        fetchFolderItems(id),
      ]);
      setFolder(folderData);
      const resolved = await resolveFolderItemLabels(rawItems);
      setItems(resolved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load folder");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function handleRemoveItem(itemId: string) {
    if (!window.confirm("Remove this item from the folder?")) return;
    try {
      const res = await removeFolderItem(itemId);
      if (res.ok) setItems((prev) => prev.filter((i) => i.id !== itemId));
      else window.alert(res.error || "Failed.");
    } catch (err) { window.alert(err instanceof Error ? err.message : "Failed."); }
  }

  if (loading) return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="text-primary animate-spin" /></div>;

  if (error || !folder) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <AlertTriangle size={40} className="text-danger mb-3" />
        <p className="text-sm text-text-muted mb-4">{error || "Folder not found"}</p>
        <button onClick={() => navigate("/folders")} className="px-4 py-2 rounded-lg bg-surface border border-border text-sm text-text-muted cursor-pointer">Back to Folders</button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={() => navigate("/folders")}
        className="flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors cursor-pointer">
        <ArrowLeft size={16} /> Back to Folders
      </button>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-muted flex items-center justify-center"><FolderOpen size={20} className="text-primary" /></div>
          <div>
            <h1 className="text-xl font-bold text-text">{folder.name}</h1>
            <p className="text-sm text-text-muted">{items.length} item{items.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <button onClick={handleRefresh} disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer">
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Folder Items */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <FolderOpen size={40} className="text-text-muted/20 mb-3" />
            <p className="text-sm font-medium text-text-muted">This folder is empty</p>
            <p className="text-xs text-text-muted mt-1">Items can be added from their respective pages.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-4 px-5 py-4 hover:bg-surface-hover/50 transition-colors">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${TYPE_COLORS[item.item_type]}`}>
                  {TYPE_ICONS[item.item_type]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text truncate">{item.label}</p>
                  <p className="text-xs text-text-muted">{TYPE_LABELS[item.item_type]}</p>
                </div>
                <button onClick={() => handleRemoveItem(item.id)}
                  className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger-muted transition-all cursor-pointer shrink-0"
                  title="Remove from folder">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
