// src/pages/OwnerStock.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Package, Plus, Search, Edit3, Trash2, Loader2, RefreshCw, X,
  AlertTriangle, Image, Eye,
} from "lucide-react";
import { fetchOwnerStocks, createOwnerStock, updateOwnerStock, deleteOwnerStock } from "../services/ownerStock";
import { uploadPhoto } from "../services/cloudinary";
import type { OwnerStock, OwnerStockInput } from "../types/ownerStock";

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-surface z-10">
          <h3 className="text-lg font-bold text-text">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

export default function OwnerStockPage() {
  const [stocks, setStocks] = useState<OwnerStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewItem, setPreviewItem] = useState<OwnerStock | null>(null);
  const [editingItem, setEditingItem] = useState<OwnerStock | null>(null);

  // Form state
  const [formData, setFormData] = useState<OwnerStockInput>({});
  const [formLoading, setFormLoading] = useState(false);
  const [formMessage, setFormMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Image uploads
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [metalFile, setMetalFile] = useState<File | null>(null);
  const [uploadingDrawing, setUploadingDrawing] = useState(false);
  const [uploadingMetal, setUploadingMetal] = useState(false);

  const load = useCallback(async () => {
    try { const list = await fetchOwnerStocks(); setStocks(list); } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  const filtered = useMemo(() => {
    if (!search.trim()) return stocks;
    const q = search.toLowerCase();
    return stocks.filter((s) =>
      (s.source_of_metal ?? "").toLowerCase().includes(q) ||
      (s.folder_no ?? "").toLowerCase().includes(q) ||
      (s.metal_type ?? "").toLowerCase().includes(q) ||
      (s.folio_number ?? "").toLowerCase().includes(q)
    );
  }, [stocks, search]);

  function openAdd() {
    setFormData({}); setFormMessage(null); setDrawingFile(null); setMetalFile(null); setShowAddModal(true);
  }

  function openEdit(item: OwnerStock) {
    setEditingItem(item);
    setFormData({
      source_of_metal: item.source_of_metal ?? "", folder_no: item.folder_no ?? "", folio_number: item.folio_number ?? "",
      metal_type: item.metal_type ?? "", tn_no: item.tn_no ?? "", paint: item.paint ?? "",
      recorded_time: item.recorded_time ?? "", amount_purchase: item.amount_purchase ?? undefined,
      processing_start: item.processing_start ?? "", processing_end: item.processing_end ?? "",
      drawing_photo_url: item.drawing_photo_url ?? "", drawing_photo_public_id: item.drawing_photo_public_id ?? "",
      metal_photo_url: item.metal_photo_url ?? "", metal_photo_public_id: item.metal_photo_public_id ?? "",
    });
    setFormMessage(null); setDrawingFile(null); setMetalFile(null); setShowEditModal(true);
  }

  function openPreview(item: OwnerStock) { setPreviewItem(item); setShowPreviewModal(true); }

  async function handleUploadDrawing() {
    if (!drawingFile) return;
    try {
      setUploadingDrawing(true);
      const result = await uploadPhoto(drawingFile);
      setFormData((prev) => ({ ...prev, drawing_photo_url: result.secureUrl, drawing_photo_public_id: result.publicId }));
      setDrawingFile(null);
    } catch (err) { window.alert(err instanceof Error ? err.message : "Upload failed"); }
    finally { setUploadingDrawing(false); }
  }

  async function handleUploadMetal() {
    if (!metalFile) return;
    try {
      setUploadingMetal(true);
      const result = await uploadPhoto(metalFile);
      setFormData((prev) => ({ ...prev, metal_photo_url: result.secureUrl, metal_photo_public_id: result.publicId }));
      setMetalFile(null);
    } catch (err) { window.alert(err instanceof Error ? err.message : "Upload failed"); }
    finally { setUploadingMetal(false); }
  }

  async function handleSave(isEdit: boolean) {
    setFormMessage(null); setFormLoading(true);
    try {
      const cleaned: OwnerStockInput = { ...formData };
      if (cleaned.amount_purchase !== undefined && cleaned.amount_purchase !== null) {
        cleaned.amount_purchase = Number(cleaned.amount_purchase);
      }
      if (isEdit && editingItem) {
        const res = await updateOwnerStock(editingItem.id, cleaned);
        if (!res.ok) { setFormMessage({ type: "error", text: res.error || "Failed to update." }); return; }
        setFormMessage({ type: "success", text: "Updated successfully." });
        await load();
        setTimeout(() => { setShowEditModal(false); }, 800);
      } else {
        const res = await createOwnerStock(cleaned);
        if (!res.ok) { setFormMessage({ type: "error", text: res.error || "Failed to create." }); return; }
        setFormMessage({ type: "success", text: "Created successfully." });
        await load();
        setTimeout(() => { setShowAddModal(false); }, 800);
      }
    } catch (err) {
      setFormMessage({ type: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally { setFormLoading(false); }
  }

  async function handleDelete(item: OwnerStock) {
    if (!window.confirm(`Delete this stock record? This cannot be undone.`)) return;
    try {
      const res = await deleteOwnerStock(item.id);
      if (res.ok) { await load(); } else { window.alert(res.error || "Failed to delete."); }
    } catch (err) { window.alert(err instanceof Error ? err.message : "Failed to delete."); }
  }

  function renderForm(isEdit: boolean) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Source of Metal"><input type="text" value={formData.source_of_metal ?? ""} onChange={(e) => setFormData((p) => ({ ...p, source_of_metal: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Folder No"><input type="text" value={formData.folder_no ?? ""} onChange={(e) => setFormData((p) => ({ ...p, folder_no: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Folio Number"><input type="text" value={formData.folio_number ?? ""} onChange={(e) => setFormData((p) => ({ ...p, folio_number: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Metal Type"><input type="text" value={formData.metal_type ?? ""} onChange={(e) => setFormData((p) => ({ ...p, metal_type: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="TN No"><input type="text" value={formData.tn_no ?? ""} onChange={(e) => setFormData((p) => ({ ...p, tn_no: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Paint"><input type="text" value={formData.paint ?? ""} onChange={(e) => setFormData((p) => ({ ...p, paint: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Amount Purchase"><input type="number" value={formData.amount_purchase ?? ""} onChange={(e) => setFormData((p) => ({ ...p, amount_purchase: e.target.value ? Number(e.target.value) : undefined }))} className={inputCls} /></FormField>
          <FormField label="Recorded Time"><input type="text" value={formData.recorded_time ?? ""} onChange={(e) => setFormData((p) => ({ ...p, recorded_time: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Processing Start"><input type="text" value={formData.processing_start ?? ""} onChange={(e) => setFormData((p) => ({ ...p, processing_start: e.target.value }))} placeholder="YYYY-MM-DD" className={inputCls} /></FormField>
          <FormField label="Processing End"><input type="text" value={formData.processing_end ?? ""} onChange={(e) => setFormData((p) => ({ ...p, processing_end: e.target.value }))} placeholder="YYYY-MM-DD" className={inputCls} /></FormField>
        </div>

        {/* Drawing Photo */}
        <FormField label="Drawing Photo">
          <div className="flex items-center gap-3">
            {formData.drawing_photo_url && <img src={formData.drawing_photo_url} alt="Drawing" className="w-16 h-16 rounded-lg object-cover border border-border" />}
            <input type="file" accept="image/*" onChange={(e) => setDrawingFile(e.target.files?.[0] || null)} className="text-sm text-text-muted" />
            {drawingFile && <button onClick={handleUploadDrawing} disabled={uploadingDrawing} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold cursor-pointer disabled:opacity-50">{uploadingDrawing ? "Uploading..." : "Upload"}</button>}
          </div>
        </FormField>

        {/* Metal Photo */}
        <FormField label="Metal Photo">
          <div className="flex items-center gap-3">
            {formData.metal_photo_url && <img src={formData.metal_photo_url} alt="Metal" className="w-16 h-16 rounded-lg object-cover border border-border" />}
            <input type="file" accept="image/*" onChange={(e) => setMetalFile(e.target.files?.[0] || null)} className="text-sm text-text-muted" />
            {metalFile && <button onClick={handleUploadMetal} disabled={uploadingMetal} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold cursor-pointer disabled:opacity-50">{uploadingMetal ? "Uploading..." : "Upload"}</button>}
          </div>
        </FormField>

        {formMessage && (
          <div className={`px-4 py-3 rounded-xl text-sm animate-scale-in ${formMessage.type === "error" ? "bg-danger-muted border border-danger/20 text-danger" : "bg-success-muted border border-success/20 text-success"}`}>
            {formMessage.text}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={() => isEdit ? setShowEditModal(false) : setShowAddModal(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer">Cancel</button>
          <button onClick={() => handleSave(isEdit)} disabled={formLoading} className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2">
            {formLoading && <Loader2 size={14} className="animate-spin" />}{isEdit ? "Save Changes" : "Create Record"}
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="text-primary animate-spin" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-muted flex items-center justify-center"><Package size={20} className="text-primary" /></div>
          <div><h1 className="text-xl font-bold text-text">Stock by Owner</h1><p className="text-sm text-text-muted">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /></button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all shadow-lg shadow-primary/20 cursor-pointer"><Plus size={16} />Add Stock</button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stock records..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-border">
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Source</th>
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Folder / Folio</th>
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Metal Type</th>
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Amount</th>
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3 hidden xl:table-cell">Photos</th>
            <th className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-12 text-center">
                <AlertTriangle size={32} className="mx-auto text-text-muted/30 mb-2" />
                <p className="text-sm text-text-muted">{search ? "No records match your search." : "No stock records yet."}</p>
              </td></tr>
            ) : filtered.map((item) => (
              <tr key={item.id} className="hover:bg-surface-hover/50 transition-colors">
                <td className="px-5 py-4"><p className="text-sm font-medium text-text">{item.source_of_metal || "—"}</p></td>
                <td className="px-5 py-4"><p className="text-sm text-text">{item.folder_no || "—"}{item.folio_number ? ` / ${item.folio_number}` : ""}</p></td>
                <td className="px-5 py-4 hidden lg:table-cell"><p className="text-sm text-text-muted">{item.metal_type || "—"}</p></td>
                <td className="px-5 py-4 hidden lg:table-cell"><p className="text-sm text-text-muted">{item.amount_purchase != null ? item.amount_purchase : "—"}</p></td>
                <td className="px-5 py-4 hidden xl:table-cell">
                  <div className="flex gap-1">
                    {item.drawing_photo_url && <img src={item.drawing_photo_url} alt="" className="w-8 h-8 rounded object-cover border border-border" />}
                    {item.metal_photo_url && <img src={item.metal_photo_url} alt="" className="w-8 h-8 rounded object-cover border border-border" />}
                    {!item.drawing_photo_url && !item.metal_photo_url && <span className="text-xs text-text-muted">None</span>}
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openPreview(item)} className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary-muted transition-all cursor-pointer" title="Preview"><Eye size={16} /></button>
                    <button onClick={() => openEdit(item)} className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary-muted transition-all cursor-pointer" title="Edit"><Edit3 size={16} /></button>
                    <button onClick={() => handleDelete(item)} className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger-muted transition-all cursor-pointer" title="Delete"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add Owner Stock">{renderForm(false)}</Modal>
      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Owner Stock">{renderForm(true)}</Modal>

      {/* Preview Modal */}
      <Modal open={showPreviewModal} onClose={() => setShowPreviewModal(false)} title="Owner Stock Details">
        {previewItem && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {([
                ["Source of Metal", previewItem.source_of_metal], ["Folder No", previewItem.folder_no],
                ["Folio Number", previewItem.folio_number], ["Metal Type", previewItem.metal_type],
                ["TN No", previewItem.tn_no], ["Paint", previewItem.paint],
                ["Amount Purchase", previewItem.amount_purchase?.toString()], ["Recorded Time", previewItem.recorded_time],
                ["Processing Start", previewItem.processing_start], ["Processing End", previewItem.processing_end],
              ] as [string, string | null | undefined][]).map(([label, value]) => (
                <div key={label}><p className="text-xs text-text-muted">{label}</p><p className="text-sm font-medium text-text">{value || "—"}</p></div>
              ))}
            </div>
            <div className="flex gap-4">
              {previewItem.drawing_photo_url && (
                <div><p className="text-xs text-text-muted mb-1">Drawing Photo</p><img src={previewItem.drawing_photo_url} alt="Drawing" className="w-40 h-40 rounded-xl object-cover border border-border" /></div>
              )}
              {previewItem.metal_photo_url && (
                <div><p className="text-xs text-text-muted mb-1">Metal Photo</p><img src={previewItem.metal_photo_url} alt="Metal" className="w-40 h-40 rounded-xl object-cover border border-border" /></div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
