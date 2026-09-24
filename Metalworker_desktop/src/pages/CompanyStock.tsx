// src/pages/CompanyStock.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, Search, Edit3, Trash2, Loader2, RefreshCw, X, AlertTriangle, Eye } from "lucide-react";
import { fetchCompanyStocks, createCompanyStock, updateCompanyStock, deleteCompanyStock } from "../services/companyStock";
import { uploadPhoto } from "../services/cloudinary";
import type { CompanyStock, CompanyStockInput } from "../types/companyStock";

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
  return <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">{label}</label>{children}</div>;
}

const inputCls = "w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

export default function CompanyStockPage() {
  const [stocks, setStocks] = useState<CompanyStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewItem, setPreviewItem] = useState<CompanyStock | null>(null);
  const [editingItem, setEditingItem] = useState<CompanyStock | null>(null);

  const [formData, setFormData] = useState<CompanyStockInput>({});
  const [formLoading, setFormLoading] = useState(false);
  const [formMessage, setFormMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [metalFile, setMetalFile] = useState<File | null>(null);
  const [uploadingDrawing, setUploadingDrawing] = useState(false);
  const [uploadingMetal, setUploadingMetal] = useState(false);

  const load = useCallback(async () => {
    try { const list = await fetchCompanyStocks(); setStocks(list); } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  async function handleRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  const filtered = useMemo(() => {
    if (!search.trim()) return stocks;
    const q = search.toLowerCase();
    return stocks.filter((s) =>
      (s.company_name ?? "").toLowerCase().includes(q) ||
      (s.product_name ?? "").toLowerCase().includes(q) ||
      (s.folder_no ?? "").toLowerCase().includes(q) ||
      (s.metal_type ?? "").toLowerCase().includes(q)
    );
  }, [stocks, search]);

  function openAdd() { setFormData({}); setFormMessage(null); setDrawingFile(null); setMetalFile(null); setShowAddModal(true); }
  function openEdit(item: CompanyStock) {
    setEditingItem(item);
    setFormData({
      metal_type: item.metal_type ?? "", folder_no: item.folder_no ?? "", folio_number: item.folio_number ?? "",
      recorded_time: item.recorded_time ?? "", processed_metal_type: item.processed_metal_type ?? "",
      company_name: item.company_name ?? "", product_name: item.product_name ?? "",
      processing_start: item.processing_start ?? "", processing_end: item.processing_end ?? "",
      drawing_photo_url: item.drawing_photo_url ?? "", drawing_photo_public_id: item.drawing_photo_public_id ?? "",
      metal_photo_url: item.metal_photo_url ?? "", metal_photo_public_id: item.metal_photo_public_id ?? "",
    });
    setFormMessage(null); setDrawingFile(null); setMetalFile(null); setShowEditModal(true);
  }
  function openPreview(item: CompanyStock) { setPreviewItem(item); setShowPreviewModal(true); }

  async function handleUploadDrawing() {
    if (!drawingFile) return;
    try { setUploadingDrawing(true); const r = await uploadPhoto(drawingFile); setFormData((p) => ({ ...p, drawing_photo_url: r.secureUrl, drawing_photo_public_id: r.publicId })); setDrawingFile(null); }
    catch (err) { window.alert(err instanceof Error ? err.message : "Upload failed"); } finally { setUploadingDrawing(false); }
  }
  async function handleUploadMetal() {
    if (!metalFile) return;
    try { setUploadingMetal(true); const r = await uploadPhoto(metalFile); setFormData((p) => ({ ...p, metal_photo_url: r.secureUrl, metal_photo_public_id: r.publicId })); setMetalFile(null); }
    catch (err) { window.alert(err instanceof Error ? err.message : "Upload failed"); } finally { setUploadingMetal(false); }
  }

  async function handleSave(isEdit: boolean) {
    setFormMessage(null); setFormLoading(true);
    try {
      if (isEdit && editingItem) {
        const res = await updateCompanyStock(editingItem.id, formData);
        if (!res.ok) { setFormMessage({ type: "error", text: res.error || "Failed." }); return; }
        setFormMessage({ type: "success", text: "Updated." }); await load();
        setTimeout(() => setShowEditModal(false), 800);
      } else {
        const res = await createCompanyStock(formData);
        if (!res.ok) { setFormMessage({ type: "error", text: res.error || "Failed." }); return; }
        setFormMessage({ type: "success", text: "Created." }); await load();
        setTimeout(() => setShowAddModal(false), 800);
      }
    } catch (err) { setFormMessage({ type: "error", text: err instanceof Error ? err.message : "Something went wrong." }); }
    finally { setFormLoading(false); }
  }

  async function handleDelete(item: CompanyStock) {
    if (!window.confirm("Delete this stock record?")) return;
    try { const res = await deleteCompanyStock(item.id); if (res.ok) await load(); else window.alert(res.error || "Failed."); }
    catch (err) { window.alert(err instanceof Error ? err.message : "Failed."); }
  }

  function renderForm(isEdit: boolean) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Company Name"><input type="text" value={formData.company_name ?? ""} onChange={(e) => setFormData((p) => ({ ...p, company_name: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Product Name"><input type="text" value={formData.product_name ?? ""} onChange={(e) => setFormData((p) => ({ ...p, product_name: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Metal Type"><input type="text" value={formData.metal_type ?? ""} onChange={(e) => setFormData((p) => ({ ...p, metal_type: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Processed Metal Type"><input type="text" value={formData.processed_metal_type ?? ""} onChange={(e) => setFormData((p) => ({ ...p, processed_metal_type: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Folder No"><input type="text" value={formData.folder_no ?? ""} onChange={(e) => setFormData((p) => ({ ...p, folder_no: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Folio Number"><input type="text" value={formData.folio_number ?? ""} onChange={(e) => setFormData((p) => ({ ...p, folio_number: e.target.value }))} className={inputCls} /></FormField>
          <FormField label="Recorded Time"><input type="text" value={formData.recorded_time ?? ""} onChange={(e) => setFormData((p) => ({ ...p, recorded_time: e.target.value }))} className={inputCls} /></FormField>
          <div />
          <FormField label="Processing Start"><input type="text" value={formData.processing_start ?? ""} onChange={(e) => setFormData((p) => ({ ...p, processing_start: e.target.value }))} placeholder="YYYY-MM-DD" className={inputCls} /></FormField>
          <FormField label="Processing End"><input type="text" value={formData.processing_end ?? ""} onChange={(e) => setFormData((p) => ({ ...p, processing_end: e.target.value }))} placeholder="YYYY-MM-DD" className={inputCls} /></FormField>
        </div>
        <FormField label="Drawing Photo">
          <div className="flex items-center gap-3">
            {formData.drawing_photo_url && <img src={formData.drawing_photo_url} alt="" className="w-16 h-16 rounded-lg object-cover border border-border" />}
            <input type="file" accept="image/*" onChange={(e) => setDrawingFile(e.target.files?.[0] || null)} className="text-sm text-text-muted" />
            {drawingFile && <button onClick={handleUploadDrawing} disabled={uploadingDrawing} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold cursor-pointer disabled:opacity-50">{uploadingDrawing ? "..." : "Upload"}</button>}
          </div>
        </FormField>
        <FormField label="Metal Photo">
          <div className="flex items-center gap-3">
            {formData.metal_photo_url && <img src={formData.metal_photo_url} alt="" className="w-16 h-16 rounded-lg object-cover border border-border" />}
            <input type="file" accept="image/*" onChange={(e) => setMetalFile(e.target.files?.[0] || null)} className="text-sm text-text-muted" />
            {metalFile && <button onClick={handleUploadMetal} disabled={uploadingMetal} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold cursor-pointer disabled:opacity-50">{uploadingMetal ? "..." : "Upload"}</button>}
          </div>
        </FormField>
        {formMessage && <div className={`px-4 py-3 rounded-xl text-sm animate-scale-in ${formMessage.type === "error" ? "bg-danger-muted border border-danger/20 text-danger" : "bg-success-muted border border-success/20 text-success"}`}>{formMessage.text}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={() => isEdit ? setShowEditModal(false) : setShowAddModal(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer">Cancel</button>
          <button onClick={() => handleSave(isEdit)} disabled={formLoading} className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2">
            {formLoading && <Loader2 size={14} className="animate-spin" />}{isEdit ? "Save" : "Create"}
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
          <div className="w-10 h-10 rounded-xl bg-purple-muted flex items-center justify-center"><Building2 size={20} className="text-purple" /></div>
          <div><h1 className="text-xl font-bold text-text">Stock by Company</h1><p className="text-sm text-text-muted">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /></button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all shadow-lg shadow-primary/20 cursor-pointer"><Plus size={16} />Add Stock</button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company stock..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-border">
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Company</th>
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Product</th>
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Metal Type</th>
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Folder/Folio</th>
            <th className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-12 text-center"><AlertTriangle size={32} className="mx-auto text-text-muted/30 mb-2" /><p className="text-sm text-text-muted">{search ? "No records match." : "No records yet."}</p></td></tr>
            ) : filtered.map((item) => (
              <tr key={item.id} className="hover:bg-surface-hover/50 transition-colors">
                <td className="px-5 py-4"><p className="text-sm font-medium text-text">{item.company_name || "—"}</p></td>
                <td className="px-5 py-4"><p className="text-sm text-text">{item.product_name || "—"}</p></td>
                <td className="px-5 py-4 hidden lg:table-cell"><p className="text-sm text-text-muted">{item.metal_type || "—"}</p></td>
                <td className="px-5 py-4 hidden lg:table-cell"><p className="text-sm text-text-muted">{item.folder_no || "—"}{item.folio_number ? ` / ${item.folio_number}` : ""}</p></td>
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

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add Company Stock">{renderForm(false)}</Modal>
      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Company Stock">{renderForm(true)}</Modal>
      <Modal open={showPreviewModal} onClose={() => setShowPreviewModal(false)} title="Company Stock Details">
        {previewItem && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {([["Company", previewItem.company_name], ["Product", previewItem.product_name], ["Metal Type", previewItem.metal_type],
                ["Processed Metal", previewItem.processed_metal_type], ["Folder No", previewItem.folder_no], ["Folio Number", previewItem.folio_number],
                ["Recorded Time", previewItem.recorded_time], ["Processing Start", previewItem.processing_start], ["Processing End", previewItem.processing_end],
              ] as [string, string | null | undefined][]).map(([label, value]) => (
                <div key={label}><p className="text-xs text-text-muted">{label}</p><p className="text-sm font-medium text-text">{value || "—"}</p></div>
              ))}
            </div>
            <div className="flex gap-4">
              {previewItem.drawing_photo_url && <div><p className="text-xs text-text-muted mb-1">Drawing</p><img src={previewItem.drawing_photo_url} alt="" className="w-40 h-40 rounded-xl object-cover border border-border" /></div>}
              {previewItem.metal_photo_url && <div><p className="text-xs text-text-muted mb-1">Metal</p><img src={previewItem.metal_photo_url} alt="" className="w-40 h-40 rounded-xl object-cover border border-border" /></div>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
